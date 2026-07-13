import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const QUEUE_FILE = path.join('data', 'student-profile-queue', 'profile-pending.json');
const MAX_RETRY = 5;

function queuePath(appDir) {
  return path.join(appDir, QUEUE_FILE);
}

function safeErrorMessage(error) {
  return String(error?.message || error || '未知错误')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
    .replace(/Basic\s+[A-Za-z0-9+/=]+/g, 'Basic ***')
    .slice(0, 400);
}

export function readProfileQueue(appDir) {
  const file = queuePath(appDir);
  if (!fs.existsSync(file)) return { version: 1, tasks: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { version: 1, tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
  } catch {
    return { version: 1, tasks: [] };
  }
}

export function writeProfileQueue(appDir, store) {
  const file = queuePath(appDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, tasks: store.tasks || [] }, null, 2)}\n`, 'utf8');
}

export function enqueueProfileUpdate({ appDir, archiveId, studentKey, className, localDir, remoteBase, error } = {}) {
  const store = readProfileQueue(appDir);
  const existing = store.tasks.find((task) => task.studentKey === studentKey && task.status === 'pending');
  const now = new Date().toISOString();
  const task = existing || {
    taskId: randomUUID(),
    archiveId,
    studentKey,
    className,
    retryCount: 0,
    createdAt: now,
    status: 'pending'
  };
  Object.assign(task, {
    archiveId,
    localDir,
    remoteBase,
    lastErrorCode: safeErrorMessage(error),
    nextRetryAt: now,
    updatedAt: now
  });
  if (!existing) store.tasks.push(task);
  writeProfileQueue(appDir, store);
  return task;
}

export async function retryPendingProfileUpdates({ appDir, client, logger = console } = {}) {
  const store = readProfileQueue(appDir);
  let synced = 0;
  let failed = 0;
  for (const task of store.tasks.filter((item) => item.status === 'pending')) {
    if (task.retryCount >= MAX_RETRY) {
      task.status = 'failed';
      failed += 1;
      continue;
    }
    try {
      const files = fs.readdirSync(task.localDir).filter((name) => fs.statSync(path.join(task.localDir, name)).isFile());
      await client.ensureDirectory?.(task.remoteBase);
      for (const name of files) {
        const filePath = path.join(task.localDir, name);
        const contentType = name.endsWith('.json') ? 'application/json; charset=utf-8'
          : name.endsWith('.md') ? 'text/markdown; charset=utf-8'
            : name.endsWith('.pdf') ? 'application/pdf'
              : name.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                : 'application/octet-stream';
        const remotePath = path.posix.join(task.remoteBase, name);
        await client.deleteFile?.(remotePath).catch(() => {});
        await client.uploadBuffer(remotePath, fs.readFileSync(filePath), contentType);
      }
      const reportsDir = path.join(task.localDir, 'reports');
      if (fs.existsSync(reportsDir)) {
        await client.ensureDirectory?.(path.posix.join(task.remoteBase, 'reports'));
        for (const name of fs.readdirSync(reportsDir)) {
          const filePath = path.join(reportsDir, name);
          if (!fs.statSync(filePath).isFile()) continue;
          const contentType = name.endsWith('.md') ? 'text/markdown; charset=utf-8'
            : name.endsWith('.pdf') ? 'application/pdf'
              : name.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                : 'application/octet-stream';
          const remotePath = path.posix.join(task.remoteBase, 'reports', name);
          await client.deleteFile?.(remotePath).catch(() => {});
          await client.uploadBuffer(remotePath, fs.readFileSync(filePath), contentType);
        }
      }
      task.status = 'synced';
      task.syncedAt = new Date().toISOString();
      synced += 1;
    } catch (error) {
      task.retryCount = Number(task.retryCount || 0) + 1;
      task.lastErrorCode = safeErrorMessage(error);
      task.nextRetryAt = new Date(Date.now() + Math.min(60 * 60 * 1000, 1000 * 2 ** task.retryCount)).toISOString();
      failed += 1;
      logger.warn?.('学生成长档案队列同步失败', { studentKey: task.studentKey, message: task.lastErrorCode });
    }
  }
  writeProfileQueue(appDir, store);
  return { synced, failed, pending: store.tasks.filter((item) => item.status === 'pending').length };
}
