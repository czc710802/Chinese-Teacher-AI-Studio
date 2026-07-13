import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../server/src/config/env.js';
import { runBenchmark } from '../../server/src/services/benchmark/benchmark-runner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '..', '..');
const args = new Set(process.argv.slice(2));
const providerArg = process.argv.find((arg) => arg.startsWith('--providers='));
const providerNames = providerArg ? providerArg.split('=')[1].split(',').map((item) => item.trim()).filter(Boolean) : undefined;

try {
  const result = await runBenchmark({
    appDir,
    providerNames,
    mock: args.has('--mock') || process.env.BENCHMARK_USE_MOCK === 'true',
    notifyFeishu: args.has('--notify-feishu') || process.env.BENCHMARK_FEISHU_NOTIFY === 'true'
  });
  console.log(`Benchmark success=${result.success}`);
  console.log(`Samples=${result.summary.samples}`);
  console.log(`Success=${result.summary.successCount}`);
  console.log(`Failures=${result.summary.failureCount}`);
  console.log(`AverageScore=${result.summary.averageScore}`);
  console.log(`ImprovementRate=${result.summary.averageImprovementRate}%`);
  if (!result.success) process.exitCode = 1;
} catch (error) {
  console.error(`Benchmark failed: ${String(error?.message || error).slice(0, 300)}`);
  process.exitCode = 1;
}
