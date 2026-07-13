#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
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

function read(relativePath) {
  return fs.readFileSync(path.join(appDir, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(appDir, relativePath));
}

const checks = [];
const warnings = [];

function check(name, ok, details = '') {
  checks.push({ name, ok: Boolean(ok), details });
}

const gitInside = run('git', ['rev-parse', '--is-inside-work-tree']);
check('Git', gitInside.status === 0 && gitInside.stdout.trim() === 'true', 'Git work tree');

const gitStatus = run('git', ['status', '--short']);
check('GitClean', gitStatus.status === 0 && gitStatus.stdout.trim() === '', 'working tree clean');

const remote = run('git', ['remote', '-v']);
if (remote.status === 0 && remote.stdout.trim()) {
  check('GitHubRemote', true, 'origin configured');
} else {
  check('GitHubRemote', true, 'not configured yet');
  warnings.push('当前没有 GitHub Remote，需要创建 GitHub Repository。');
}

const readme = exists('README.md') ? read('README.md') : '';
const readmeSections = [
  '项目介绍',
  '系统架构',
  '功能模块',
  '目录结构',
  '安装方式',
  '启动方式',
  '生产部署',
  'Benchmark',
  '飞书机器人',
  'Cloudflare Tunnel',
  'WebDAV',
  '教师后台',
  '学生端',
  '后续开发路线',
];
const missingReadmeSections = readmeSections.filter((section) => !readme.includes(section));
check('README', missingReadmeSections.length === 0, missingReadmeSections.join(', '));

const gitignore = exists('.gitignore') ? read('.gitignore') : '';
const requiredIgnorePatterns = [
  'node_modules',
  '.env',
  '.env.*',
  'dist',
  'build',
  'coverage',
  'logs',
  'benchmark/reports',
  'benchmark/result',
  'benchmark/charts',
  'benchmark/export',
  'benchmark/logs',
  '*.log',
  '.DS_Store',
];
const missingIgnorePatterns = requiredIgnorePatterns.filter((pattern) => !gitignore.includes(pattern));
check('.gitignore', missingIgnorePatterns.length === 0, missingIgnorePatterns.join(', '));

const sensitivePaths = [
  '.env',
  '.env.production',
  '.env.local',
  'node_modules',
  'logs',
  'benchmark/reports',
  'benchmark/result',
  'benchmark/charts',
  'benchmark/export',
  'benchmark/logs',
];
const notIgnored = sensitivePaths.filter((item) => {
  const result = run('git', ['check-ignore', '-q', '--no-index', item]);
  return result.status !== 0;
});
check('SensitiveIgnore', notIgnored.length === 0, notIgnored.join(', '));

const trackedSensitive = run('git', ['ls-files']);
const trackedSensitiveMatches = trackedSensitive.stdout
  .split('\n')
  .filter(Boolean)
  .filter((file) => {
    if (file.endsWith('.example')) return false;
    if (file === '.env' || file === '.env.production' || file === '.env.local') return true;
    if (file.includes('/node_modules/') || file === 'node_modules') return true;
    if (file.startsWith('logs/')) return true;
    if (/^benchmark\/(reports|result|charts|export|logs)\//.test(file)) return true;
    return false;
  });
check('NoSensitiveTracked', trackedSensitive.status === 0 && trackedSensitiveMatches.length === 0, trackedSensitiveMatches.join(', '));

const workflow = exists('.github/workflows/ci.yml') ? read('.github/workflows/ci.yml') : '';
const workflowNeedles = [
  'npm run typecheck',
  'npm run lint',
  'npm run build',
  'npm run benchmark:test',
];
const missingWorkflowNeedles = workflowNeedles.filter((needle) => !workflow.includes(needle));
check('GitHubActions', missingWorkflowNeedles.length === 0, missingWorkflowNeedles.join(', '));

const packageJson = JSON.parse(read('package.json'));
check('Benchmark', Boolean(packageJson.scripts?.benchmark && packageJson.scripts?.['benchmark:test'] && exists('ops/scripts/benchmark.mjs')), 'benchmark scripts');
check('Feishu', Boolean(packageJson.scripts?.['feishu:smoke'] && exists('server/src/integrations/feishu/service.js')), 'feishu scripts and service');
check('CloudflareTunnel', Boolean(packageJson.scripts?.['public-files:check'] && exists('tools/cloudflared-production.yml')), 'cloudflare check and config');
check('WebDAV', Boolean(packageJson.scripts?.['zspace:test'] && exists('server/src/services/zspace-storage.js')), 'zspace test and storage service');

for (const item of checks) {
  console.log(`${item.name}=${item.ok ? 'true' : 'false'}${item.details ? ` ${item.details}` : ''}`);
}
for (const warning of warnings) {
  console.log(`WARN ${warning}`);
}

const failed = checks.filter((item) => !item.ok);
if (failed.length > 0) {
  console.error('FAIL');
  process.exit(1);
}

console.log('PASS');
