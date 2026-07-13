#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createZSpaceClient } from '../../server/src/services/zspace-storage.js';

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

for (const name of ['.env.production', '.env.local', '.env']) {
  loadEnvFile(path.join(appDir, name));
}

function configured(key) {
  return Boolean(String(process.env[key] || '').trim());
}

const required = ['ZSPACE_WEBDAV_URL', 'ZSPACE_WEBDAV_USERNAME', 'ZSPACE_WEBDAV_PASSWORD', 'ZSPACE_ROOT_DIR'];
const missing = required.filter((key) => !configured(key));

if (missing.length) {
  console.error(`缺少环境变量：${missing.join(', ')}`);
  process.exit(1);
}

if (!['1', 'true', 'yes', 'on'].includes(String(process.env.ZSPACE_ENABLED || '').toLowerCase())) {
  console.error('ZSPACE_ENABLED 不是 true，未执行目录初始化。');
  process.exit(1);
}

try {
  const client = createZSpaceClient({ env: process.env });
  const result = await client.ensureBaseDirectories();
  console.log('ZSpace base directory initialization');
  console.log(JSON.stringify({
    rootDirectory: client.config.rootDirectory,
    baseUrl: client.config.baseUrl,
    total: result.total,
    created: result.created,
    existed: result.existed,
    failed: result.failed,
    details: result.details
  }, null, 2));
  if (result.failed > 0) process.exit(1);
} catch (error) {
  console.error(`极空间目录初始化失败：${error.message}`);
  process.exit(1);
}
