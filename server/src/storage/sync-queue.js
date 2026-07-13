import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { ensureDir, sha256File, writeFileAtomic } from './local-storage.js';

function nowIso() {
  return new Date().toISOString();
}

function normalizeQueue(data) {
  if (Array.isArray(data)) return { version: 1, tasks: data };
  if (data && Array.isArray(data.tasks)) return { version: data.version || 1, tasks: data.tasks };
  return { version: 1, tasks: [] };
}

function retryDelayMs(retryCount) {
  const seconds = Math.min(3600, Math.max(5, 5 * 2 ** Math.max(0, retryCount - 1)));
  return seconds * 1000;
}

export function createSyncQueue({ appDir, queuePath, retryCount = 5 } = {}) {
  const resolvedQueuePath = queuePath || path.join(appDir, 'data', 'nas-sync-queue.json');

  function readStore() {
    if (!fs.existsSync(resolvedQueuePath)) return { version: 1, tasks: [] };
    try {
      return normalizeQueue(JSON.parse(fs.readFileSync(resolvedQueuePath, 'utf8')));
    } catch {
      return { version: 1, tasks: [] };
    }
  }

  function writeStore(store) {
    ensureDir(path.dirname(resolvedQueuePath));
    writeFileAtomic(resolvedQueuePath, `${JSON.stringify(normalizeQueue(store), null, 2)}\n`);
  }

  function listTasks({ status } = {}) {
    const tasks = readStore().tasks;
    return status ? tasks.filter((task) => task.status === status) : tasks;
  }

  async function enqueue({ localPath, remotePath, metadata = {} }) {
    if (!localPath || !remotePath) throw new Error('同步任务缺少 localPath 或 remotePath');
    const sha256 = sha256File(localPath);
    const store = readStore();
    const existing = store.tasks.find((task) => task.remote_path === remotePath && task.sha256 === sha256);
    if (existing) return existing;
    const createdAt = nowIso();
    const task = {
      task_id: randomUUID(),
      local_path: localPath,
      remote_path: remotePath,
      sha256,
      status: 'pending',
      retry_count: 0,
      last_error: '',
      created_at: createdAt,
      updated_at: createdAt,
      synced_at: '',
      next_attempt_at: createdAt,
      metadata
    };
    store.tasks.push(task);
    writeStore(store);
    return task;
  }

  function markSynced(taskId) {
    const store = readStore();
    const task = store.tasks.find((item) => item.task_id === taskId);
    if (!task) return null;
    task.status = 'synced';
    task.last_error = '';
    task.synced_at = nowIso();
    task.updated_at = task.synced_at;
    writeStore(store);
    return task;
  }

  function markFailed(taskId, error) {
    const store = readStore();
    const task = store.tasks.find((item) => item.task_id === taskId);
    if (!task) return null;
    task.retry_count = Number(task.retry_count || 0) + 1;
    task.last_error = String(error?.message || error || '同步失败').slice(0, 500);
    task.status = task.retry_count >= retryCount ? 'failed' : 'pending';
    task.updated_at = nowIso();
    task.next_attempt_at = new Date(Date.now() + retryDelayMs(task.retry_count)).toISOString();
    writeStore(store);
    return task;
  }

  function retryFailed() {
    const store = readStore();
    const now = nowIso();
    let count = 0;
    for (const task of store.tasks) {
      if (task.status === 'failed') {
        task.status = 'pending';
        task.next_attempt_at = now;
        task.updated_at = now;
        count += 1;
      }
    }
    writeStore(store);
    return count;
  }

  function dueTasks({ includeFailed = false } = {}) {
    const now = Date.now();
    return readStore().tasks.filter((task) => {
      if (task.status !== 'pending' && !(includeFailed && task.status === 'failed')) return false;
      if (Number(task.retry_count || 0) >= retryCount && !includeFailed) return false;
      return !task.next_attempt_at || Date.parse(task.next_attempt_at) <= now;
    });
  }

  function summary() {
    const tasks = readStore().tasks;
    const synced = tasks.filter((task) => task.status === 'synced' && task.synced_at)
      .sort((a, b) => String(b.synced_at).localeCompare(String(a.synced_at)));
    return {
      queuePath: resolvedQueuePath,
      totalTasks: tasks.length,
      pendingTasks: tasks.filter((task) => task.status === 'pending').length,
      failedTasks: tasks.filter((task) => task.status === 'failed').length,
      syncedTasks: tasks.filter((task) => task.status === 'synced').length,
      lastSuccessfulSyncAt: synced[0]?.synced_at || ''
    };
  }

  return {
    queuePath: resolvedQueuePath,
    enqueue,
    listTasks,
    dueTasks,
    markSynced,
    markFailed,
    retryFailed,
    summary
  };
}
