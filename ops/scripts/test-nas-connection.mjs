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
const status = await service.getStorageHealth();

console.log('NAS connection check');
console.log(JSON.stringify(status, null, 2));

if (!service.rawConfig.enabled) {
  console.error('NAS_ENABLED=false，未执行写入测试。');
  process.exit(1);
}

if (!status.connected || !status.writable) {
  console.error(`NAS 不可用：${status.lastError || '连接或写入检查失败'}`);
  process.exit(1);
}

try {
  const result = await service.testRoundTrip();
  if (!result.ok) {
    console.error('NAS 上传/下载 SHA-256 校验失败。');
    process.exit(1);
  }
  console.log('NAS test ok');
  console.log(JSON.stringify({ remotePath: result.remotePath, sha256: result.sha256 }, null, 2));
} catch (error) {
  console.error(`NAS 测试失败：${error.message}`);
  process.exit(1);
}
