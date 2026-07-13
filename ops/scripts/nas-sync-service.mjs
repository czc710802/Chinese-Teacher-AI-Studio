#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStorageService } from '../../server/src/storage/storage-service.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '../..');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const index = trimmed.indexOf('=');
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

loadEnvFile(path.join(appDir, '.env.production'));
loadEnvFile(path.join(appDir, '.env.nas'));

const service = createStorageService({ appDir, env: process.env });
const intervalMs = Math.max(10, Number(process.env.NAS_SYNC_INTERVAL_SECONDS || 60)) * 1000;

async function tick() {
  const result = await service.syncToNas({ includeFailed: false, limit: 500 });
  console.log(JSON.stringify({ at: new Date().toISOString(), ...result, status: service.getStorageStatus() }));
}

await tick();
if (process.argv.includes('--once')) process.exit(0);
setInterval(() => {
  tick().catch((error) => console.error(JSON.stringify({ at: new Date().toISOString(), error: error.message })));
}, intervalMs);
