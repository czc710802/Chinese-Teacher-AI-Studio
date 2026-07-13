import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { requireUser, roleGuard } from '../middleware/auth.js';
import {
  importBenchmarkDataset,
  listBenchmarkDatasets,
  readBenchmarkDataset
} from '../services/benchmark/dataset-manager.js';
import {
  benchmarkStatus,
  runBenchmark,
  saveTeacherReview
} from '../services/benchmark/benchmark-runner.js';
import { benchmarkPaths, ensureBenchmarkDirectories } from '../services/benchmark/benchmark-config.js';

export const benchmarkRouter = Router();

benchmarkRouter.use(requireUser, roleGuard('teacher', 'admin'));

benchmarkRouter.get('/status', (req, res) => {
  res.json(benchmarkStatus({ appDir: req.app.locals.appDir }));
});

benchmarkRouter.get('/datasets', (req, res) => {
  res.json(listBenchmarkDatasets({ appDir: req.app.locals.appDir, ...req.query }));
});

benchmarkRouter.get('/datasets/:id', (req, res) => {
  const dataset = readBenchmarkDataset({ appDir: req.app.locals.appDir, id: req.params.id });
  if (!dataset) return res.status(404).json({ message: 'Benchmark 样本不存在' });
  res.json(dataset);
});

benchmarkRouter.post('/import', (req, res, next) => {
  try {
    const dataset = importBenchmarkDataset({
      appDir: req.app.locals.appDir,
      input: req.body?.dataset || req.body,
      sourceType: req.body?.sourceType || 'json'
    });
    res.json({ ok: true, dataset });
  } catch (error) {
    next(error);
  }
});

benchmarkRouter.post('/run', async (req, res, next) => {
  try {
    const result = await runBenchmark({
      appDir: req.app.locals.appDir,
      providerNames: req.body?.providerNames,
      mock: req.body?.mock !== false,
      notifyFeishu: Boolean(req.body?.notifyFeishu),
      feishuService: req.app.locals.feishuService
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

benchmarkRouter.post('/review/:id', (req, res, next) => {
  try {
    res.json({ ok: true, review: saveTeacherReview({ appDir: req.app.locals.appDir, datasetId: req.params.id, review: req.body }) });
  } catch (error) {
    next(error);
  }
});

benchmarkRouter.get('/reports/latest', (req, res) => {
  const paths = ensureBenchmarkDirectories({ appDir: req.app.locals.appDir });
  const summaryFile = path.join(paths.result, 'summary.json');
  res.json({
    summary: fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : null,
    exports: fs.existsSync(paths.export) ? fs.readdirSync(paths.export).filter((file) => file.startsWith('Benchmark_Report')) : []
  });
});

benchmarkRouter.get('/download/:file', (req, res) => {
  const paths = benchmarkPaths({ appDir: req.app.locals.appDir });
  const fileName = path.basename(req.params.file);
  if (!/^Benchmark_Report\.(md|docx|pdf|csv|xlsx|zip)$/.test(fileName)) {
    return res.status(400).json({ message: '不支持的 Benchmark 导出文件' });
  }
  const filePath = path.join(paths.export, fileName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'Benchmark 导出文件不存在' });
  const mime = fileName.endsWith('.pdf') ? 'application/pdf'
    : fileName.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : fileName.endsWith('.zip') ? 'application/zip'
        : fileName.endsWith('.xlsx') ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/markdown; charset=utf-8';
  res.setHeader('content-type', mime);
  res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.send(fs.readFileSync(filePath));
});
