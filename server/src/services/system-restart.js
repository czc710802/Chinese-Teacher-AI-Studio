import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function confirmRestart({ appDir = path.resolve(process.cwd(), '..'), token = '', expectedToken = '' } = {}) {
  if (!expectedToken) {
    return { ok: false, confirmed: false, executed: false, message: '未配置重启确认口令' };
  }
  if (String(token || '').trim() !== String(expectedToken || '').trim()) {
    return { ok: false, confirmed: false, executed: false, message: '重启确认口令不匹配' };
  }

  try {
    const scriptPath = path.join(appDir, 'ops', 'scripts', 'restart-production.sh');
    execFileSync('bash', [scriptPath], {
      cwd: appDir,
      env: process.env,
      stdio: 'pipe',
      maxBuffer: 1024 * 1024
    });
    return { ok: true, confirmed: true, executed: true, message: '重启已触发' };
  } catch (error) {
    return {
      ok: false,
      confirmed: true,
      executed: false,
      message: String(error?.stdout || error?.stderr || error?.message || '重启失败').trim()
    };
  }
}
