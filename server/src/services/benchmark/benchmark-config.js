import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '../../../..');
const configFile = path.join(appRoot, 'benchmark', 'config', 'benchmark.config.js');
const schemaFile = path.join(appRoot, 'benchmark', 'config', 'benchmark-dataset.schema.json');

export function benchmarkPaths({ appDir = appRoot, config } = {}) {
  const outputDirs = config?.outputDirs || {
    history: 'benchmark/history',
    reports: 'benchmark/reports',
    result: 'benchmark/result',
    charts: 'benchmark/charts',
    export: 'benchmark/export',
    logs: 'benchmark/logs',
    config: 'benchmark/config'
  };
  return Object.fromEntries(Object.entries(outputDirs).map(([key, relative]) => [key, path.join(appDir, relative)]));
}

export function ensureBenchmarkDirectories({ appDir = appRoot, config } = {}) {
  const paths = benchmarkPaths({ appDir, config });
  for (const dir of Object.values(paths)) fs.mkdirSync(dir, { recursive: true });
  return paths;
}

export function loadBenchmarkSchema({ appDir = appRoot } = {}) {
  const target = path.join(appDir, 'benchmark', 'config', 'benchmark-dataset.schema.json');
  const file = fs.existsSync(target) ? target : schemaFile;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadBenchmarkConfig({ appDir = appRoot, overrides = {} } = {}) {
  const fallback = {
    version: '1.0',
    enabledModels: ['mock'],
    outputDirs: {
      history: 'benchmark/history',
      reports: 'benchmark/reports',
      result: 'benchmark/result',
      charts: 'benchmark/charts',
      export: 'benchmark/export',
      logs: 'benchmark/logs',
      config: 'benchmark/config'
    },
    scoring: {
      dimensions: ['批改深度', '教师价值', '逻辑分析', '语言分析', '素材分析', '修改质量', '成长指导', '可操作性'],
      weights: {}
    },
    exports: ['word', 'pdf', 'markdown', 'excel', 'csv', 'zip'],
    anonymization: { enabled: true, prefix: 'anon' },
    charts: { theme: 'teacher-green', imageWidth: 1200, imageHeight: 800 },
    retry: { maxRetries: 2, backoffMs: 1000 },
    logLevel: 'info'
  };
  let loaded = fallback;
  try {
    const localConfig = path.join(appDir, 'benchmark', 'config', 'benchmark.config.js');
    const source = fs.existsSync(localConfig) ? localConfig : configFile;
    if (fs.existsSync(source)) {
      const url = `${pathToFileURL(source).href}?t=${fs.statSync(source).mtimeMs}`;
      loaded = globalThis.__benchmarkConfigCache?.[url] || loaded;
    }
  } catch {
    loaded = fallback;
  }
  return {
    ...fallback,
    ...loaded,
    ...overrides,
    outputDirs: { ...fallback.outputDirs, ...(loaded.outputDirs || {}), ...(overrides.outputDirs || {}) },
    scoring: { ...fallback.scoring, ...(loaded.scoring || {}), ...(overrides.scoring || {}) },
    anonymization: { ...fallback.anonymization, ...(loaded.anonymization || {}), ...(overrides.anonymization || {}) },
    charts: { ...fallback.charts, ...(loaded.charts || {}), ...(overrides.charts || {}) },
    retry: { ...fallback.retry, ...(loaded.retry || {}), ...(overrides.retry || {}) }
  };
}

const requiredDatasetFields = [
  'id',
  'title',
  'authorId',
  'grade',
  'className',
  'wordCount',
  'originalEssay',
  'oldReport',
  'newReport',
  'compareResult',
  'benchmarkScore',
  'createdAt',
  'updatedAt'
];

export function validateBenchmarkDataset(dataset = {}) {
  const errors = [];
  for (const field of requiredDatasetFields) {
    if (!Object.prototype.hasOwnProperty.call(dataset, field)) errors.push(`${field} is required`);
  }
  if (typeof dataset.id !== 'string' || !dataset.id.trim()) errors.push('id must be a non-empty string');
  if (!Number.isInteger(dataset.wordCount) || dataset.wordCount < 0) errors.push('wordCount must be a non-negative integer');
  if (typeof dataset.originalEssay !== 'string') errors.push('originalEssay must be a string');
  return { ok: errors.length === 0, errors };
}

export function appendBenchmarkLog({ appDir = appRoot, message, level = 'info', details = {} } = {}) {
  const paths = ensureBenchmarkDirectories({ appDir });
  const safeDetails = { ...details };
  for (const key of Object.keys(safeDetails)) {
    if (/token|secret|password|authorization|api.?key|cookie/i.test(key)) delete safeDetails[key];
  }
  const line = {
    at: new Date().toISOString(),
    level,
    message,
    details: safeDetails
  };
  fs.appendFileSync(path.join(paths.logs, 'benchmark.log'), `${JSON.stringify(line)}\n`, 'utf8');
  return line;
}
