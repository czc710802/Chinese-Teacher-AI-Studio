import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { loadFeishuConfig } from '../../server/src/integrations/feishu/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_APP_DIR = path.resolve(__dirname, '../..');
const DEFAULT_HEALTH_URL = 'http://127.0.0.1:4000/api/feishu/health';
const FEISHU_PORT = 4000;
const HEALTH_WAIT_MS = 30000;
const HEALTH_POLL_MS = 2000;
const LOG_TAIL_LINES = 100;

function resolveAppDir(appDir = DEFAULT_APP_DIR) {
  return path.resolve(appDir || DEFAULT_APP_DIR);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function getFeishuControlPaths({ appDir = DEFAULT_APP_DIR } = {}) {
  const resolvedAppDir = resolveAppDir(appDir);
  const logDir = ensureDir(path.join(resolvedAppDir, 'logs'));
  return {
    appDir: resolvedAppDir,
    logDir,
    logPath: path.join(logDir, 'feishu-connect.log'),
    pidPath: path.join(logDir, 'feishu-connect.pid')
  };
}

function normalizeHealthUrl(value) {
  const raw = String(value || '').trim() || DEFAULT_HEALTH_URL;
  try {
    const url = new URL(raw);
    return { ok: true, url: url.toString(), raw };
  } catch (error) {
    return {
      ok: false,
      url: DEFAULT_HEALTH_URL,
      raw,
      error: `健康检查 URL 配置错误：${raw || '(empty)'}`
    };
  }
}

export function getFeishuHealthUrl(env = process.env) {
  return normalizeHealthUrl(env.FEISHU_HEALTH_URL);
}

export function detectMissingFeishuEnv(env = process.env) {
  const config = loadFeishuConfig(env);
  const missing = [];
  if (!config.appId) missing.push('FEISHU_APP_ID');
  if (!config.appSecret) missing.push('FEISHU_APP_SECRET');
  return missing;
}

function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM') return true;
    return false;
  }
}

function readPidFile(pidPath) {
  try {
    const raw = fs.readFileSync(pidPath, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writePidFile(pidPath, pid) {
  ensureDir(path.dirname(pidPath));
  fs.writeFileSync(pidPath, `${pid}\n`, 'utf8');
}

function removePidFile(pidPath) {
  try {
    fs.unlinkSync(pidPath);
  } catch {
    // ignore stale cleanup failures
  }
}

function findListeningPids(port = FEISHU_PORT) {
  const result = spawnSync('lsof', ['-tiTCP:' + String(port), '-sTCP:LISTEN'], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return [];
  return result.stdout
    .split('\n')
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((pid) => Number.isFinite(pid) && pid > 0);
}

function readProcessInfo(pid) {
  if (!isProcessAlive(pid)) return '';
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'pid=,ppid=,stat=,command='], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function tailFile(filePath, lines = LOG_TAIL_LINES) {
  try {
    const content = fs.readFileSync(filePath, 'utf8').trimEnd();
    if (!content) return '';
    const parts = content.split('\n');
    return parts.slice(-lines).join('\n');
  } catch {
    return '';
  }
}

async function checkHealthOnce(healthUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('health timeout')), 8000);
  try {
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    const bodyText = await response.text();
    let bodyJson = null;
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      // keep raw body
    }
    return {
      ok: true,
      status: response.status,
      bodyText,
      bodyJson
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      bodyText: '',
      bodyJson: null,
      error: String(error?.message || error || 'health request failed')
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeState(value) {
  return String(value || '').trim().toLowerCase();
}

export function classifyFeishuHealth({ healthUrl, response, env = process.env }) {
  const missingEnv = detectMissingFeishuEnv(env);
  let bodyJson = response?.bodyJson || null;
  const bodyText = String(response?.bodyText || '');
  const status = Number(response?.status || 0);
  if (!bodyJson && bodyText) {
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      bodyJson = null;
    }
  }
  const state = normalizeState(bodyJson?.connectionState || bodyJson?.connectionStatus?.state || '');
  const connected = Boolean(bodyJson?.connected && state === 'connected');
  const lastError = String(bodyJson?.lastError || '');

  if (response?.ok === false) {
    const error = String(response?.error || '');
    if (/invalid url/i.test(error) || /url/i.test(error) && /config/i.test(error)) {
      return {
        kind: 'health_url_config_error',
        reason: `健康检查 URL 配置错误：${healthUrl}`,
        missingEnv
      };
    }
    if (/enotfound|econnrefused|ehostunreach|econnreset|timed out|fetch failed|network/i.test(error)) {
      return {
        kind: 'local_service_not_started',
        reason: `本地服务端口未启动：${error}`,
        missingEnv
      };
    }
    return {
      kind: 'health_url_config_error',
      reason: `健康检查 URL 配置错误：${healthUrl}`,
      missingEnv
    };
  }

  if (!bodyJson || typeof bodyJson !== 'object') {
    return {
      kind: 'health_url_config_error',
      reason: `健康检查 URL 配置错误：HTTP ${status} / 返回内容不是 JSON`,
      missingEnv,
      status,
      bodyText
    };
  }

  if (!bodyJson.appConfigured) {
    return {
      kind: 'environment_missing',
      reason: missingEnv.length ? `缺少环境变量：${missingEnv.join(', ')}` : '飞书应用配置缺失',
      missingEnv,
      status,
      state,
      connected,
      bodyJson
    };
  }

  if (connected) {
    return {
      kind: 'healthy',
      reason: '健康检查通过',
      missingEnv,
      status,
      state,
      connected,
      bodyJson
    };
  }

  if (/bot\/v3\/info|tenant_access_token|app[_-]?secret|authorization|auth|token/i.test(lastError)) {
    return {
      kind: 'auth_failed',
      reason: lastError || '飞书鉴权失败',
      missingEnv,
      status,
      state,
      connected,
      bodyJson
    };
  }

  if (/websocket|ws|handshake|reconnect|long connection|connection/i.test(lastError) || state === 'failed') {
    return {
      kind: 'websocket_failed',
      reason: lastError || 'WebSocket 长连接失败',
      missingEnv,
      status,
      state,
      connected,
      bodyJson
    };
  }

  return {
    kind: 'websocket_failed',
    reason: lastError || 'WebSocket 长连接失败',
    missingEnv,
    status,
    state,
    connected,
    bodyJson
  };
}

function getHealthStateFromClassification(classification, response) {
  return String(
    classification?.state
      || classification?.bodyJson?.connectionState
      || classification?.bodyJson?.connectionStatus?.state
      || response?.bodyJson?.connectionState
      || response?.bodyJson?.connectionStatus?.state
      || 'unknown'
  );
}

function formatHealthAttempt({ attempt, healthUrl, response, classification }) {
  const lines = [
    `[FEISHU] 健康检查 #${attempt}`,
    `URL: ${healthUrl}`,
    `HTTP: ${response?.ok === false ? '000' : String(response?.status || 0)}`,
    `返回内容: ${response?.ok === false ? (response?.error || '(empty)') : (response?.bodyText || '(empty)')}`,
    `失败原因: ${classification?.reason || 'none'}`
  ];
  return lines.join('\n');
}

function formatProcessReport({ pidPath, pid, listenerPids = [] }) {
  const lines = [
    `[FEISHU] PID 文件: ${pidPath}`,
    `[FEISHU] PID: ${pid || 'none'}`,
    `[FEISHU] 监听 PID: ${listenerPids.length ? listenerPids.join(', ') : 'none'}`,
    `[FEISHU] 进程状态: ${pid && isProcessAlive(pid) ? 'running' : 'stopped'}`
  ];
  const info = pid ? readProcessInfo(pid) : '';
  if (info) {
    lines.push(`[FEISHU] ps: ${info}`);
  }
  return lines.join('\n');
}

function formatEnvironmentReport(env = process.env) {
  const missingEnv = detectMissingFeishuEnv(env);
  const lines = ['[FEISHU] 环境变量状态:'];
  if (missingEnv.length) {
    lines.push(`缺少: ${missingEnv.join(', ')}`);
  } else {
    lines.push('缺少: none');
  }
  lines.push(`FEISHU_HEALTH_URL: ${getFeishuHealthUrl(env).ok ? getFeishuHealthUrl(env).url : DEFAULT_HEALTH_URL}`);
  lines.push(`FEISHU_APP_ID: ${env.FEISHU_APP_ID ? 'SET' : 'UNSET'}`);
  lines.push(`FEISHU_APP_SECRET: ${env.FEISHU_APP_SECRET ? 'SET' : 'UNSET'}`);
  lines.push(`FEISHU_VERIFICATION_TOKEN: ${env.FEISHU_VERIFICATION_TOKEN ? 'SET' : 'UNSET'}`);
  lines.push(`FEISHU_ENCRYPT_KEY: ${env.FEISHU_ENCRYPT_KEY ? 'SET' : 'UNSET'}`);
  lines.push(`FEISHU_WEBHOOK_URL: ${env.FEISHU_WEBHOOK_URL ? 'SET' : 'UNSET'}`);
  lines.push(`FEISHU_SECRET: ${env.FEISHU_SECRET ? 'SET' : 'UNSET'}`);
  return lines.join('\n');
}

function spawnFeishuServer({ appDir, env, pidPath, logPath }) {
  const childEnv = {
    ...process.env,
    ...env,
    FEISHU_PID_FILE: pidPath
  };
  const logFd = fs.openSync(logPath, 'a');
  try {
    const child = spawn(process.execPath, [path.join(appDir, 'server', 'src', 'index.js')], {
      cwd: appDir,
      env: childEnv,
      detached: true,
      stdio: ['ignore', logFd, logFd]
    });
    child.unref();
    writePidFile(pidPath, child.pid);
    return child.pid;
  } finally {
    fs.closeSync(logFd);
  }
}

function adoptRunningProcess({ pidPath, port = FEISHU_PORT }) {
  const existingPid = readPidFile(pidPath);
  if (existingPid && isProcessAlive(existingPid)) {
    return existingPid;
  }
  if (existingPid) {
    removePidFile(pidPath);
  }

  const listenerPids = findListeningPids(port);
  const pid = listenerPids[0] || null;
  if (pid && isProcessAlive(pid)) {
    writePidFile(pidPath, pid);
    return pid;
  }
  return null;
}

async function waitForHealth({ healthUrl, env, timeoutMs = HEALTH_WAIT_MS, requireConnected = false }) {
  const startedAt = Date.now();
  let lastAttempt = null;
  for (let attempt = 1; Date.now() - startedAt <= timeoutMs; attempt += 1) {
    const response = await checkHealthOnce(healthUrl);
    const classification = classifyFeishuHealth({ healthUrl, response, env });
    lastAttempt = { attempt, response, classification };
    console.log(formatHealthAttempt({ attempt, healthUrl, response, classification }));
    console.log('');
    if (classification.kind === 'healthy') {
      return { ok: true, response, classification, attempt };
    }
    if (!requireConnected && response.ok) {
      return { ok: true, response, classification, attempt };
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
  }
  return { ok: false, lastAttempt };
}

function printFailureDiagnostics({ paths, env, healthUrl, lastAttempt, pid }) {
  const classification = lastAttempt?.classification || classifyFeishuHealth({
    healthUrl,
    response: { ok: false, error: 'health timeout' },
    env
  });
  console.log('[FEISHU] 健康检查失败诊断');
  console.log(`[FEISHU] 原因分类: ${classification.kind}`);
  console.log(`[FEISHU] 失败原因: ${classification.reason}`);
  console.log(`[FEISHU] 健康检查地址: ${healthUrl}`);
  console.log(formatProcessReport({
    pidPath: paths.pidPath,
    pid,
    listenerPids: findListeningPids(FEISHU_PORT)
  }));
  console.log(formatEnvironmentReport(env));
  const tail = tailFile(paths.logPath, LOG_TAIL_LINES);
  console.log(`[FEISHU] 日志最后 ${LOG_TAIL_LINES} 行:`);
  console.log(tail || '(empty)');
}

async function ensureStarted({ appDir, env, paths }) {
  const healthUrlInfo = getFeishuHealthUrl(env);
  if (!healthUrlInfo.ok) {
    return {
      ok: false,
      kind: 'health_url_config_error',
      reason: healthUrlInfo.error,
      healthUrl: healthUrlInfo.url
    };
  }

  const adoptedPid = adoptRunningProcess({ pidPath: paths.pidPath, port: FEISHU_PORT });
  if (adoptedPid) {
    return {
      ok: true,
      pid: adoptedPid,
      spawned: false,
      healthUrl: healthUrlInfo.url
    };
  }

  const pid = spawnFeishuServer({ appDir, env, pidPath: paths.pidPath, logPath: paths.logPath });
  return {
    ok: true,
    pid,
    spawned: true,
    healthUrl: healthUrlInfo.url
  };
}

export async function startFeishu({ appDir = DEFAULT_APP_DIR, env = process.env } = {}) {
  const paths = getFeishuControlPaths({ appDir });
  const started = await ensureStarted({ appDir: paths.appDir, env, paths });
  if (!started.ok) {
    return started;
  }

  const healthCheck = await waitForHealth({
    healthUrl: started.healthUrl,
    env,
    timeoutMs: 15000,
    requireConnected: false
  });

  const pid = started.pid || adoptRunningProcess({ pidPath: paths.pidPath, port: FEISHU_PORT });
  return {
    ok: true,
    pid,
    spawned: started.spawned,
    healthUrl: started.healthUrl,
    healthCheck
  };
}

export async function stopFeishu({ appDir = DEFAULT_APP_DIR, env = process.env } = {}) {
  const paths = getFeishuControlPaths({ appDir });
  const pid = adoptRunningProcess({ pidPath: paths.pidPath, port: FEISHU_PORT });
  if (!pid) {
    removePidFile(paths.pidPath);
    return { ok: true, stopped: false, pid: null };
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // ignore kill failures and continue with cleanup
  }

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && isProcessAlive(pid)) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }

  removePidFile(paths.pidPath);
  return { ok: true, stopped: true, pid };
}

export async function statusFeishu({ appDir = DEFAULT_APP_DIR, env = process.env } = {}) {
  const paths = getFeishuControlPaths({ appDir });
  const pid = adoptRunningProcess({ pidPath: paths.pidPath, port: FEISHU_PORT });
  const healthUrlInfo = getFeishuHealthUrl(env);
  const response = healthUrlInfo.ok ? await checkHealthOnce(healthUrlInfo.url) : {
    ok: false,
    status: 0,
    bodyText: '',
    bodyJson: null,
    error: healthUrlInfo.error
  };
  const classification = classifyFeishuHealth({ healthUrl: healthUrlInfo.url, response, env });
  console.log(formatProcessReport({
    pidPath: paths.pidPath,
    pid,
    listenerPids: findListeningPids(FEISHU_PORT)
  }));
  console.log(`[FEISHU] 健康检查地址: ${healthUrlInfo.url}`);
  console.log(`[FEISHU] HTTP 状态码: ${response.ok === false ? '000' : String(response.status || 0)}`);
  console.log(`[FEISHU] 返回内容: ${response.ok === false ? (response.error || '(empty)') : (response.bodyText || '(empty)')}`);
  console.log(`[FEISHU] 失败原因: ${classification.reason}`);
  const connected = classification.kind === 'healthy';
  const state = getHealthStateFromClassification(classification, response);
  console.log(`Long Connection ${state}`);
  console.log(`Robot Online ${connected ? 'true' : 'false'}`);
  console.log(`SDK ${response.bodyJson?.sdkVersion || 'unknown'}`);
  if (classification.kind === 'environment_missing' && classification.missingEnv?.length) {
    console.log(`Missing Env ${classification.missingEnv.join(', ')}`);
  }
  if (classification.bodyJson?.lastError) {
    console.log(`Last Error ${classification.bodyJson.lastError}`);
  }
  return { ok: connected, pid, healthUrl: healthUrlInfo.url, classification, response };
}

export async function logsFeishu({ appDir = DEFAULT_APP_DIR } = {}) {
  const paths = getFeishuControlPaths({ appDir });
  const content = tailFile(paths.logPath, LOG_TAIL_LINES);
  console.log(content || '(empty)');
  return { ok: true, logPath: paths.logPath, lines: LOG_TAIL_LINES };
}

export async function healthFeishu(options = {}) {
  const { appDir = DEFAULT_APP_DIR, env = process.env } = options;
  const healthUrlInfo = getFeishuHealthUrl(env);
  const response = healthUrlInfo.ok ? await checkHealthOnce(healthUrlInfo.url) : {
    ok: false,
    status: 0,
    bodyText: '',
    bodyJson: null,
    error: healthUrlInfo.error
  };
  const classification = classifyFeishuHealth({ healthUrl: healthUrlInfo.url, response, env });
  console.log(JSON.stringify({
    healthUrl: healthUrlInfo.url,
    response,
    classification
  }, null, 2));
  return { ok: classification.kind === 'healthy', healthUrl: healthUrlInfo.url, response, classification };
}

export async function restartFeishu(options = {}) {
  const stopped = await stopFeishu(options);
  const started = await startFeishu(options);
  return { ok: stopped.ok && started.ok, stopped, started };
}

export async function connectFeishu(options = {}) {
  const { appDir = DEFAULT_APP_DIR, env = process.env } = options;
  const paths = getFeishuControlPaths({ appDir });
  const startResult = await startFeishu({ appDir, env });
  const healthUrl = startResult.healthUrl || getFeishuHealthUrl(env).url;
  const startedPid = startResult.pid || adoptRunningProcess({ pidPath: paths.pidPath, port: FEISHU_PORT });

  const waitResult = await waitForHealth({
    healthUrl,
    env,
    timeoutMs: HEALTH_WAIT_MS,
    requireConnected: true
  });

  if (waitResult.ok) {
    const response = waitResult.response || {};
    const data = response.bodyJson || {};
    const state = String(data.connectionState || data.connectionStatus?.state || 'unknown');
    console.log(`Long Connection ${state}`);
    console.log(`Robot Online ${data.appConfigured && data.connected && state === 'connected' ? 'true' : 'false'}`);
    console.log(`SDK ${data.sdkVersion || 'unknown'}`);
    console.log(`[FEISHU] PID: ${startedPid || 'unknown'}`);
    console.log(`[FEISHU] 健康检查地址: ${healthUrl}`);
    return { ok: true, pid: startedPid, healthUrl, response };
  }

  printFailureDiagnostics({
    paths,
    env,
    healthUrl,
    lastAttempt: waitResult.lastAttempt,
    pid: startedPid
  });
  return { ok: false, pid: startedPid, healthUrl, lastAttempt: waitResult.lastAttempt };
}

async function runFromCli() {
  const command = String(process.argv[2] || 'connect').trim();
  const appDir = process.argv[3] ? path.resolve(process.argv[3]) : DEFAULT_APP_DIR;
  let result = { ok: true };
  switch (command) {
    case 'start':
      result = await startFeishu({ appDir });
      break;
    case 'stop':
      result = await stopFeishu({ appDir });
      break;
    case 'restart':
      result = await restartFeishu({ appDir });
      break;
    case 'status':
      result = await statusFeishu({ appDir });
      break;
    case 'logs':
      result = await logsFeishu({ appDir });
      break;
    case 'health':
      result = await healthFeishu({ appDir });
      break;
    case 'connect':
    default:
      result = await connectFeishu({ appDir });
      break;
  }
  process.exitCode = result?.ok === false ? 1 : 0;
}

const cliPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (cliPath && fileURLToPath(import.meta.url) === cliPath) {
  runFromCli().catch((error) => {
    console.error('[FEISHU] 运行失败:', error?.message || error);
    process.exitCode = 1;
  });
}
