import { Router } from 'express';

import { db } from '../db/connection.js';

function isLocalRequest(req) {
  const address = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address) || req.app.get('env') === 'test';
}

function requireZSpaceAdmin(req, res, next) {
  if (isLocalRequest(req)) return next();
  const userId = Number(req.header('x-user-id'));
  if (!userId) return res.status(401).json({ message: '请先登录' });
  const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId);
  if (!user || user.role !== 'teacher') return res.status(403).json({ message: '没有极空间存储管理权限' });
  req.user = user;
  return next();
}

function safeStatus(status) {
  return {
    enabled: Boolean(status.enabled),
    connected: Boolean(status.connected),
    baseUrl: status.baseUrl || '',
    rootDirectory: status.rootDirectory || '',
    writable: Boolean(status.writable),
    latencyMs: Number(status.latencyMs || 0),
    checkedAt: status.checkedAt || new Date().toISOString(),
    error: status.error || null
  };
}

export const zspaceStorageRouter = Router();

zspaceStorageRouter.get('/status', requireZSpaceAdmin, async (req, res) => {
  const service = req.app.locals.zspaceClient;
  if (service?.initError) {
    res.json(safeStatus({
      enabled: false,
      connected: false,
      writable: false,
      checkedAt: new Date().toISOString(),
      error: service.initError
    }));
    return;
  }
  if (!service?.testConnection) {
    res.status(500).json({ message: '极空间存储服务未初始化' });
    return;
  }
  res.json(safeStatus(await service.testConnection()));
});
