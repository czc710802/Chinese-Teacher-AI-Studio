import fs from 'node:fs';
import path from 'node:path';
import { appendBenchmarkLog, benchmarkPaths, ensureBenchmarkDirectories, loadBenchmarkConfig } from './benchmark-config.js';
import { listBenchmarkDatasets, readBenchmarkDataset, writeBenchmarkDataset } from './dataset-manager.js';
import { createProviderAdapter } from './provider-adapters.js';
import { compareReports, scoreBenchmarkComparison } from './scoring.js';
import { writeChartArtifacts, writeFinalBenchmarkExports, writePerDatasetArtifacts } from './artifacts.js';

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function queueFile(paths) {
  return path.join(paths.result, 'retry-queue.json');
}

function historyFile(paths) {
  return path.join(paths.result, 'run-history.json');
}

function summarizeRows(rows) {
  const success = rows.filter((row) => row.status === 'success');
  const average = (values) => values.length ? Number((values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length).toFixed(2)) : 0;
  const modelComparison = {};
  for (const row of success) {
    const key = row.provider || 'unknown';
    modelComparison[key] ||= { count: 0, totalScore: 0, averageScore: 0, averageLatencyMs: 0, latencyTotal: 0 };
    modelComparison[key].count += 1;
    modelComparison[key].totalScore += Number(row.averageScore || 0);
    modelComparison[key].latencyTotal += Number(row.latencyMs || 0);
  }
  for (const item of Object.values(modelComparison)) {
    item.averageScore = Number((item.totalScore / Math.max(1, item.count)).toFixed(2));
    item.averageLatencyMs = Number((item.latencyTotal / Math.max(1, item.count)).toFixed(2));
  }
  return {
    samples: rows.length,
    successCount: success.length,
    failureCount: rows.length - success.length,
    successRate: rows.length ? Number(((success.length / rows.length) * 100).toFixed(2)) : 0,
    averageScore: average(success.map((row) => row.averageScore)),
    averageImprovementRate: average(success.map((row) => row.improvementRate)),
    averageLatencyMs: average(success.map((row) => row.latencyMs)),
    tokenUsage: success.reduce((sum, row) => sum + Number(row.tokenTotal || 0), 0),
    apiCost: Number(success.reduce((sum, row) => sum + Number(row.cost || 0), 0).toFixed(6)),
    modelComparison,
    recommendation: success.length ? '建议用教师复核结果继续微调 Prompt，并保留多模型横评。' : '暂无成功样本，请检查数据集或 Provider 配置。',
    generatedAt: new Date().toISOString()
  };
}

async function notifyFeishuBenchmark({ notifyFeishu, feishuService, summary }) {
  if (!notifyFeishu || !feishuService?.sendTextMessage) return { enabled: false, sent: false };
  try {
    await feishuService.sendTextMessage({
      text: `Benchmark 已完成\n样本数量：${summary.samples}\n平均分：${summary.averageScore}\n提升比例：${summary.averageImprovementRate}%`
    });
    return { enabled: true, sent: true };
  } catch (error) {
    return { enabled: true, sent: false, error: String(error?.message || error).slice(0, 120) };
  }
}

export async function runBenchmark({
  appDir,
  providerNames,
  mock = false,
  resume = true,
  notifyFeishu = false,
  feishuService = null,
  providerOptions = {}
} = {}) {
  const config = loadBenchmarkConfig({ appDir });
  const paths = ensureBenchmarkDirectories({ appDir, config });
  appendBenchmarkLog({ appDir, message: 'benchmark started', details: { providerNames, mock } });
  const datasets = listBenchmarkDatasets({ appDir, pageSize: 100000 }).items;
  const selectedProviders = providerNames?.length ? providerNames : (mock ? ['mock'] : config.enabledModels);
  const queue = readJson(queueFile(paths), { tasks: [] });
  const rows = [];

  for (const dataset of datasets) {
    for (const providerName of selectedProviders) {
      const reportDir = path.join(paths.reports, dataset.id);
      const scoreFile = path.join(reportDir, 'benchmark-score.json');
      if (resume && fs.existsSync(scoreFile)) {
        const score = readJson(scoreFile, null);
        rows.push({
          id: dataset.id,
          title: dataset.title,
          provider: providerName,
          model: dataset.newReport?.model || providerName,
          score: dataset.newReport?.score || null,
          averageScore: score?.averageScore || 0,
          improvementRate: score?.improvementRate || 0,
          latencyMs: dataset.newReport?.latencyMs || 0,
          status: 'success'
        });
        continue;
      }
      const adapter = createProviderAdapter(providerName, { enabled: providerName === 'mock' || providerOptions[providerName]?.enabled, ...providerOptions[providerName] });
      try {
        const result = await adapter.gradeEssay({ dataset, taskType: 'essay_grading' });
        const compare = compareReports({ oldReport: dataset.oldReport, newReport: result.report });
        const score = scoreBenchmarkComparison(compare, config);
        const updatedDataset = {
          ...dataset,
          newReport: result.report,
          compareResult: compare,
          benchmarkScore: score,
          updatedAt: new Date().toISOString()
        };
        writeBenchmarkDataset({ appDir, dataset: updatedDataset });
        await writePerDatasetArtifacts({ dir: reportDir, dataset: updatedDataset, report: result.report, compare, score });
        rows.push({
          id: dataset.id,
          title: dataset.title,
          provider: result.provider,
          model: result.model,
          score: result.report?.score || null,
          averageScore: score.averageScore,
          improvementRate: score.improvementRate,
          latencyMs: result.latencyMs,
          tokenTotal: result.tokenUsage?.totalTokens || 0,
          cost: result.cost || 0,
          status: 'success'
        });
        appendBenchmarkLog({ appDir, message: 'benchmark dataset completed', details: { id: dataset.id, provider: result.provider, latencyMs: result.latencyMs } });
      } catch (error) {
        const task = {
          taskId: `${dataset.id}-${providerName}`,
          datasetId: dataset.id,
          provider: providerName,
          retryCount: 0,
          lastError: String(error?.message || error).slice(0, 200),
          nextRetryAt: new Date(Date.now() + Number(config.retry?.backoffMs || 1000)).toISOString()
        };
        queue.tasks = queue.tasks.filter((item) => item.taskId !== task.taskId).concat(task);
        rows.push({ id: dataset.id, title: dataset.title, provider: providerName, model: providerName, status: 'failed', averageScore: 0, improvementRate: 0, latencyMs: 0 });
        appendBenchmarkLog({ appDir, message: 'benchmark dataset failed', level: 'warn', details: { id: dataset.id, provider: providerName, error: task.lastError } });
      }
    }
  }

  writeJson(queueFile(paths), queue);
  const summary = summarizeRows(rows);
  const history = readJson(historyFile(paths), { runs: [] });
  const runRecord = {
    runId: `run-${Date.now()}`,
    samples: summary.samples,
    successCount: summary.successCount,
    failureCount: summary.failureCount,
    averageScore: summary.averageScore,
    averageImprovementRate: summary.averageImprovementRate,
    providers: selectedProviders,
    startedAt: rows[0]?.startedAt || new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: summary.failureCount === 0 ? 'completed' : 'completed_with_failures'
  };
  history.runs = [runRecord, ...(history.runs || [])].slice(0, 100);
  writeJson(historyFile(paths), history);
  writeJson(path.join(paths.result, 'summary.json'), summary);
  writeJson(path.join(paths.result, 'model-comparison.json'), summary.modelComparison);
  writeChartArtifacts({ chartsDir: paths.charts, summary });
  await writeFinalBenchmarkExports({ exportDir: paths.export, summary, rows });
  const feishu = await notifyFeishuBenchmark({ notifyFeishu, feishuService, summary });
  appendBenchmarkLog({ appDir, message: 'benchmark completed', details: { samples: summary.samples, success: summary.successCount, failed: summary.failureCount, feishu } });
  return { success: summary.failureCount === 0, summary, rows, feishu, history: history.runs };
}

export function saveTeacherReview({ appDir, datasetId, review = {} } = {}) {
  const paths = ensureBenchmarkDirectories({ appDir });
  const dataset = readBenchmarkDataset({ appDir, id: datasetId });
  if (!dataset) throw new Error('Benchmark 样本不存在');
  const aiScore = dataset.benchmarkScore?.averageScore ?? null;
  const teacherScore = Number(review.teacherScore ?? aiScore ?? 0);
  const finalScore = Number(review.finalScore ?? teacherScore);
  const payload = {
    datasetId,
    aiScore,
    teacherScore,
    finalScore,
    teacherComment: String(review.teacherComment || ''),
    teacherEdits: review.teacherEdits || [],
    confirmedAt: new Date().toISOString()
  };
  const dir = path.join(paths.reports, datasetId);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, 'teacher-review.json'), payload);
  appendBenchmarkLog({ appDir, message: 'teacher review saved', details: { datasetId, finalScore } });
  return payload;
}

export function benchmarkStatus({ appDir } = {}) {
  const paths = ensureBenchmarkDirectories({ appDir });
  const datasets = listBenchmarkDatasets({ appDir, pageSize: 1 });
  const summary = readJson(path.join(paths.result, 'summary.json'), null);
  const queue = readJson(queueFile(paths), { tasks: [] });
  const history = readJson(historyFile(paths), { runs: [] });
  return {
    ready: true,
    datasets: datasets.total,
    summary,
    latestRun: history.runs?.[0] || null,
    recentRuns: history.runs || [],
    queuePending: queue.tasks.length,
    paths: {
      history: 'benchmark/history',
      reports: 'benchmark/reports',
      result: 'benchmark/result',
      charts: 'benchmark/charts',
      export: 'benchmark/export',
      logs: 'benchmark/logs',
      config: 'benchmark/config'
    },
    updatedAt: new Date().toISOString()
  };
}
