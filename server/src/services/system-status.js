import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

import { getAiStatus } from './openai.js';
import { getPublicAccessStatus } from './public-access.js';

function readPackageVersion(appDir) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
    return packageJson.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function readLaunchctlState(label) {
  const uid = process.getuid?.() ?? 0;
  const domain = `gui/${uid}`;
  try {
    const output = execFileSync('launchctl', ['print', `${domain}/${label}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const state = output.match(/state = ([^\n]+)/)?.[1]?.trim() || 'loaded';
    const pid = output.match(/pid = ([^\n]+)/)?.[1]?.trim() || '';
    return pid ? `${state} (pid ${pid})` : state;
  } catch {
    return 'not loaded';
  }
}

function readDiskUsage(targetPath) {
  try {
    const output = execFileSync('df', ['-h', targetPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const [, line] = output.split('\n');
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    return {
      filesystem: parts[0] || '',
      size: parts[1] || '',
      used: parts[2] || '',
      available: parts[3] || '',
      capacity: parts[4] || '',
      mountpoint: parts.slice(5).join(' ') || ''
    };
  } catch {
    return null;
  }
}

function readLatestArtifact(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return null;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const filePath = path.join(dirPath, entry.name);
        const stat = fs.statSync(filePath);
        return { path: filePath, mtime: stat.mtime.toISOString(), size: stat.size };
      })
      .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    return entries[0] || null;
  } catch {
    return null;
  }
}

function readHealthSnapshot(value) {
  if (!value || typeof value !== 'object') return { ok: false };
  return value;
}

export function getSystemStatus({
  appDir = path.resolve(process.cwd(), '..'),
  env = process.env,
  startTime = Date.now(),
  now = Date.now()
} = {}) {
  const reportsDir = path.join(appDir, 'reports');
  const backupsDir = path.join(appDir, 'backups');

  return {
    version: readPackageVersion(appDir),
    uptime: Math.max(0, Math.floor((now - startTime) / 1000)),
    nodeStatus: `running (pid ${process.pid})`,
    server: readLaunchctlState('com.zhenwanyue.ai-server'),
    cloudflaredStatus: readLaunchctlState('com.zhenwanyue.cloudflared'),
    watchdogStatus: readLaunchctlState('com.zhenwanyue.health-watchdog'),
    backup: readLaunchctlState('com.zhenwanyue.backup-production'),
    resourceMonitor: readLaunchctlState('com.zhenwanyue.resource-monitor'),
    dailyReport: readLaunchctlState('com.zhenwanyue.daily-report'),
    localHealth: readHealthSnapshot({
      ok: true,
      ...getAiStatus()
    }),
    publicHealth: readHealthSnapshot(getPublicAccessStatus({ appDir, env })),
    latestBackup: readLatestArtifact(backupsDir),
    latestDailyReport: readLatestArtifact(reportsDir),
    diskUsage: readDiskUsage(appDir),
    timestamp: new Date(now).toISOString(),
    memoryUsage: {
      rss: process.memoryUsage().rss,
      heapUsed: process.memoryUsage().heapUsed,
      heapTotal: process.memoryUsage().heapTotal,
      platform: os.platform()
    }
  };
}
