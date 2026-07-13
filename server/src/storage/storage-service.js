import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { assertInside, ensureDir, sha256Buffer, sha256File, writeFileAtomic } from './local-storage.js';
import { createNasClient, loadNasConfig, publicNasConfig } from './nas-storage.js';
import { createSyncQueue } from './sync-queue.js';

function hashText(value) {
  return createHash('sha1').update(String(value || '')).digest('hex').slice(0, 10);
}

export function sanitizePathSegment(value, fallback = 'item') {
  const raw = String(value || '').normalize('NFKD');
  const extension = path.posix.extname(raw).replace(/[^\w.-]/g, '');
  const base = extension ? raw.slice(0, -extension.length) : raw;
  const ascii = base
    .replace(/[^\x00-\x7F]/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .toLowerCase();
  const safeBase = ascii || `${fallback}-${hashText(value)}`;
  return `${safeBase}${extension || ''}`;
}

export function sanitizeRemotePath(remotePath) {
  const normalized = String(remotePath || '').replace(/\\/g, '/');
  if (!normalized || normalized.includes('\0')) throw new Error('remotePath 无效');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) throw new Error('remotePath 不允许路径穿越');
  return parts.map((part, index) => sanitizePathSegment(part, index === parts.length - 1 ? 'file' : 'dir')).join('/');
}

function nowYear() {
  return String(new Date().getFullYear());
}

function artifactBaseDir(appDir) {
  return path.join(appDir, 'server', 'storage-artifacts');
}

function relativeArtifactLocalPath(appDir, safeRemotePath) {
  const target = path.join(artifactBaseDir(appDir), safeRemotePath);
  return assertInside(artifactBaseDir(appDir), target);
}

export function createStorageService({ appDir = path.resolve(process.cwd()), env = process.env, logger = console, queue, nasClient } = {}) {
  const config = loadNasConfig(env);
  config.appDir = appDir;
  const syncQueue = queue || createSyncQueue({ appDir, retryCount: config.retryCount });
  const client = nasClient || createNasClient(config);
  let lastError = '';
  let scheduler = null;

  function createStudentDirectory({ classId, className, studentId, studentName, year = nowYear(), essayId }) {
    const classSegment = `${Number(classId) || 0}-${sanitizePathSegment(className || `class-${classId}`, 'class')}`;
    const studentSegment = `${Number(studentId) || 0}-${sanitizePathSegment(studentName || `student-${studentId}`, 'student')}`;
    const essaySegment = sanitizePathSegment(essayId || 'essay', 'essay');
    return {
      remotePath: path.posix.join('classes', classSegment, 'students', studentSegment, sanitizePathSegment(year, 'year'), essaySegment)
    };
  }

  async function saveFile({ content, buffer, localPath, remotePath, originalName = '', metadata = {} }) {
    const safeRemotePath = sanitizeRemotePath(remotePath);
    let resolvedLocalPath = localPath ? path.resolve(localPath) : relativeArtifactLocalPath(appDir, safeRemotePath);
    if (content != null || buffer != null) {
      const payload = buffer != null ? Buffer.from(buffer) : String(content);
      writeFileAtomic(resolvedLocalPath, payload);
    }
    if (!fs.existsSync(resolvedLocalPath)) throw new Error(`本地文件不存在：${resolvedLocalPath}`);

    const fileMetadata = {
      ...metadata,
      originalName,
      remotePath: safeRemotePath,
      localPath: resolvedLocalPath,
      sha256: sha256File(resolvedLocalPath),
      savedAt: new Date().toISOString()
    };
    writeFileAtomic(`${resolvedLocalPath}.metadata.json`, `${JSON.stringify(fileMetadata, null, 2)}\n`);

    const syncTask = config.enabled
      ? await syncQueue.enqueue({ localPath: resolvedLocalPath, remotePath: safeRemotePath, metadata: fileMetadata })
      : null;
    return { localPath: resolvedLocalPath, remotePath: safeRemotePath, metadata: fileMetadata, syncTask };
  }

  function readFile(localPath) {
    const target = path.resolve(localPath);
    return fs.readFileSync(target);
  }

  function deleteFile(localPath) {
    const target = path.resolve(localPath);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return true;
  }

  function fileExists(localPath) {
    return fs.existsSync(path.resolve(localPath));
  }

  async function syncToNas({ includeFailed = false, limit = 50 } = {}) {
    if (!config.enabled) return { enabled: false, synced: 0, failed: 0, skipped: 0 };
    const connection = await client.testConnection();
    if (!connection.connected || !connection.writable) {
      lastError = connection.error || 'NAS 不可写';
      return { enabled: true, synced: 0, failed: 0, skipped: syncQueue.summary().pendingTasks, error: lastError };
    }

    let synced = 0;
    let failed = 0;
    for (const task of syncQueue.dueTasks({ includeFailed }).slice(0, limit)) {
      try {
        await client.uploadFile({ localPath: task.local_path, remotePath: task.remote_path, expectedSha256: task.sha256 });
        syncQueue.markSynced(task.task_id);
        synced += 1;
      } catch (error) {
        syncQueue.markFailed(task.task_id, error);
        lastError = error.message;
        failed += 1;
      }
    }
    return { enabled: true, synced, failed };
  }

  async function getStorageHealth() {
    const connection = await client.testConnection();
    const summary = syncQueue.summary();
    return {
      ...publicNasConfig(config),
      connected: connection.connected,
      writable: connection.writable,
      pendingTasks: summary.pendingTasks,
      failedTasks: summary.failedTasks,
      lastSuccessfulSyncAt: summary.lastSuccessfulSyncAt,
      lastError: connection.error || lastError || ''
    };
  }

  function getStorageStatus() {
    const summary = syncQueue.summary();
    return {
      ...publicNasConfig(config),
      connected: false,
      writable: false,
      pendingTasks: summary.pendingTasks,
      failedTasks: summary.failedTasks,
      lastSuccessfulSyncAt: summary.lastSuccessfulSyncAt,
      lastError
    };
  }

  async function testRoundTrip() {
    const testContent = `nas-test-${new Date().toISOString()}`;
    const localTestPath = path.join(appDir, 'data', 'nas-test.txt');
    const remotePath = `logs/nas-test-${Date.now()}.txt`;
    const downloadPath = path.join(appDir, 'data', 'nas-test-downloaded.txt');
    writeFileAtomic(localTestPath, testContent);
    const expectedSha256 = sha256Buffer(Buffer.from(testContent));
    await client.uploadFile({ localPath: localTestPath, remotePath, expectedSha256 });
    await client.downloadFile({ remotePath, localPath: downloadPath });
    const downloadedSha256 = sha256File(downloadPath);
    await client.deleteFile({ remotePath });
    return {
      ok: downloadedSha256 === expectedSha256,
      remotePath,
      sha256: downloadedSha256
    };
  }

  function startSyncScheduler() {
    if (!config.enabled || scheduler) return null;
    const intervalMs = Math.max(10, Number(config.syncIntervalSeconds || 60)) * 1000;
    scheduler = setInterval(() => {
      syncToNas().catch((error) => {
        lastError = error.message;
        logger.warn?.('NAS 同步失败', { message: error.message });
      });
    }, intervalMs);
    scheduler.unref?.();
    return scheduler;
  }

  function stopSyncScheduler() {
    if (scheduler) clearInterval(scheduler);
    scheduler = null;
  }

  return {
    config: publicNasConfig(config),
    rawConfig: config,
    queue: syncQueue,
    createStudentDirectory,
    saveFile,
    readFile,
    deleteFile,
    fileExists,
    syncToNas,
    getStorageStatus,
    getStorageHealth,
    testRoundTrip,
    retryFailed: syncQueue.retryFailed,
    listSyncTasks: syncQueue.listTasks,
    startSyncScheduler,
    stopSyncScheduler
  };
}
