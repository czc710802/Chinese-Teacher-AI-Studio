import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';

import { analyzeEssay, downloadEssayReport, getEssayResult, listEssayHistory, uploadEssayFiles, isSupportedEssayUploadFile, ensureEssayAiDirs } from '../../../apps/essay-ai/src/index.js';

function getAppDir(req) {
  return req?.app?.locals?.appDir || path.resolve(process.cwd());
}

function createUploadMiddleware(appDir) {
  const { uploadsDir } = ensureEssayAiDirs(appDir);
  const storage = multer.diskStorage({
    destination(_req, _file, cb) {
      cb(null, uploadsDir);
    },
    filename(_req, file, cb) {
      const safeName = `${Date.now()}-${String(file.originalname || 'essay-upload').replace(/[^\w.\-]+/g, '_')}`;
      cb(null, safeName);
    }
  });

  return multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024, files: 8 },
    fileFilter(_req, file, cb) {
      if (isSupportedEssayUploadFile(file)) {
        cb(null, true);
        return;
      }
      cb(new Error('仅支持图片、txt、doc、docx、pdf 文件'));
    }
  });
}

function serializeFiles(files = []) {
  return files.map((file) => ({
    fieldname: file.fieldname,
    filename: file.originalname || file.filename,
    mimetype: file.mimetype,
    size: file.size,
    path: file.path,
    publicPath: `/uploads/essay-ai/${path.basename(file.path)}`
  }));
}

export const essayRouter = Router();

essayRouter.post('/analyze', async (req, res, next) => {
  try {
    const result = await analyzeEssay({
      appDir: getAppDir(req),
      title: req.body?.title,
      text: req.body?.text || req.body?.essayText || '',
      source: req.body?.source || 'api',
      storageService: req.app.locals.storageService,
      logger: req.app.locals.logger || console
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

essayRouter.post('/upload', (req, res, next) => {
  const appDir = getAppDir(req);
  const upload = createUploadMiddleware(appDir);
  upload.any()(req, res, async (error) => {
    if (error) {
      next(error);
      return;
    }

    try {
      const files = serializeFiles(req.files || []);
      if (!files.length && !String(req.body?.text || '').trim()) {
        res.status(400).json({ ok: false, message: '请先上传作文图片或文件' });
        return;
      }

      const result = await uploadEssayFiles({
        appDir,
        title: req.body?.title,
        text: req.body?.text || '',
        source: req.body?.source || 'upload',
        files: req.files || [],
        storageService: req.app.locals.storageService,
        logger: req.app.locals.logger || console
      });
      res.json({
        ...result,
        files
      });
    } catch (err) {
      next(err);
    }
  });
});

essayRouter.get('/result/:id', (req, res) => {
  const result = getEssayResult({ appDir: getAppDir(req), id: req.params.id });
  if (!result) {
    res.status(404).json({ ok: false, message: '批改记录不存在' });
    return;
  }
  res.json(result);
});

essayRouter.get('/history', (req, res) => {
  res.json(listEssayHistory({ appDir: getAppDir(req), limit: 20 }));
});

essayRouter.get('/download/:id', (req, res) => {
  const format = String(req.query.format || 'md').trim().toLowerCase();
  const download = downloadEssayReport({ appDir: getAppDir(req), id: req.params.id, format });
  if (!download.ok) {
    res.status(download.statusCode || 500).json(download.body);
    return;
  }

  if (download.contentType) {
    res.setHeader('content-type', download.contentType);
  }
  if (download.filename) {
    res.setHeader('content-disposition', `attachment; filename="${download.filename}"`);
  }
  if (typeof download.body === 'string') {
    res.send(download.body);
    return;
  }
  res.json(download.body);
});
