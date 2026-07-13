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

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

loadEnvFile(path.join(appDir, '.env.production'));
loadEnvFile(path.join(appDir, '.env.nas'));

const service = createStorageService({ appDir, env: process.env });

if (process.argv.includes('--status')) {
  console.log(JSON.stringify(await service.getStorageHealth(), null, 2));
  process.exit(0);
}

const file = argValue('--file');
const remote = argValue('--remote');
if (file || remote) {
  if (!file || !remote) {
    console.error('--file 和 --remote 必须同时提供。');
    process.exit(1);
  }
  if (!service.rawConfig.enabled) {
    console.error('NAS_ENABLED=false，未写入同步队列。');
    process.exit(1);
  }
  await service.saveFile({
    localPath: path.resolve(file),
    remotePath: remote,
    originalName: path.basename(file),
    metadata: { stage: 'manual-sync' }
  });
}

const result = await service.syncToNas({ includeFailed: process.argv.includes('--include-failed'), limit: 500 });
console.log(JSON.stringify({ ...result, status: service.getStorageStatus() }, null, 2));
process.exit(result.failed ? 1 : 0);
