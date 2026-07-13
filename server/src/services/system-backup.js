import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function triggerBackup({ appDir = path.resolve(process.cwd(), '..') } = {}) {
  const scriptPath = path.join(appDir, 'ops', 'scripts', 'backup-production.sh');
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, path: '', message: '备份脚本不存在' };
  }

  try {
    const stdout = execFileSync('bash', [scriptPath], {
      cwd: appDir,
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024
    });
    const latest = fs.existsSync(path.join(appDir, 'backups'))
      ? fs.readdirSync(path.join(appDir, 'backups'))
        .filter((name) => /^backup-.*\.tar\.gz$/i.test(name))
        .map((name) => path.join(appDir, 'backups', name))
        .map((filePath) => ({ path: filePath, mtime: fs.statSync(filePath).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)[0]
      : null;
    return {
      ok: true,
      path: latest?.path || '',
      message: stdout.trim() || '备份已完成'
    };
  } catch (error) {
    return {
      ok: false,
      path: '',
      message: String(error?.stdout || error?.stderr || error?.message || '备份失败').trim()
    };
  }
}
