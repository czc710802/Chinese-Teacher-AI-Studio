import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_PUBLIC_ORIGIN = 'https://pi.zhenwanyue.icu';

function normalizeUrl(value) {
  if (!value) return '';
  const trimmed = String(value).trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function getPublicAppOrigin({ env = process.env } = {}) {
  return normalizeUrl(env.PUBLIC_APP_URL || env.PUBLIC_APP_ORIGIN);
}

export function buildPublicUrl(inputPath = '', { env = process.env } = {}) {
  const origin = getPublicAppOrigin({ env }) || DEFAULT_PUBLIC_ORIGIN;
  if (!origin) throw new Error('PUBLIC_APP_URL 未配置');
  const trimmed = String(inputPath || '').trim();
  if (!trimmed) return origin;
  if (/^https?:\/\//i.test(trimmed)) {
    return new URL(trimmed).toString().replace(/\/+$/, '');
  }
  const normalizedPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${origin}${normalizedPath}`;
}

export function assertAbsoluteHttpUrl(value, label = 'URL') {
  const text = String(value || '').trim();
  if (!/^https?:\/\//i.test(text)) {
    throw new Error(`${label} 必须以 http:// 或 https:// 开头`);
  }
  return new URL(text).toString().replace(/\/+$/, '');
}

function readTunnelConfig({ configPath, existsSync, readFileSync }) {
  if (!existsSync(configPath)) return {};
  const content = readFileSync(configPath, 'utf8');
  return {
    tunnelProtocol: content.match(/^\s*protocol:\s*([^\s#]+)/m)?.[1] || '',
    tunnelHost: content.match(/^\s*-\s*hostname:\s*([^\s#]+)/m)?.[1] || '',
    tunnelService: content.match(/^\s*service:\s*(https?:\/\/[^\s#]+)/m)?.[1] || ''
  };
}

export function getPublicAccessStatus({
  appDir = path.resolve(process.cwd(), '..'),
  env = process.env,
  existsSync = fs.existsSync,
  readFileSync = fs.readFileSync
} = {}) {
  const tunnelConfigPath = path.join(appDir, 'tools', 'cloudflared-production.yml');
  const tunnelBinaryPath = path.join(appDir, 'tools', 'cloudflared');
  const { tunnelProtocol = '', tunnelHost = '', tunnelService = '' } = readTunnelConfig({ configPath: tunnelConfigPath, existsSync, readFileSync });
  const configuredUrl = getPublicAppOrigin({ env });
  const tunnelUrl = normalizeUrl(tunnelHost);
  const url = configuredUrl || tunnelUrl;

  return {
    enabled: Boolean(url),
    url,
    origin: url,
    tunnelHost,
    tunnelService,
    tunnelProtocol,
    hasTunnelBinary: existsSync(tunnelBinaryPath),
    tunnelConfigPath,
    recommendedCommand: 'bash start-production.sh'
  };
}
