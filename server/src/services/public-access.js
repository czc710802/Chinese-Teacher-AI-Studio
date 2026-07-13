import fs from 'node:fs';
import path from 'node:path';

function normalizeUrl(value) {
  if (!value) return '';
  const trimmed = String(value).trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
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
  const configuredUrl = normalizeUrl(env.PUBLIC_APP_URL || env.PUBLIC_APP_ORIGIN);
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
