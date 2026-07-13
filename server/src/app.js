import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { authRouter } from './routes/auth.js';
import { classRouter } from './routes/classes.js';
import { assignmentRouter } from './routes/assignments.js';
import { essayRouter } from './routes/essays.js';
import { reportRouter } from './routes/reports.js';
import { analyticsRouter } from './routes/analytics.js';
import { aiTutorRouter } from './routes/ai-tutor.js';
import { essayRouter as essayAiRouter } from './routes/essay.js';
import { storageRouter } from './routes/storage.js';
import { zspaceStorageRouter } from './routes/zspace-storage.js';
import { archiveRouter } from './routes/archive.js';
import { fileAccessRouter, publicReportRouter } from './routes/files.js';
import { studentProfileRouter } from './routes/student-profiles.js';
import { studentManagementRouter, teacherManagementRouter } from './routes/teacher-management.js';
import { benchmarkRouter } from './routes/benchmark.js';
import { adminFeishuRouter, teacherFeishuRouter } from './routes/feishu-workbench.js';
import { getAiStatus } from './services/openai.js';
import { classifyAIError } from './services/ai/client-factory.js';
import { createAIRouter } from './services/ai/ai-router.js';
import { getPublicAccessStatus } from './services/public-access.js';
import { getSystemStatus } from './services/system-status.js';
import { getSystemLogs } from './services/system-logs.js';
import { getLatestDailyReport } from './services/system-daily-report.js';
import { triggerBackup } from './services/system-backup.js';
import { confirmRestart } from './services/system-restart.js';
import { loadFeishuConfig } from './integrations/feishu/config.js';
import { verifyFeishuEvent } from './integrations/feishu/verify.js';
import { routeFeishuEvent } from './integrations/feishu/messageRouter.js';
import { createFeishuService, getFeishuHealthSnapshot } from './integrations/feishu/service.js';
import { createStorageService } from './storage/storage-service.js';
import { createZSpaceClient } from './services/zspace-storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function isLocalDevOrigin(origin) {
  return /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):(5173|4000)$/.test(origin);
}

function clientSafeErrorMessage(error) {
  const message = String(error?.message || '');
  if (/(OpenAI|DeepSeek) API 调用失败|invalid[_ ]api[_ ]key|Incorrect API key|authentication_error|insufficient_quota/i.test(message)) {
    return 'AI 服务暂时不可用，请稍后重试或联系老师检查服务配置。';
  }
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
    .replace(/your-[A-Za-z0-9_*.-]+-key/gi, '***key')
    || '服务器内部错误';
}

function isLikelyAIError(error) {
  const message = String(error?.message || '');
  return error?.name === 'AIServiceError' || /(OpenAI|DeepSeek) API 调用失败|invalid[_ ]api[_ ]key|Incorrect API key|authentication_error|AI 服务/i.test(message);
}

export function createApp({
  env = process.env,
  appDir = path.resolve(__dirname, '../..'),
  startTime = Date.now(),
  logger = console,
  zspaceClient,
  aiRouterFactory = createAIRouter
} = {}) {
  const app = express();
  app.locals.appDir = appDir;
  app.locals.env = env;
  const storageService = createStorageService({ env, appDir, logger });
  app.locals.storageService = storageService;
  if (storageService.rawConfig.enabled && env.NODE_ENV !== 'test' && env.NAS_AUTO_SYNC !== 'false') {
    storageService.startSyncScheduler();
  }
  try {
    app.locals.zspaceClient = zspaceClient || createZSpaceClient({ env, logger });
    if (app.locals.zspaceClient?.config?.enabled && env.NODE_ENV !== 'test' && env.ZSPACE_AUTO_SYNC !== 'false') {
      app.locals.zspaceClient.startPendingUploadScheduler?.({
        appDir,
        intervalMs: Number(env.ZSPACE_SYNC_INTERVAL_MS || 60000)
      });
    }
  } catch (error) {
    app.locals.zspaceClient = { initError: error.message };
  }
  const feishuService = createFeishuService({ env, appDir, logger, zspaceClient: app.locals.zspaceClient });
  app.locals.feishuService = feishuService;
  const publicAppOrigin = env.PUBLIC_APP_ORIGIN;

  app.use(cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (origin === publicAppOrigin) return callback(null, true);
      if (isLocalDevOrigin(origin)) return callback(null, true);
      return callback(new Error(`CORS 不允许该来源：${origin}`));
    }
  }));
  app.use(express.json({
    limit: '20mb',
    verify(req, _res, buf) {
      req.rawBody = buf?.length ? buf.toString('utf8') : '';
    }
  }));
  app.use('/uploads', express.static(path.resolve(__dirname, '../uploads')));
  app.use('/exports', express.static(path.resolve(__dirname, '../exports')));

  app.get('/api/health', (_req, res) => {
    const aiStatus = getAiStatus();
    res.json({ ok: true, name: '高中作文 AI 批改 App', aiReady: aiStatus.textReady, aiStatus });
  });

  app.get('/api/admin/ai/status', async (_req, res) => {
    try {
      const router = aiRouterFactory({ env, logger });
      res.json(await router.getRouterStatus({ checkConnections: true }));
    } catch (error) {
      const classified = classifyAIError(error);
      res.status(200).json({
        routerEnabled: true,
        ready: false,
        degraded: false,
        primaryProvider: env.AI_PRIMARY_PROVIDER || env.AI_PROVIDER || 'unknown',
        fallbackProvider: env.AI_FALLBACK_PROVIDER || '',
        providers: {},
        routes: {},
        checkedAt: new Date().toISOString(),
        errorCode: classified.code,
        message: classified.message
      });
    }
  });

  app.get('/api/public-access', (_req, res) => {
    res.json(getPublicAccessStatus({ appDir, env }));
  });

  app.get('/api/feishu/health', (_req, res) => {
    const config = loadFeishuConfig(env);
    const snapshot = getFeishuHealthSnapshot({ service: feishuService });
    res.json({
      ...snapshot,
      ok: true,
      appConfigured: config.appConfigured,
      webhookConfigured: config.webhookConfigured,
      feishuFileUploadEnabled: config.fileUploadEnabled
    });
  });

  app.get('/api/system/status', (_req, res) => {
    res.json(getSystemStatus({ appDir, env, startTime, logger }));
  });

  app.get('/api/system/logs', (_req, res) => {
    res.json(getSystemLogs({ appDir }));
  });

  app.get('/api/system/daily-report', (_req, res) => {
    res.json(getLatestDailyReport({ appDir }));
  });

  app.post('/api/system/backup', (_req, res) => {
    res.json(triggerBackup({ appDir }));
  });

  app.post('/api/system/restart/confirm', (req, res) => {
    const { token = '' } = req.body || {};
    const config = loadFeishuConfig(env);
    res.json(confirmRestart({ appDir, token, expectedToken: config.restartConfirmToken }));
  });

  async function handleFeishuHttpEvent(req, res, next) {
    try {
      const verification = verifyFeishuEvent({ body: req.body, env, headers: req.headers, rawBody: req.rawBody || '' });
      if (verification) {
        res.status(verification.statusCode).json(verification.body);
        return;
      }

      const result = await routeFeishuEvent({ body: req.body, env, appDir, logger, zspaceClient: req.app.locals.zspaceClient });
      res.status(result.statusCode || 200).json(result.body || { ok: true });
    } catch (error) {
      next(error);
    }
  }

  app.post('/api/feishu/events', handleFeishuHttpEvent);
  app.post('/api/feishu/webhook', handleFeishuHttpEvent);

  app.use('/api/auth', authRouter);
  app.use('/api/classes', classRouter);
  app.use('/api/assignments', assignmentRouter);
  app.use('/api/essay', essayAiRouter);
  app.use('/api/essays', essayRouter);
  app.use('/api/reports', reportRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/ai', aiTutorRouter);
  app.use('/api/storage', storageRouter);
  app.use('/api/archive', archiveRouter);
  app.use('/api/files', fileAccessRouter);
  app.use('/api/student-profiles', studentProfileRouter);
  app.use('/api/benchmark', benchmarkRouter);
  app.use('/api/teacher', teacherManagementRouter);
  app.use('/api/teacher/feishu', teacherFeishuRouter);
  app.use('/api/students', studentManagementRouter);
  app.use('/api/admin/feishu', adminFeishuRouter);
  app.use('/api/admin/storage/zspace', zspaceStorageRouter);
  app.use('/report', publicReportRouter);

  const clientDist = path.resolve(appDir, 'client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path.startsWith('/exports/') || req.path.startsWith('/uploads/')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  app.use((err, _req, res, _next) => {
    logger.error?.(err);
    const classified = classifyAIError(err);
    if (isLikelyAIError(err)) {
      res.status(classified.status || 502).json({
        message: classified.message,
        errorCode: classified.code,
        requestId: classified.requestId || undefined
      });
      return;
    }
    res.status(500).json({ message: clientSafeErrorMessage(err) });
  });

  process.on('uncaughtException', (err) => {
    logger.error?.('[未捕获异常]', err);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error?.('[未处理拒绝]', reason);
  });

  return app;
}
