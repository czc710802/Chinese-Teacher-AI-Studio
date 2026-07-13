import fs from 'node:fs';
import path from 'node:path';

function readTail(filePath, lines = 20) {
  if (!fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) return '';
  return content.split('\n').slice(-lines).join('\n');
}

function summarizeContent(content) {
  return String(content || '')
    .replace(/https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/(FEISHU_[A-Z_]+\s*=\s*)([^\s]+)/g, '$1[redacted]')
    .trim();
}

export function getSystemLogs({ appDir = path.resolve(process.cwd(), '..') } = {}) {
  const logDir = path.join(appDir, 'logs');
  const candidates = [
    path.join(logDir, 'server.err.log'),
    path.join(logDir, 'server.out.log'),
    path.join(logDir, 'watchdog.log'),
    path.join(logDir, 'notify.log'),
    path.join(logDir, 'daily-report.log')
  ];
  for (const filePath of candidates) {
    const tail = readTail(filePath, 30);
    if (tail) {
      return {
        path: filePath,
        summary: summarizeContent(tail)
      };
    }
  }
  return { path: path.join(logDir, 'server.err.log'), summary: '暂无错误摘要' };
}
