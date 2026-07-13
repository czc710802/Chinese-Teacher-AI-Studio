import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(scriptDir, '..', '..');

function read(file) {
  return readFileSync(join(rootDir, file), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function has(file, pattern, label) {
  assert(pattern.test(read(file)), `${file} 缺少: ${label}`);
}

function shellLint(file) {
  execFileSync('bash', ['-n', join(rootDir, file)], { stdio: 'pipe' });
}

const rootPackage = JSON.parse(read('package.json'));
assert(rootPackage.scripts?.lint && rootPackage.scripts?.test && rootPackage.scripts?.build, '根 package.json 需要 lint/test/build');
assert(rootPackage.scripts['prod:install'], '根 package.json 需要 prod:install');
assert(rootPackage.scripts['prod:restart'], '根 package.json 需要 prod:restart');
assert(rootPackage.scripts['prod:status'], '根 package.json 需要 prod:status');
assert(rootPackage.scripts['prod:logs'], '根 package.json 需要 prod:logs');
assert(rootPackage.scripts['prod:diagnose'], '根 package.json 需要 prod:diagnose');
assert(rootPackage.scripts['prod:watchdog'], '根 package.json 需要 prod:watchdog');
assert(rootPackage.scripts['prod:collect-logs'], '根 package.json 需要 prod:collect-logs');

const serverPackage = JSON.parse(read('server/package.json'));
assert(serverPackage.scripts?.start === 'node src/index.js', 'server/package.json start 需要使用可移植 node 命令');
assert(serverPackage.scripts?.dev === 'node --watch src/index.js', 'server/package.json dev 需要使用可移植 node 命令');

const clientPackage = JSON.parse(read('client/package.json'));
assert(clientPackage.scripts?.build === 'node node_modules/vite/bin/vite.js build', 'client/package.json build 需要使用可移植 node 命令');

has('server/src/index.js', /const host = process\.env\.HOST \|\| '0\.0\.0\.0';/, '后端必须监听 0.0.0.0');
has('server/src/index.js', /app\.get\('\/api\/health'/, '必须保留 /api/health');
has('server/src/index.js', /res\.json\(\{ ok: true, name: '高中作文 AI 批改 App'/, '健康接口必须返回 JSON');

const gitignore = read('.gitignore');
assert(gitignore.includes('logs/'), '.gitignore 需要忽略 logs/');
assert(gitignore.includes('.env.production'), '.gitignore 需要忽略 .env.production');
assert(gitignore.includes('credentials.json'), '.gitignore 需要忽略 credentials.json');
assert(gitignore.includes('*.pem'), '.gitignore 需要忽略 PEM 文件');
assert(gitignore.includes('*.token'), '.gitignore 需要忽略 token 文件');

const launchdDir = join(rootDir, 'ops/launchd');
for (const file of readdirSync(launchdDir).filter((name) => name.endsWith('.plist'))) {
  const content = read(join('ops/launchd', file));
  assert(content.includes('<key>RunAtLoad</key>'), `${file} 需要 RunAtLoad`);
  assert(content.includes('<key>KeepAlive</key>'), `${file} 需要 KeepAlive`);
}

for (const script of readdirSync(join(rootDir, 'ops/scripts')).filter((name) => name.endsWith('.sh'))) {
  shellLint(join('ops/scripts', script));
}

const forbiddenPaths = ['/Users/chenxiansheng/', 'pnpm --dir'];
for (const file of ['package.json', 'client/package.json', 'server/package.json']) {
  const content = read(file);
  for (const fragment of forbiddenPaths) {
    assert(!content.includes(fragment), `${file} 不应包含硬编码本机路径: ${fragment}`);
  }
}

console.log('production lint passed');
