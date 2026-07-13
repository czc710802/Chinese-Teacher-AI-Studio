import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServerEnv } from '../../server/src/config/env.js';
import { ensureBenchmarkDirectories, benchmarkPaths } from '../../server/src/services/benchmark/benchmark-config.js';
import { importBenchmarkDataset } from '../../server/src/services/benchmark/dataset-manager.js';
import { listProviderAdapters, createProviderAdapter } from '../../server/src/services/benchmark/provider-adapters.js';
import { runBenchmark } from '../../server/src/services/benchmark/benchmark-runner.js';
import { createZSpaceClient } from '../../server/src/services/zspace-storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const selfTest = process.argv.includes('--self-test');
const appDir = selfTest ? fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-check-')) : path.resolve(__dirname, '..', '..');
const checks = [];

if (!selfTest) loadServerEnv({ appDir, nodeEnv: 'production' });

function record(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${name}=${ok ? 'true' : 'false'}${detail ? ` ${detail}` : ''}`);
}

async function checkWebDavWrite() {
  if (selfTest) {
    const mockFile = path.join(appDir, 'benchmark', 'logs', 'webdav-self-test.txt');
    fs.writeFileSync(mockFile, 'benchmark self-test', 'utf8');
    const ok = fs.readFileSync(mockFile, 'utf8') === 'benchmark self-test';
    fs.unlinkSync(mockFile);
    return ok;
  }
  const client = createZSpaceClient({ env: process.env, logger: { error() {}, warn() {}, info() {} } });
  const remotePath = `11_系统日志/benchmark-check/check-${Date.now()}.txt`;
  const uploaded = await client.uploadText(remotePath, 'benchmark check');
  const actualPath = uploaded.remotePath || remotePath;
  const content = await client.downloadFile(actualPath);
  await client.deleteFile(actualPath);
  return content.toString('utf8') === 'benchmark check';
}

try {
  const dirs = ensureBenchmarkDirectories({ appDir });
  record('BenchmarkDataDirs', ['history', 'reports', 'result', 'charts', 'export', 'logs', 'config'].every((key) => fs.existsSync(dirs[key])));

  const providers = listProviderAdapters();
  const providerOk = ['mock', 'deepseek', 'openai', 'gemini', 'custom'].every((name) => providers.includes(name))
    && createProviderAdapter('mock').isConfigured();
  record('ProviderAdapter', providerOk);

  importBenchmarkDataset({
    appDir,
    sourceType: 'json',
    input: {
      title: 'Benchmark Check 作文',
      authorId: 'check-student',
      grade: '高二',
      className: 'Check班',
      originalEssay: '青年应当在时代责任中选择自己的方向。',
      oldReport: { overall: '旧平台报告较短。', logicAnalysis: '逻辑一般。' }
    }
  });
  const result = await runBenchmark({ appDir, providerNames: ['mock'], mock: true, notifyFeishu: false, resume: false });
  const paths = benchmarkPaths({ appDir });

  record('Export', fs.existsSync(path.join(paths.export, 'Benchmark_Report.zip')));
  record('Charts', fs.existsSync(path.join(paths.charts, 'radar.png')) && fs.existsSync(path.join(paths.charts, 'model-comparison.pdf')));
  record('FeishuNotify', result.feishu.enabled === false);
  record('WordPDF', fs.existsSync(path.join(paths.export, 'Benchmark_Report.docx')) && fs.existsSync(path.join(paths.export, 'Benchmark_Report.pdf')));
  record('WebDAVWrite', await checkWebDavWrite());

  const ok = checks.every((item) => item.ok);
  console.log(ok ? 'PASS' : 'FAIL');
  if (!ok) process.exitCode = 1;
} catch (error) {
  console.log('FAIL');
  console.error(String(error?.message || error).slice(0, 500));
  process.exitCode = 1;
}
