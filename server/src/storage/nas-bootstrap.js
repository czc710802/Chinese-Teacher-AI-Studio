import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { createNasClient, loadNasConfig, publicNasConfig } from './nas-storage.js';

export function requiredNasDirectories() {
  return ['uploads', 'students', 'teachers', 'reports', 'backup'];
}

export function validateNasCredentials(env = process.env) {
  const missing = [];
  if (!String(env.NAS_USERNAME || '').trim()) missing.push('NAS_USERNAME');
  if (!String(env.NAS_PASSWORD || '').trim()) missing.push('NAS_PASSWORD');
  return {
    ok: missing.length === 0,
    missing
  };
}

export function buildBootstrapEnvSuggestion({
  protocol = 'local_mount',
  host = '192.168.100.164',
  port = protocol === 'webdav' ? 5006 : 445,
  smbShare = '',
  mountPath = '/Volumes/作文AI',
  remotePath = '/作文AI'
} = {}) {
  return [
    'NAS_ENABLED=true',
    `NAS_PROTOCOL=${protocol}`,
    `NAS_HOST=${host}`,
    `NAS_PORT=${port || ''}`,
    protocol === 'local_mount' ? `NAS_SMB_SHARE=${smbShare}` : '',
    'NAS_USERNAME=',
    'NAS_PASSWORD=',
    `NAS_REMOTE_PATH=${remotePath}`,
    `NAS_MOUNT_PATH=${mountPath}`,
    'NAS_SYNC_INTERVAL_SECONDS=60',
    'NAS_RETRY_COUNT=5',
    'NAS_TIMEOUT_MS=15000',
    protocol === 'webdav' ? 'NAS_WEBDAV_SCHEME=https' : '',
    'NAS_VERIFY_TLS=true'
  ].filter(Boolean).join('\n');
}

function encodeSmbPart(value = '') {
  return encodeURIComponent(String(value)).replace(/%2F/gi, '/');
}

export function buildSmbMountUrl({ host, username, password, shareName }) {
  return `smb://${encodeSmbPart(username)}:${encodeSmbPart(password)}@${host}/${encodeSmbPart(shareName)}`;
}

function runOsascript(script, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const child = spawn('osascript', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ ok: false, stdout, stderr: `${stderr}\ntimeout`.trim() });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr });
    });
    child.stdin.end(script);
  });
}

async function ensureSmbMounted(config) {
  if (fs.existsSync(config.mountPath)) return { attempted: false, mounted: true, message: 'already mounted' };
  const shareName = config.smbShare || path.basename(config.mountPath) || String(config.remotePath || '').replace(/^\/+/, '') || '作文AI';
  const url = buildSmbMountUrl({
    host: config.host,
    username: config.username,
    password: config.password,
    shareName
  });
  const script = `mount volume "${url.replace(/"/g, '\\"')}"`;
  const result = await runOsascript(script);
  return {
    attempted: true,
    mounted: fs.existsSync(config.mountPath),
    message: result.ok ? 'mounted' : 'SMB 挂载失败',
    error: result.ok ? '' : result.stderr || result.stdout || 'unknown error'
  };
}

export async function bootstrapNasStorage({ env = process.env, logger = console, client = null } = {}) {
  const config = loadNasConfig(env);
  const credentials = validateNasCredentials(env);
  if (!credentials.ok) {
    return {
      ok: false,
      missing: credentials.missing,
      message: `缺少 NAS 凭证：${credentials.missing.join(', ')}`,
      config: publicNasConfig(config)
    };
  }

  const mountResult = config.protocol === 'local_mount'
    ? await ensureSmbMounted(config)
    : { attempted: false, mounted: false };
  const nasClient = client || createNasClient({ ...config, enabled: true });
  const connection = await nasClient.testConnection();
  if (!connection.connected || !connection.writable) {
    return {
      ok: false,
      message: connection.error || 'NAS 不可写',
      connected: connection.connected,
      writable: connection.writable,
      mount: mountResult,
      config: publicNasConfig(config)
    };
  }

  const directories = [];
  try {
    const result = await nasClient.createDirectory({ remotePath: '' });
    directories.push({ dir: config.remotePath || '/', ok: result.ok === true });
  } catch (error) {
    logger.warn?.('NAS 根目录创建失败', { message: error.message });
    directories.push({ dir: config.remotePath || '/', ok: false, error: error.message });
  }
  for (const dir of requiredNasDirectories()) {
    try {
      const result = await nasClient.createDirectory({ remotePath: dir });
      directories.push({ dir, ok: result.ok === true });
    } catch (error) {
      logger.warn?.('NAS 目录创建失败', { dir, message: error.message });
      directories.push({ dir, ok: false, error: error.message });
    }
  }
  return {
    ok: directories.every((item) => item.ok),
    connected: true,
    writable: true,
    mount: mountResult,
    directories,
    config: publicNasConfig(config)
  };
}

export function renderNasDeploymentReport({
  generatedAt = new Date().toISOString(),
  discovery = {},
  bootstrap = {},
  envSuggestion = '',
  notes = []
} = {}) {
  const config = bootstrap.config || {};
  const dirs = bootstrap.directories || [];
  return `# NAS 自动接入部署报告

生成时间：${generatedAt}

## 当前目标 NAS

- Host：${config.hostConfigured ? (discovery.host || '已配置') : (discovery.host || '未配置')}
- 协议：${config.protocol || discovery.protocol || '未配置'}
- WebDAV Scheme：${config.webdavScheme || discovery.webdavScheme || ''}
- SMB 共享：${config.smbShare || discovery.smbShare || ''}
- 远端目录：${config.remotePath || '/作文AI'}
- 挂载目录：${config.mountPath || discovery.mountPath || ''}
- 凭证：${bootstrap.missing?.length ? `缺少 ${bootstrap.missing.join(', ')}` : '已配置但未显示'}
- 连接状态：${bootstrap.connected ? 'connected' : 'not connected'} / ${bootstrap.writable ? 'writable' : 'not writable'}
- 最近错误：${bootstrap.message || '无'}

## 目录初始化

${dirs.length ? dirs.map((item) => `- ${item.dir}: ${item.ok ? 'ok' : `failed ${item.error || ''}`}`).join('\n') : '- 未执行目录初始化。'}

## .env.production 建议

\`\`\`bash
${envSuggestion}
\`\`\`

## 自动同步服务

- 应用内置同步：后端启动且 \`NAS_ENABLED=true\` 时会按 \`NAS_SYNC_INTERVAL_SECONDS\` 自动补传。
- 独立同步脚本：\`npm run nas:service\` 可作为 launchd/手动守护进程运行。

## 飞书读取 NAS 文件

- 飞书文本命令支持 \`NAS 文件\` / \`nas 文件\` 查询最近同步任务和远端路径。
- 命令只返回路径、状态、哈希和时间，不返回 NAS 凭证。

## 备注

${notes.length ? notes.map((note) => `- ${note}`).join('\n') : '- 无'}
`;
}

export function writeNasDeploymentReport({ appDir, content }) {
  const reportPath = path.join(appDir, 'docs', 'NAS_DEPLOYMENT_REPORT.md');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, content);
  return reportPath;
}
