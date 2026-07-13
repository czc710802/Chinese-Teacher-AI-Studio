import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createApp } from '../src/app.js';
import {
  ensureBenchmarkDirectories,
  benchmarkPaths,
  loadBenchmarkConfig,
  validateBenchmarkDataset
} from '../src/services/benchmark/benchmark-config.js';
import {
  importBenchmarkDataset,
  listBenchmarkDatasets,
  readBenchmarkDataset
} from '../src/services/benchmark/dataset-manager.js';
import {
  createProviderAdapter,
  listProviderAdapters
} from '../src/services/benchmark/provider-adapters.js';
import {
  compareReports,
  scoreBenchmarkComparison
} from '../src/services/benchmark/scoring.js';
import {
  runBenchmark,
  saveTeacherReview
} from '../src/services/benchmark/benchmark-runner.js';

function tempAppDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-center-'));
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function invoke(app, { method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const { Readable } = await import('node:stream');
  return await new Promise((resolve, reject) => {
    const req = new Readable({ read() {} });
    req.method = method;
    req.url = url;
    req.headers = headers;
    req.socket = {};
    process.nextTick(() => {
      if (body) req.push(typeof body === 'string' ? body : JSON.stringify(body));
      req.push(null);
    });
    const res = {
      statusCode: 200,
      headers: {},
      chunks: [],
      setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
      getHeader(name) { return this.headers[String(name).toLowerCase()]; },
      removeHeader(name) { delete this.headers[String(name).toLowerCase()]; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.setHeader('content-type', 'application/json; charset=utf-8'); this.end(JSON.stringify(payload)); },
      send(payload) { this.end(Buffer.isBuffer(payload) ? payload : String(payload)); },
      write(chunk) { this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); },
      end(chunk) {
        if (chunk) this.write(chunk);
        resolve({ statusCode: this.statusCode, headers: this.headers, body: Buffer.concat(this.chunks) });
      }
    };
    try {
      app.handle(req, res, (err) => (err ? reject(err) : resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(res.chunks) })));
    } catch (error) {
      reject(error);
    }
  });
}

function sampleDataset(overrides = {}) {
  return {
    title: '青年责任',
    authorId: '20260301',
    grade: '高二',
    className: '3班',
    originalEssay: '青年应当把个人选择放在时代责任之中。唯有把小我融入大我，选择才有方向。',
    oldReport: {
      overall: '旧平台能够指出文章立意积极，但分析较短。',
      topicIntentAnalysis: '审题基本准确。',
      structureAnalysis: '结构完整。',
      logicAnalysis: '逻辑尚可。',
      languageAnalysis: '语言通顺。',
      materialAnalysis: '素材一般。',
      argumentAnalysis: '论证较浅。',
      teacherComment: '继续努力。',
      revisionSuggestions: ['补充论证'],
      growthSuggestions: ['训练审题']
    },
    ...overrides
  };
}

test('benchmark config creates isolated directories and validates unified BenchmarkDataset schema', () => {
  const appDir = tempAppDir();
  const config = loadBenchmarkConfig({ appDir });
  const dirs = ensureBenchmarkDirectories({ appDir, config });

  for (const dir of ['history', 'reports', 'result', 'charts', 'export', 'logs', 'config']) {
    assert.equal(fs.existsSync(dirs[dir]), true);
  }
  assert.equal(config.scoring.dimensions.includes('逻辑分析'), true);
  assert.equal(config.enabledModels.includes('mock'), true);

  const valid = validateBenchmarkDataset({
    id: 'bench-1',
    title: '题目',
    authorId: 'anon-1',
    grade: '高二',
    className: '3班',
    wordCount: 12,
    originalEssay: '正文',
    oldReport: {},
    newReport: null,
    compareResult: null,
    benchmarkScore: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  assert.equal(valid.ok, true);
  assert.equal(validateBenchmarkDataset({ id: 'bad' }).ok, false);
});

test('dataset manager imports JSON, TXT and Markdown with anonymous stable ids', () => {
  const appDir = tempAppDir();
  const jsonRecord = importBenchmarkDataset({ appDir, input: sampleDataset(), sourceType: 'json' });
  const txtRecord = importBenchmarkDataset({
    appDir,
    input: '题目：时代青年\n年级：高三\n班级：1班\n青年要回应时代。',
    sourceType: 'txt'
  });
  const mdRecord = importBenchmarkDataset({
    appDir,
    input: '# 选择与责任\n\n旧平台报告：文章有现实意义。\n\n正文：青年选择不能离开时代需要。',
    sourceType: 'markdown'
  });

  assert.equal(jsonRecord.authorId.startsWith('anon-'), true);
  assert.equal(jsonRecord.wordCount > 0, true);
  assert.equal(txtRecord.grade, '高三');
  assert.equal(txtRecord.className, '1班');
  assert.equal(mdRecord.title, '选择与责任');

  const list = listBenchmarkDatasets({ appDir });
  assert.equal(list.total, 3);
  assert.equal(readBenchmarkDataset({ appDir, id: jsonRecord.id }).id, jsonRecord.id);
});

test('provider adapters isolate model calls and keep benchmark runner independent from concrete SDKs', async () => {
  const providers = listProviderAdapters();
  assert.deepEqual(providers.sort(), ['custom', 'deepseek', 'gemini', 'mock', 'openai'].sort());

  const mock = createProviderAdapter('mock', { latencyMs: 1 });
  const result = await mock.gradeEssay({
    dataset: sampleDataset({ title: 'Provider测试' }),
    taskType: 'essay_grading'
  });
  assert.equal(result.provider, 'mock');
  assert.equal(result.report.title, 'Provider测试');
  assert.ok(result.report.logicAnalysis);

  const openai = createProviderAdapter('openai', { enabled: false });
  assert.equal(openai.isConfigured(), false);
});

test('comparison and scoring produce 0-10 dimension scores, totals and improvement rate', () => {
  const oldReport = sampleDataset().oldReport;
  const newReport = {
    overall: '新报告有更完整的总体评价，能解释为什么是该等级。',
    topicIntentAnalysis: '审题立意展开更完整，能指出关键词关系。',
    structureAnalysis: '结构分析覆盖开头、主体、过渡和结尾。',
    logicAnalysis: '逻辑分析能够解释观点、论据、论证链和概念界定。',
    languageAnalysis: '语言分析覆盖句式、节奏、修辞和口语化问题。',
    materialAnalysis: '素材分析能推荐替代素材。',
    argumentAnalysis: '论证分析更具体。',
    teacherComment: '教师评语有针对性。',
    revisionSuggestions: ['逐段补出因果分析', '替换素材并回扣论点'],
    growthSuggestions: ['7天逻辑训练', '素材迁移训练']
  };
  const compare = compareReports({ oldReport, newReport });
  const score = scoreBenchmarkComparison(compare);

  assert.equal(Object.keys(compare.dimensions).length, 10);
  assert.equal(score.dimensions['逻辑分析'] >= 0, true);
  assert.equal(score.totalScore > 0, true);
  assert.equal(score.averageScore >= 0 && score.averageScore <= 10, true);
  assert.equal(Number.isFinite(score.improvementRate), true);
});

test('runBenchmark creates reports, charts, exports, summary, retry-safe result and teacher review', async () => {
  const appDir = tempAppDir();
  const dataset = importBenchmarkDataset({ appDir, input: sampleDataset(), sourceType: 'json' });
  const result = await runBenchmark({
    appDir,
    providerNames: ['mock'],
    mock: true,
    notifyFeishu: false
  });
  const paths = benchmarkPaths({ appDir });

  assert.equal(result.success, true);
  assert.equal(result.summary.samples, 1);
  assert.equal(Array.isArray(result.history), true);
  assert.equal(result.summary.successCount, 1);
  assert.equal(result.summary.failureCount, 0);
  assert.equal(fs.existsSync(path.join(paths.reports, dataset.id, 'new_report.json')), true);
  assert.equal(fs.existsSync(path.join(paths.reports, dataset.id, 'compare.json')), true);
  assert.equal(fs.existsSync(path.join(paths.reports, dataset.id, 'report.docx')), true);
  assert.equal(fs.existsSync(path.join(paths.reports, dataset.id, 'report.pdf')), true);
  assert.equal(fs.existsSync(path.join(paths.result, 'summary.json')), true);
  assert.equal(fs.existsSync(path.join(paths.result, 'run-history.json')), true);
  assert.equal(fs.existsSync(path.join(paths.charts, 'radar.png')), true);
  assert.equal(fs.existsSync(path.join(paths.export, 'Benchmark_Report.md')), true);
  assert.equal(fs.existsSync(path.join(paths.export, 'Benchmark_Report.docx')), true);
  assert.equal(fs.existsSync(path.join(paths.export, 'Benchmark_Report.pdf')), true);
  assert.equal(fs.existsSync(path.join(paths.export, 'Benchmark_Report.csv')), true);
  assert.equal(fs.existsSync(path.join(paths.export, 'Benchmark_Report.xlsx')), true);
  assert.equal(fs.existsSync(path.join(paths.export, 'Benchmark_Report.zip')), true);
  assert.match(fs.readFileSync(path.join(paths.logs, 'benchmark.log'), 'utf8'), /benchmark completed/);

  const reviewed = saveTeacherReview({
    appDir,
    datasetId: dataset.id,
    review: { teacherScore: 9, teacherComment: '教师确认质量达到要求。' }
  });
  assert.equal(reviewed.finalScore, 9);
  assert.equal(readJson(path.join(paths.reports, dataset.id, 'teacher-review.json')).teacherScore, 9);
});

test('benchmark API status exposes recent run history and local production CORS allows static/API access', async () => {
  const appDir = tempAppDir();
  importBenchmarkDataset({ appDir, input: sampleDataset(), sourceType: 'json' });
  await runBenchmark({ appDir, providerNames: ['mock'], mock: true, notifyFeishu: false });
  const app = createApp({
    appDir,
    env: { NODE_ENV: 'test', PUBLIC_APP_ORIGIN: 'https://pi.zhenwanyue.icu' },
    zspaceClient: { config: { enabled: false } },
    logger: { error() {}, warn() {}, info() {} }
  });
  const health = await invoke(app, {
    url: '/api/health',
    headers: { origin: 'http://127.0.0.1:4000' }
  });
  assert.equal(health.statusCode, 200);
  assert.equal(health.headers['access-control-allow-origin'], 'http://127.0.0.1:4000');

  const status = await invoke(app, {
    url: '/api/benchmark/status',
    headers: { origin: 'http://127.0.0.1:4000', 'x-user-id': '1' }
  });
  const payload = JSON.parse(status.body.toString('utf8'));
  assert.equal(status.statusCode, 200);
  assert.equal(payload.recentRuns.length >= 1, true);
  assert.equal(payload.latestRun.samples, 1);
});

test('benchmark CLI scripts, health check and frontend entry are wired without touching production flows', () => {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const packageJson = readJson(path.join(rootDir, 'package.json'));
  assert.equal(packageJson.scripts.benchmark, 'node ops/scripts/benchmark.mjs');
  assert.equal(packageJson.scripts['benchmark:test'], 'node ops/scripts/benchmark-test.mjs');
  assert.equal(packageJson.scripts['benchmark:check'], 'node ops/scripts/benchmark-check.mjs');

  const output = execFileSync('node', ['ops/scripts/benchmark-test.mjs', '--self-test'], {
    cwd: rootDir,
    encoding: 'utf8'
  });
  assert.match(output, /PASS/);
  const checkOutput = execFileSync('node', ['ops/scripts/benchmark-check.mjs', '--self-test'], {
    cwd: rootDir,
    encoding: 'utf8'
  });
  assert.match(checkOutput, /PASS/);

  const appSource = fs.readFileSync(path.join(rootDir, 'server/src/app.js'), 'utf8');
  assert.match(appSource, /benchmarkRouter/);
  assert.match(appSource, /:\(5173\|4000\)/);
  const clientSource = fs.readFileSync(path.join(rootDir, 'client/src/main.jsx'), 'utf8');
  assert.match(clientSource, /Benchmark Center/);
  assert.match(clientSource, /\/teacher\/benchmark/);
  assert.match(clientSource, /最近运行时间/);
  assert.match(clientSource, /历史运行记录/);
  assert.match(clientSource, /重新运行 Benchmark/);
  assert.match(clientSource, /下载 Word/);
  assert.match(clientSource, /下载 PDF/);
  assert.match(clientSource, /下载 Excel/);
  assert.match(clientSource, /下载 Markdown/);
});

test('source scripts use fileURLToPath instead of URL pathname for local filesystem paths', () => {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  let sourceFiles = '';
  try {
    sourceFiles = execFileSync('rg', [
      '-l',
      'new URL\\(import\\.meta\\.url\\)\\.pathname|new URL\\([^\\n]+\\.pathname',
      '.',
      '-g', '*.js',
      '-g', '*.mjs',
      '-g', '*.jsx',
      '-g', '*.ts',
      '-g', '!node_modules/**',
      '-g', '!client/dist/**',
      '-g', '!benchmark/**',
      '-g', '!backups/**'
    ], { cwd: rootDir, encoding: 'utf8' }).trim();
  } catch (error) {
    if (error.status !== 1) throw error;
    sourceFiles = '';
  }
  assert.equal(sourceFiles, '');
});
