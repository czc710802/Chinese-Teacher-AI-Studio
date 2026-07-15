import { Router } from 'express';

import {
  applyRange,
  auditFileAccess,
  buildArchiveDownloadLinks,
  contentDispositionFilename,
  createSignedDownloadUrl,
  getArchiveFileDescriptor,
  normalizeFileType,
  renderReportHtml,
  verifySignedDownloadToken
} from '../services/file-access.js';
import { requireUser } from '../middleware/auth.js';

export const fileAccessRouter = Router();
export const publicReportRouter = Router();

function sendError(res, statusCode, message, errorCode) {
  res.status(statusCode).json({ message, errorCode });
}

async function downloadArchiveFile(req, res) {
  const appDir = req.app.locals.appDir;
  let fileType;
  try {
    fileType = normalizeFileType(req.params.fileType);
  } catch (error) {
    sendError(res, error.statusCode || 400, error.message || '文件类型无效', 'INVALID_FILE_TYPE');
    return;
  }

  const tokenStatus = verifySignedDownloadToken({
    archiveId: req.params.archiveId,
    fileType,
    token: req.query.token,
    env: req.app.locals.env || process.env
  });
  if (!tokenStatus.ok) {
    auditFileAccess(appDir, tokenStatus.statusCode === 410 ? 'download.expired' : 'download.denied', {
      archiveId: req.params.archiveId,
      fileType,
      statusCode: tokenStatus.statusCode,
      result: 'failure',
      message: tokenStatus.code
    });
    sendError(res, tokenStatus.statusCode, tokenStatus.message, tokenStatus.code);
    return;
  }

  try {
    const descriptor = getArchiveFileDescriptor({ appDir, archiveId: req.params.archiveId, fileType });
    const client = req.app.locals.zspaceClient;
    if (!descriptor.file.inlineBuffer && (!client?.config?.enabled || typeof client.downloadFile !== 'function')) {
      sendError(res, 503, 'NAS 下载服务暂时不可用', 'NAS_UNAVAILABLE');
      return;
    }
    const buffer = descriptor.file.inlineBuffer || await client.downloadFile(descriptor.file.remotePath);
    const range = applyRange(buffer, req.headers.range);
    res.setHeader('accept-ranges', 'bytes');
    res.setHeader('content-type', descriptor.contentType);
    res.setHeader('content-disposition', contentDispositionFilename(descriptor.record, descriptor.file));
    if (range?.invalid) {
      res.setHeader('content-range', `bytes */${range.total}`);
      res.status(416).send('');
      return;
    }
    if (range) {
      res.status(206);
      res.setHeader('content-range', `bytes ${range.start}-${range.end}/${range.total}`);
      res.setHeader('content-length', String(range.buffer.length));
      res.send(range.buffer);
      auditFileAccess(appDir, 'download.success', { archiveId: descriptor.record.id, fileType, actorId: tokenStatus.userId, statusCode: 206, result: 'success' });
      return;
    }
    res.setHeader('content-length', String(buffer.length));
    res.send(buffer);
    auditFileAccess(appDir, 'download.success', { archiveId: descriptor.record.id, fileType, actorId: tokenStatus.userId, statusCode: 200, result: 'success' });
  } catch (error) {
    auditFileAccess(appDir, 'download.failed', {
      archiveId: req.params.archiveId,
      fileType,
      statusCode: error.statusCode || 502,
      result: 'failure',
      message: error.message
    });
    sendError(res, error.statusCode || 502, error.statusCode === 404 ? error.message : '归档文件下载失败，请稍后重试', error.statusCode === 404 ? 'FILE_NOT_FOUND' : 'FILE_DOWNLOAD_FAILED');
  }
}

fileAccessRouter.get('/:archiveId/:fileType', downloadArchiveFile);

fileAccessRouter.post('/:archiveId/regenerate-link', requireUser, (req, res) => {
  try {
    const fileType = normalizeFileType(req.body?.fileType || req.query.fileType || 'pdf');
    const url = createSignedDownloadUrl({
      archiveId: req.params.archiveId,
      fileType,
      userId: `user-${req.user.id}`,
      env: req.app.locals.env || process.env
    });
    auditFileAccess(req.app.locals.appDir, 'download.link.regenerated', {
      archiveId: req.params.archiveId,
      fileType,
      actorId: String(req.user.id),
      result: 'success'
    });
    res.json({ ok: true, fileType, url });
  } catch (error) {
    sendError(res, error.statusCode || 400, error.message || '重新生成链接失败', 'LINK_REGENERATE_FAILED');
  }
});

publicReportRouter.get('/:archiveId', async (req, res) => {
  const appDir = req.app.locals.appDir;
  const tokenStatus = verifySignedDownloadToken({
    archiveId: req.params.archiveId,
    fileType: 'report-page',
    token: req.query.token,
    env: req.app.locals.env || process.env
  });
  if (!tokenStatus.ok) {
    auditFileAccess(appDir, tokenStatus.statusCode === 410 ? 'report.expired' : 'report.denied', {
      archiveId: req.params.archiveId,
      fileType: 'report-page',
      statusCode: tokenStatus.statusCode,
      result: 'failure',
      message: tokenStatus.code
    });
    res.status(tokenStatus.statusCode).type('text/html; charset=utf-8').send(`<!doctype html><meta charset="utf-8"><title>链接不可用</title><main style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:24px"><h1>链接不可用</h1><p>${tokenStatus.message}</p></main>`);
    return;
  }
  try {
    const descriptor = getArchiveFileDescriptor({ appDir, archiveId: req.params.archiveId, fileType: 'json' });
    const client = req.app.locals.zspaceClient;
    const reportBuffer = descriptor.file.inlineBuffer;
    if (!reportBuffer && (!client?.config?.enabled || typeof client.downloadFile !== 'function')) {
      res.status(503).type('text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><h1>NAS 下载服务暂时不可用</h1>');
      return;
    }
    const jsonBuffer = reportBuffer || await client.downloadFile(descriptor.file.remotePath);
    const reportJson = JSON.parse(jsonBuffer.toString('utf8'));
    const publicOrigin = String(req.app.locals.env?.PUBLIC_APP_ORIGIN || req.app.locals.env?.FEISHU_REPORT_PUBLIC_BASE_URL || 'https://pi.zhenwanyue.icu').replace(/\/+$/, '');
    const essayId = String(descriptor.record?.essayId || reportJson?.essayId || reportJson?.essay?.id || '').trim();
    const reportId = String(reportJson?.metadata?.reportId || reportJson?.reportId || descriptor.record?.reportId || '').trim();
    const links = await buildArchiveDownloadLinks({
      appDir,
      archiveId: descriptor.record.id,
      userId: tokenStatus.userId,
      env: req.app.locals.env || process.env,
      client
    });
    res.type('text/html; charset=utf-8').send(renderReportHtml({
      record: descriptor.record,
      reportJson,
      links: {
        ...links,
        teacherEssayUrl: essayId ? `${publicOrigin}/teacher/essays/${encodeURIComponent(essayId)}` : '',
        studentReportUrl: essayId ? `${publicOrigin}/student/essays/${encodeURIComponent(essayId)}/report${reportId ? `?reportId=${encodeURIComponent(reportId)}` : ''}` : ''
      }
    }));
    auditFileAccess(appDir, 'report.view.success', { archiveId: descriptor.record.id, fileType: 'report-page', actorId: tokenStatus.userId, statusCode: 200, result: 'success' });
  } catch (error) {
    auditFileAccess(appDir, 'report.view.failed', { archiveId: req.params.archiveId, fileType: 'report-page', statusCode: error.statusCode || 502, result: 'failure', message: error.message });
    res.status(error.statusCode || 502).type('text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><h1>报告暂不可用</h1><p>请稍后重试或联系老师重新生成链接。</p>');
  }
});
