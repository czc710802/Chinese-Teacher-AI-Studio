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

console.log('ZSpace WebDAV connection test');
console.log(JSON.stringify({
  enabled: process.env.ZSPACE_ENABLED || '',
  url: process.env.ZSPACE_WEBDAV_URL || '',
  usernameConfigured: configured('ZSPACE_WEBDAV_USERNAME'),
  passwordConfigured: configured('ZSPACE_WEBDAV_PASSWORD'),
  rootDirectory: process.env.ZSPACE_ROOT_DIR || '',
  allowSelfSigned: process.env.ZSPACE_ALLOW_SELF_SIGNED || 'false',
  timeoutMs: process.env.ZSPACE_TIMEOUT_MS || '15000'
}, null, 2));

if (missing.length) {
  console.error(`缺少环境变量：${missing.join(', ')}`);
  process.exit(1);
}

try {
  const client = createZSpaceClient({ env: process.env });
  const status = await client.testConnection();
  console.log(JSON.stringify(status, null, 2));
  if (!status.connected || !status.writable) {
    console.error(`极空间不可写：${status.error || '连接测试失败'}`);
    process.exit(1);
  }
  console.log('ZSpace WebDAV read/write/delete test ok');
} catch (error) {
  console.error(`极空间连接测试失败：${error.message}`);
  process.exit(1);
}
