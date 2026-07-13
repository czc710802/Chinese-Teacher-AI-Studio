#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bootstrapNasStorage,
  buildBootstrapEnvSuggestion,
  renderNasDeploymentReport,
  writeNasDeploymentReport
} from '../../server/src/storage/nas-bootstrap.js';

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

process.env.NAS_ENABLED = process.env.NAS_ENABLED || 'true';
process.env.NAS_HOST = process.env.NAS_HOST || '192.168.100.164';
process.env.NAS_PROTOCOL = process.env.NAS_PROTOCOL || (process.argv.includes('--webdav') ? 'webdav' : 'local_mount');
process.env.NAS_PORT = process.env.NAS_PORT || (process.env.NAS_PROTOCOL === 'webdav' ? '5006' : '445');
process.env.NAS_WEBDAV_SCHEME = process.env.NAS_WEBDAV_SCHEME || (process.env.NAS_PROTOCOL === 'webdav' ? 'https' : '');
process.env.NAS_SMB_SHARE = process.env.NAS_SMB_SHARE || '';
process.env.NAS_REMOTE_PATH = process.env.NAS_REMOTE_PATH || '/作文AI';
process.env.NAS_MOUNT_PATH = process.env.NAS_MOUNT_PATH || '/Volumes/作文AI';

const envSuggestion = buildBootstrapEnvSuggestion({
  protocol: process.env.NAS_PROTOCOL,
  host: process.env.NAS_HOST,
  port: process.env.NAS_PORT,
  smbShare: process.env.NAS_SMB_SHARE,
  mountPath: process.env.NAS_MOUNT_PATH,
  remotePath: process.env.NAS_REMOTE_PATH
});
const bootstrap = await bootstrapNasStorage({ env: process.env });
const report = renderNasDeploymentReport({
  discovery: {
    host: process.env.NAS_HOST,
    protocol: process.env.NAS_PROTOCOL,
    webdavScheme: process.env.NAS_WEBDAV_SCHEME,
    smbShare: process.env.NAS_SMB_SHARE,
    mountPath: process.env.NAS_MOUNT_PATH
  },
  bootstrap,
  envSuggestion,
  notes: [
    '本脚本不会写入 .env.production。',
    'SMB 模式会在有凭证时尝试通过 macOS 挂载共享目录；WebDAV 可直接用 HTTP MKCOL 创建目录。'
  ]
});
const reportPath = writeNasDeploymentReport({ appDir, content: report });

console.log(JSON.stringify({
  ok: bootstrap.ok,
  missing: bootstrap.missing || [],
  connected: bootstrap.connected || false,
  writable: bootstrap.writable || false,
  directories: bootstrap.directories || [],
  reportPath
}, null, 2));
process.exit(bootstrap.ok ? 0 : 1);
