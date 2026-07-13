import { Router } from 'express';
import { db } from '../db/connection.js';
import { requireUser } from '../middleware/auth.js';
import {
  archiveEssayToNAS,
  deleteArchiveFromNAS,
  getArchiveRecord,
  listArchiveRecords
} from '../services/archive-pipeline.js';

export const archiveRouter = Router();
archiveRouter.use(requireUser);

function canAccessRecord(user, record) {
  if (!record) return false;
  if (user.role === 'teacher') return true;
  return String(record.studentUserId || '') === String(user.id || '');
}

archiveRouter.post('/save', async (req, res, next) => {
  try {
    const essayId = req.body?.essayId || req.body?.essay_id;
    if (!essayId) return res.status(400).json({ message: '请提供作文 ID' });
    const result = await archiveEssayToNAS({
      appDir: req.app.locals.appDir,
      database: db,
      essayId,
      client: req.app.locals.zspaceClient,
      logger: req.app.locals.logger || console
    });
    res.json({
      ok: result.ok,
      queued: result.queued,
      files: result.files,
      archive: result.record,
      message: result.queued ? 'NAS 暂时不可用，已写入本地待同步队列。' : '归档已保存到 NAS。'
    });
  } catch (error) {
    next(error);
  }
});

archiveRouter.get('/list', (req, res) => {
  let rows = listArchiveRecords(req.app.locals.appDir, req.query);
  if (req.user.role === 'student') {
    rows = rows.filter((record) => String(record.studentUserId || '') === String(req.user.id || ''));
  }
  res.json({ items: rows, total: rows.length });
});

archiveRouter.get('/detail/:id', (req, res) => {
  const record = getArchiveRecord(req.app.locals.appDir, req.params.id);
  if (!canAccessRecord(req.user, record)) return res.status(404).json({ message: '未找到归档记录' });
  if (req.query.file) {
    const fileName = String(req.query.file || '');
    const file = (record.files || []).find((item) => item.name === fileName || item.remotePath === fileName);
    if (!file) return res.status(404).json({ message: '未找到归档文件' });
    const client = req.app.locals.zspaceClient;
    if (!client?.config?.enabled || typeof client.downloadFile !== 'function') return res.status(503).json({ message: 'NAS 下载服务暂时不可用' });
    client.downloadFile(file.remotePath).then((buffer) => {
      res.setHeader('content-type', file.contentType || 'application/octet-stream');
      res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name || 'archive-file')}`);
      res.send(buffer);
    }).catch(() => {
      res.status(502).json({ message: 'NAS 文件下载失败，请稍后重试' });
    });
    return;
  }
  res.json(record);
});

archiveRouter.delete('/:id', async (req, res, next) => {
  try {
    const record = getArchiveRecord(req.app.locals.appDir, req.params.id);
    if (!canAccessRecord(req.user, record)) return res.status(404).json({ message: '未找到归档记录' });
    const result = await deleteArchiveFromNAS({
      appDir: req.app.locals.appDir,
      id: req.params.id,
      client: req.app.locals.zspaceClient,
      logger: req.app.locals.logger || console
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});
