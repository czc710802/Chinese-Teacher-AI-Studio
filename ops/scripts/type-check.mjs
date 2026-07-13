#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: appDir,
    encoding: 'utf8',
    ...options,
  });
}

const list = run('git', ['ls-files', '*.js', '*.mjs']);
if (list.status !== 0) {
  console.error('Type Check=false');
  console.error('无法读取 Git 文件列表。');
  process.exit(1);
}

const files = list.stdout
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((file) => !file.includes('/node_modules/'))
  .filter((file) => !file.startsWith('client/dist/'))
  .filter((file) => !file.startsWith('benchmark/reports/'))
  .filter((file) => !file.startsWith('benchmark/result/'))
  .filter((file) => !file.startsWith('benchmark/charts/'))
  .filter((file) => !file.startsWith('benchmark/export/'))
  .filter((file) => !file.startsWith('benchmark/logs/'));

const failures = [];
for (const file of files) {
  const result = run(process.execPath, ['--check', file]);
  if (result.status !== 0) {
    failures.push({
      file,
      message: `${result.stderr || result.stdout}`.trim(),
    });
  }
}

if (failures.length > 0) {
  console.error('Type Check=false');
  for (const failure of failures) {
    console.error(`${failure.file}: ${failure.message}`);
  }
  process.exit(1);
}

console.log(`Type Check=true`);
console.log(`Checked files=${files.length}`);
