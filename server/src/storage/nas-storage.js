import fs from 'node:fs';
import path from 'node:path';

import { assertInside, copyFileVerified, ensureDir, sha256File } from './local-storage.js';

function boolEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function trimSlashes(value) {
  return String(value || '').replace(/^\/+|\/+$/g, '');
}

function safePort(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadNasConfig(env = process.env) {
  return {
    enabled: boolEnv(env.NAS_ENABLED, false),
    protocol: env.NAS_PROTOCOL || 'local_mount',
    host: env.NAS_HOST || '',
    port: env.NAS_PORT || '',
    webdavScheme: env.NAS_WEBDAV_SCHEME || '',
    smbShare: env.NAS_SMB_SHARE || '',
    username: env.NAS_USERNAME || '',
    password: env.NAS_PASSWORD || '',
    remotePath: env.NAS_REMOTE_PATH || '/作文AI',
    mountPath: env.NAS_MOUNT_PATH || '/Volumes/作文AI',
    syncIntervalSeconds: Number(env.NAS_SYNC_INTERVAL_SECONDS || 60),
    retryCount: Number(env.NAS_RETRY_COUNT || 5),
    timeoutMs: Number(env.NAS_TIMEOUT_MS || 15000),
    verifyTls: boolEnv(env.NAS_VERIFY_TLS, true)
  };
}

export function publicNasConfig(config) {
  return {
    enabled: config.enabled,
    protocol: config.protocol,
    hostConfigured: Boolean(config.host),
    usernameConfigured: Boolean(config.username),
    remotePath: config.remotePath,
    mountPath: config.protocol === 'local_mount' ? config.mountPath : '',
    syncIntervalSeconds: config.syncIntervalSeconds,
    retryCount: config.retryCount,
    timeoutMs: config.timeoutMs,
    verifyTls: config.verifyTls,
    webdavScheme: config.webdavScheme || '',
    smbShare: config.smbShare || ''
  };
}

export function localMountRoot(config) {
  const remoteRoot = trimSlashes(config.remotePath);
  if (remoteRoot && path.basename(config.mountPath) === remoteRoot) return config.mountPath;
  return remoteRoot ? path.join(config.mountPath, remoteRoot) : config.mountPath;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function basicAuth(config) {
  if (!config.username || !config.password) return {};
  return { authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}` };
}

export function buildWebDavUrl(config, remotePath) {
  if (!config.host) throw new Error('NAS_HOST 未配置，不能连接 WebDAV');
  const configuredPort = safePort(config.port, 5006);
  const scheme = config.webdavScheme || ([80, 5005].includes(configuredPort) ? 'http' : 'https');
  const port = configuredPort || (scheme === 'https' ? 443 : 80);
  const root = trimSlashes(config.remotePath);
  const file = trimSlashes(remotePath);
  return `${scheme}://${config.host}:${port}/${[root, file].filter(Boolean).map(encodeURI).join('/')}`;
}

async function ensureWebDavDirs(config, remotePath) {
  const segments = trimSlashes(path.posix.dirname(remotePath)).split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current = [current, segment].filter(Boolean).join('/');
      const response = await fetchWithTimeout(buildWebDavUrl(config, current), {
      method: 'MKCOL',
      headers: basicAuth(config)
    }, config.timeoutMs);
    if (![201, 405, 301, 302].includes(response.status)) {
      throw new Error(`WebDAV 创建目录失败：HTTP ${response.status}`);
    }
  }
}

export function createNasClient(config = loadNasConfig()) {
  async function checkLocalMount() {
    const root = localMountRoot(config);
    if (!fs.existsSync(config.mountPath)) {
      return { connected: false, writable: false, error: 'NAS_MOUNT_PATH 不存在或未挂载' };
    }
    try {
      ensureDir(root);
      const testPath = path.join(root, '.storage-health');
      fs.writeFileSync(testPath, new Date().toISOString());
      fs.unlinkSync(testPath);
      return { connected: true, writable: true, error: '' };
    } catch (error) {
      return { connected: true, writable: false, error: error.message };
    }
  }

  async function checkWebDav() {
    if (!config.host) return { connected: false, writable: false, error: 'NAS_HOST 未配置' };
    try {
      const response = await fetchWithTimeout(buildWebDavUrl(config, ''), {
        method: 'PROPFIND',
        headers: { ...basicAuth(config), depth: '0' }
      }, config.timeoutMs);
      const connected = response.status < 500;
      const writable = [200, 207, 301, 302, 404].includes(response.status);
      const error = writable ? '' : `HTTP ${response.status}`;
      return { connected, writable, error };
    } catch (error) {
      return { connected: false, writable: false, error: error.message };
    }
  }

  async function testConnection() {
    if (!config.enabled) return { connected: false, writable: false, error: 'NAS 未启用' };
    if (config.protocol === 'local_mount') return checkLocalMount();
    if (config.protocol === 'webdav') return checkWebDav();
    if (config.protocol === 'sftp') {
      return { connected: false, writable: false, error: 'SFTP 同步需要配置可用的 SFTP 客户端适配器，本阶段不会猜测连接参数' };
    }
    return { connected: false, writable: false, error: `不支持的 NAS_PROTOCOL：${config.protocol}` };
  }

  async function uploadFile({ localPath, remotePath, expectedSha256 }) {
    if (!config.enabled) return { ok: false, skipped: true, message: 'NAS 未启用' };
    if (config.protocol === 'local_mount') {
      const root = localMountRoot(config);
      const targetPath = assertInside(root, path.join(root, remotePath));
      const { targetHash } = copyFileVerified(localPath, targetPath);
      if (expectedSha256 && targetHash !== expectedSha256) throw new Error('NAS 目标文件 SHA-256 不匹配');
      return { ok: true, remotePath, sha256: targetHash };
    }
    if (config.protocol === 'webdav') {
      await ensureWebDavDirs(config, remotePath);
      const response = await fetchWithTimeout(buildWebDavUrl(config, remotePath), {
        method: 'PUT',
        headers: basicAuth(config),
        body: fs.readFileSync(localPath)
      }, config.timeoutMs);
      if (!response.ok && response.status !== 201 && response.status !== 204) {
        throw new Error(`WebDAV 上传失败：HTTP ${response.status}`);
      }
      return { ok: true, remotePath, sha256: sha256File(localPath) };
    }
    if (config.protocol === 'sftp') {
      throw new Error('SFTP 协议已预留在适配层，但未配置可用的本机 SFTP 凭证方式，未执行上传');
    }
    throw new Error(`不支持的 NAS_PROTOCOL：${config.protocol}`);
  }

  async function downloadFile({ remotePath, localPath }) {
    if (config.protocol === 'local_mount') {
      const root = localMountRoot(config);
      const sourcePath = assertInside(root, path.join(root, remotePath));
      copyFileVerified(sourcePath, localPath);
      return { ok: true, localPath, sha256: sha256File(localPath) };
    }
    if (config.protocol === 'webdav') {
      const response = await fetchWithTimeout(buildWebDavUrl(config, remotePath), {
        method: 'GET',
        headers: basicAuth(config)
      }, config.timeoutMs);
      if (!response.ok) throw new Error(`WebDAV 下载失败：HTTP ${response.status}`);
      ensureDir(path.dirname(localPath));
      fs.writeFileSync(localPath, Buffer.from(await response.arrayBuffer()));
      return { ok: true, localPath, sha256: sha256File(localPath) };
    }
    throw new Error('当前协议暂不支持脚本下载校验');
  }

  async function deleteFile({ remotePath }) {
    if (config.protocol === 'local_mount') {
      const root = localMountRoot(config);
      const targetPath = assertInside(root, path.join(root, remotePath));
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      return { ok: true };
    }
    if (config.protocol === 'webdav') {
      const response = await fetchWithTimeout(buildWebDavUrl(config, remotePath), {
        method: 'DELETE',
        headers: basicAuth(config)
      }, config.timeoutMs);
      if (!response.ok && response.status !== 404) throw new Error(`WebDAV 删除失败：HTTP ${response.status}`);
      return { ok: true };
    }
    throw new Error('当前协议暂不支持删除测试文件');
  }

  async function createDirectory({ remotePath }) {
    if (!config.enabled) return { ok: false, skipped: true, message: 'NAS 未启用' };
    if (config.protocol === 'local_mount') {
      const root = localMountRoot(config);
      const targetPath = assertInside(root, path.join(root, remotePath || ''));
      ensureDir(targetPath);
      return { ok: true, remotePath };
    }
    if (config.protocol === 'webdav') {
      const response = await fetchWithTimeout(buildWebDavUrl(config, remotePath || ''), {
        method: 'MKCOL',
        headers: basicAuth(config)
      }, config.timeoutMs);
      if (![201, 405, 301, 302].includes(response.status)) {
        throw new Error(`WebDAV 创建目录失败：HTTP ${response.status}`);
      }
      return { ok: true, remotePath, status: response.status };
    }
    throw new Error('当前协议暂不支持自动创建目录');
  }

  return {
    config,
    testConnection,
    uploadFile,
    downloadFile,
    deleteFile,
    createDirectory
  };
}
