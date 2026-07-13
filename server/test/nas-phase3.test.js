import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { readNasFileForFeishu } from '../src/integrations/feishu/service.js';
import { buildWebDavUrl } from '../src/storage/nas-storage.js';
import {
  buildBootstrapEnvSuggestion,
  buildSmbMountUrl,
  requiredNasDirectories,
  validateNasCredentials
} from '../src/storage/nas-bootstrap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');

test('NAS bootstrap requires username and password without exposing secrets', () => {
  const result = validateNasCredentials({
    NAS_HOST: '192.168.100.164',
    NAS_USERNAME: '',
    NAS_PASSWORD: ''
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['NAS_USERNAME', 'NAS_PASSWORD']);
  assert.doesNotMatch(JSON.stringify(result), /password123|secret/i);
});

test('NAS bootstrap creates the required business directories', () => {
  assert.deepEqual(requiredNasDirectories(), [
    'uploads',
    'students',
    'teachers',
    'reports',
    'backup'
  ]);
});

test('bootstrap env suggestion supports both SMB local mount and WebDAV', () => {
  const smb = buildBootstrapEnvSuggestion({ protocol: 'local_mount', host: '192.168.100.164', smbShare: '共享文件', mountPath: '/Volumes/共享文件' });
  const webdav = buildBootstrapEnvSuggestion({ protocol: 'webdav', host: '192.168.100.164', port: 5006 });

  assert.match(smb, /NAS_PROTOCOL=local_mount/);
  assert.match(smb, /NAS_SMB_SHARE=共享文件/);
  assert.match(smb, /NAS_MOUNT_PATH=\/Volumes\/共享文件/);
  assert.match(webdav, /NAS_PROTOCOL=webdav/);
  assert.match(webdav, /NAS_PORT=5006/);
  assert.doesNotMatch(webdav, /NAS_SMB_SHARE/);
  assert.match(webdav, /NAS_USERNAME=/);
  assert.match(webdav, /NAS_PASSWORD=/);
});

test('WebDAV 5006 keeps HTTPS even when TLS verification is disabled', () => {
  const url = buildWebDavUrl({
    host: '192.168.100.164',
    port: 5006,
    remotePath: '/作文AI',
    verifyTls: false
  }, 'uploads');

  assert.equal(url, 'https://192.168.100.164:5006/%E4%BD%9C%E6%96%87AI/uploads');
});

test('SMB mount URL is constructed without logging credentials in reports', () => {
  const url = buildSmbMountUrl({
    host: '192.168.100.164',
    username: 'teacher',
    password: 'pass word',
    shareName: '作文AI'
  });

  assert.match(url, /^smb:\/\/teacher:pass%20word@192\.168\.100\.164/);
  assert.match(url, /%E4%BD%9C%E6%96%87AI$/);
});

test('phase 3 scripts and deployment report docs exist', () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));

  assert.equal(rootPackage.scripts['nas:bootstrap'], 'node ops/scripts/zspace-bootstrap.mjs');
  assert.equal(rootPackage.scripts['nas:service'], 'node ops/scripts/nas-sync-service.mjs');
  for (const file of [
    'ops/scripts/zspace-bootstrap.mjs',
    'ops/scripts/nas-sync-service.mjs',
    'docs/NAS_DEPLOYMENT_REPORT.md'
  ]) {
    assert.equal(fs.existsSync(path.join(appDir, file)), true, `${file} should exist`);
  }
});

test('review completion and Feishu service expose NAS report/file integration points', () => {
  const artifactsSource = fs.readFileSync(path.join(appDir, 'server/src/services/storage-artifacts.js'), 'utf8');
  const feishuParserSource = fs.readFileSync(path.join(appDir, 'server/src/integrations/feishu/messageParser.js'), 'utf8');
  const feishuServiceSource = fs.readFileSync(path.join(appDir, 'server/src/integrations/feishu/service.js'), 'utf8');

  assert.match(artifactsSource, /recordReviewReportArtifacts/);
  assert.match(artifactsSource, /auto-review-report\.docx/);
  assert.match(artifactsSource, /auto-review-report\.pdf/);
  assert.match(artifactsSource, /auto-review-report\.md/);
  assert.match(feishuParserSource, /nas/);
  assert.match(feishuServiceSource, /findNasFilesForFeishu/);
  assert.match(feishuServiceSource, /readNasFileForFeishu/);
});

test('Feishu NAS command can read a safe text preview from synced local mirror', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-feishu-'));
  const dataDir = path.join(tmpDir, 'data');
  const reportDir = path.join(tmpDir, 'server', 'storage-artifacts', 'auto-reports', 'essay-1');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });
  const localPath = path.join(reportDir, 'auto-review-report.md');
  fs.writeFileSync(localPath, '# 批改报告\n内容预览', 'utf8');
  fs.writeFileSync(path.join(dataDir, 'nas-sync-queue.json'), JSON.stringify({
    tasks: [{
      local_path: localPath,
      remote_path: '/作文AI/reports/essay-1/auto-review-report.md',
      status: 'synced',
      sha256: 'abcdef123456',
      synced_at: '2026-07-11T10:00:00.000Z'
    }]
  }), 'utf8');

  const result = readNasFileForFeishu({ appDir: tmpDir, query: 'auto-review' });

  assert.equal(result.ok, true);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].preview.ok, true);
  assert.match(result.items[0].preview.text, /批改报告/);
});
