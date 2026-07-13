import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createStorageService } from '../src/storage/storage-service.js';
import { createSyncQueue } from '../src/storage/sync-queue.js';
import { isStorageAdminUser } from '../src/routes/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');

function makeTempAppDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'essay-nas-storage-'));
}

test('storage service creates ascii-safe student paths and keeps original names in metadata', async () => {
  const appDir = makeTempAppDir();
  const service = createStorageService({ appDir, env: { NAS_ENABLED: 'false' } });

  const directory = service.createStudentDirectory({
    classId: 2,
    className: '510 班/甲',
    studentId: 4,
    studentName: '张 三',
    year: '2026',
    essayId: 9
  });
  const saved = await service.saveFile({
    content: 'OCR 文本',
    remotePath: path.posix.join(directory.remotePath, 'ocr', '作文 原稿.txt'),
    originalName: '作文 原稿.txt',
    metadata: { stage: 'ocr' }
  });

  assert.match(directory.remotePath, /^classes\/2-[a-z0-9-]+\/students\/4-[a-z0-9-]+\/2026\/9$/);
  assert.doesNotMatch(directory.remotePath, /[\u4e00-\u9fff\s\\]/);
  assert.equal(fs.readFileSync(saved.localPath, 'utf8'), 'OCR 文本');
  assert.equal(saved.metadata.originalName, '作文 原稿.txt');
  assert.equal(saved.syncTask, null);
});

test('sync queue deduplicates identical sha256 and remote path tasks', async () => {
  const appDir = makeTempAppDir();
  const localPath = path.join(appDir, 'local.txt');
  fs.writeFileSync(localPath, 'same-content');
  const queue = createSyncQueue({ appDir });

  const first = await queue.enqueue({ localPath, remotePath: 'classes/a/review/result.json' });
  const second = await queue.enqueue({ localPath, remotePath: 'classes/a/review/result.json' });
  const all = queue.listTasks();

  assert.equal(first.task_id, second.task_id);
  assert.equal(all.length, 1);
  assert.equal(all[0].sha256.length, 64);
  assert.equal(all[0].status, 'pending');
});

test('local mount sync copies files, verifies sha256, and marks tasks synced', async () => {
  const appDir = makeTempAppDir();
  const mountPath = fs.mkdtempSync(path.join(os.tmpdir(), 'essay-nas-mount-'));
  const service = createStorageService({
    appDir,
    env: {
      NAS_ENABLED: 'true',
      NAS_PROTOCOL: 'local_mount',
      NAS_MOUNT_PATH: mountPath,
      NAS_REMOTE_PATH: '/作文AI'
    }
  });

  const saved = await service.saveFile({
    content: JSON.stringify({ score: 58 }),
    remotePath: 'classes/2-class/students/4-student/2026/9/review/result.json',
    originalName: '批改结果.json'
  });
  const result = await service.syncToNas();
  const remoteFile = path.join(mountPath, '作文AI/classes/2-class/students/4-student/2026/9/review/result.json');

  assert.equal(result.synced, 1);
  assert.equal(fs.readFileSync(remoteFile, 'utf8'), JSON.stringify({ score: 58 }));
  assert.equal(service.getStorageStatus().pendingTasks, 0);
  assert.equal(service.getStorageStatus().lastSuccessfulSyncAt, service.getStorageStatus().lastSuccessfulSyncAt);
  assert.equal(saved.syncTask.status, 'pending');
});

test('offline NAS keeps local files and pending tasks without exposing credentials', async () => {
  const appDir = makeTempAppDir();
  const missingMountPath = path.join(appDir, 'missing-mount');
  const service = createStorageService({
    appDir,
    env: {
      NAS_ENABLED: 'true',
      NAS_PROTOCOL: 'local_mount',
      NAS_MOUNT_PATH: missingMountPath,
      NAS_USERNAME: 'nas-user',
      NAS_PASSWORD: 'secret-password',
      NAS_REMOTE_PATH: '/作文AI'
    }
  });

  const saved = await service.saveFile({
    content: 'local-first',
    remotePath: 'classes/2-class/students/4-student/2026/9/original/image.txt'
  });
  const result = await service.syncToNas();
  const status = service.getStorageStatus();

  assert.equal(fs.existsSync(saved.localPath), true);
  assert.equal(result.synced, 0);
  assert.equal(status.pendingTasks, 1);
  assert.equal(status.failedTasks, 0);
  assert.equal(status.connected, false);
  assert.equal(JSON.stringify(status).includes('secret-password'), false);
  assert.equal(JSON.stringify(status).includes('nas-user'), false);
});

test('storage management endpoints are limited to teacher operators in the current app', () => {
  assert.equal(isStorageAdminUser({ role: 'teacher' }), true);
  assert.equal(isStorageAdminUser({ role: 'student' }), false);
  assert.equal(isStorageAdminUser(null), false);
});

test('app mounts protected storage routes and initializes the storage service', () => {
  const appSource = fs.readFileSync(path.join(appDir, 'server/src/app.js'), 'utf8');

  assert.match(appSource, /createStorageService/);
  assert.match(appSource, /app\.locals\.storageService/);
  assert.match(appSource, /app\.use\('\/api\/storage', storageRouter\)/);
});

test('essay, profile, and export flows record NAS artifacts through the storage adapter', () => {
  const essaysSource = fs.readFileSync(path.join(appDir, 'server/src/routes/essays.js'), 'utf8');
  const profileSource = fs.readFileSync(path.join(appDir, 'server/src/services/profile.js'), 'utf8');
  const exporterSource = fs.readFileSync(path.join(appDir, 'server/src/services/exporter.js'), 'utf8');
  const essayAiRouteSource = fs.readFileSync(path.join(appDir, 'server/src/routes/essay.js'), 'utf8');
  const essayAiServiceSource = fs.readFileSync(path.join(appDir, 'apps/essay-ai/src/essayService.js'), 'utf8');

  assert.match(essaysSource, /recordOriginalArtifact/);
  assert.match(essaysSource, /recordOcrArtifact/);
  assert.match(essaysSource, /recordReviewArtifact/);
  assert.match(profileSource, /recordStudentProfileSnapshot/);
  assert.match(exporterSource, /recordExportArtifact/);
  assert.match(essayAiRouteSource, /storageService: req\.app\.locals\.storageService/);
  assert.match(essayAiServiceSource, /recordEssayAiArtifact/);
});

test('NAS operations scripts, docs, and environment template are present', () => {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));

  assert.equal(rootPackage.scripts['nas:test'], 'node ops/scripts/test-nas-connection.mjs');
  assert.equal(rootPackage.scripts['nas:status'], 'node ops/scripts/sync-nas-now.mjs --status');
  assert.equal(rootPackage.scripts['nas:sync'], 'node ops/scripts/sync-nas-now.mjs');
  assert.equal(rootPackage.scripts['nas:backup'], 'bash ops/scripts/backup-to-nas.sh');
  for (const file of [
    'ops/scripts/test-nas-connection.mjs',
    'ops/scripts/sync-nas-now.mjs',
    'ops/scripts/backup-to-nas.sh',
    'docs/NAS_INTEGRATION.md',
    '.env.nas.example'
  ]) {
    assert.equal(fs.existsSync(path.join(appDir, file)), true, `${file} should exist`);
  }
});
