import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importBenchmarkDataset } from '../../server/src/services/benchmark/dataset-manager.js';
import { runBenchmark, saveTeacherReview } from '../../server/src/services/benchmark/benchmark-runner.js';
import { benchmarkPaths, ensureBenchmarkDirectories } from '../../server/src/services/benchmark/benchmark-config.js';

function bool(value) {
  return value ? 'true' : 'false';
}

const appDir = process.argv.includes('--self-test')
  ? fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-self-test-'))
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

try {
  ensureBenchmarkDirectories({ appDir });
  const dataset = importBenchmarkDataset({
    appDir,
    sourceType: 'json',
    input: {
      title: 'Benchmark Smoke 作文',
      authorId: 'smoke-student',
      grade: '高二',
      className: 'Smoke班',
      originalEssay: '青年应当把个人选择与时代责任结合起来，在现实行动中证明理想的价值。',
      oldReport: {
        overall: '旧报告指出立意积极。',
        logicAnalysis: '逻辑一般。',
        teacherComment: '继续努力。'
      }
    }
  });
  const result = await runBenchmark({ appDir, providerNames: ['mock'], mock: true, notifyFeishu: false, resume: false });
  const paths = benchmarkPaths({ appDir });
  const review = saveTeacherReview({ appDir, datasetId: dataset.id, review: { teacherScore: 9, teacherComment: 'Smoke 复核通过' } });

  const checks = {
    DataImport: fs.existsSync(path.join(paths.history, `${dataset.id}.json`)),
    EssayGrading: result.summary.successCount >= 1,
    Compare: fs.existsSync(path.join(paths.reports, dataset.id, 'compare.json')),
    Scoring: fs.existsSync(path.join(paths.reports, dataset.id, 'benchmark-score.json')),
    Charts: fs.existsSync(path.join(paths.charts, 'radar.png')),
    Word: fs.existsSync(path.join(paths.export, 'Benchmark_Report.docx')),
    PDF: fs.existsSync(path.join(paths.export, 'Benchmark_Report.pdf')),
    FeishuNotify: result.feishu.enabled === false,
    Backend: true,
    TeacherReview: review.finalScore === 9
  };
  for (const [key, value] of Object.entries(checks)) console.log(`${key}=${bool(value)}`);
  const ok = Object.values(checks).every(Boolean);
  console.log(ok ? 'PASS' : 'FAIL');
  if (!ok) process.exitCode = 1;
} catch (error) {
  console.log('FAIL');
  console.error(String(error?.message || error).slice(0, 500));
  process.exitCode = 1;
}
