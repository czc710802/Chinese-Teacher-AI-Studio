import { Router } from 'express';

import { requireUser } from '../middleware/auth.js';

export function isStorageAdminUser(user) {
  return Boolean(user && user.role === 'teacher');
}

function requireStorageAdmin(req, res, next) {
  if (!isStorageAdminUser(req.user)) {
    res.status(403).json({ message: '没有存储管理权限' });
    return;
  }
  next();
}

function storageService(req) {
  const service = req.app.locals.storageService;
  if (!service) throw new Error('存储服务未初始化');
  return service;
}

export const storageRouter = Router();
storageRouter.use(requireUser);
storageRouter.use(requireStorageAdmin);

storageRouter.get('/health', async (req, res, next) => {
  try {
    res.json(await storageService(req).getStorageHealth());
  } catch (error) {
    next(error);
  }
});

storageRouter.get('/status', (req, res) => {
  res.json(storageService(req).getStorageStatus());
});

storageRouter.get('/sync-queue', (req, res) => {
  const service = storageService(req);
  res.json({
    summary: service.queue.summary(),
    tasks: service.listSyncTasks().map((task) => ({
      task_id: task.task_id,
      remote_path: task.remote_path,
      sha256: task.sha256,
      status: task.status,
      retry_count: task.retry_count,
      last_error: task.last_error,
      created_at: task.created_at,
      synced_at: task.synced_at,
      next_attempt_at: task.next_attempt_at
    }))
  });
});

storageRouter.post('/test', async (req, res, next) => {
  try {
    res.json(await storageService(req).testRoundTrip());
  } catch (error) {
    next(error);
  }
});

storageRouter.post('/sync-now', async (req, res, next) => {
  try {
    res.json(await storageService(req).syncToNas({ includeFailed: false }));
  } catch (error) {
    next(error);
  }
});

storageRouter.post('/retry-failed', async (req, res, next) => {
  try {
    const service = storageService(req);
    const retried = service.retryFailed();
    const result = await service.syncToNas({ includeFailed: true });
    res.json({ retried, ...result });
  } catch (error) {
    next(error);
  }
});
