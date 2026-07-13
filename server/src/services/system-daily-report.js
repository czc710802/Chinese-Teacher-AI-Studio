import fs from 'node:fs';
import path from 'node:path';

function summarizeMarkdown(content) {
  const text = String(content || '').trim();
  if (!text) return '暂无日报摘要';
  return text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
}

export function getLatestDailyReport({ appDir = path.resolve(process.cwd(), '..') } = {}) {
  const reportDir = path.join(appDir, 'reports');
  try {
    if (!fs.existsSync(reportDir)) {
      return { path: '', summary: '暂无日报摘要' };
    }
    const files = fs.readdirSync(reportDir)
      .filter((name) => /^daily-report-.*\.md$/i.test(name))
      .map((name) => {
        const filePath = path.join(reportDir, name);
        const stat = fs.statSync(filePath);
        return { path: filePath, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    const latest = files[0];
    if (!latest) return { path: '', summary: '暂无日报摘要' };
    return {
      path: latest.path,
      summary: summarizeMarkdown(fs.readFileSync(latest.path, 'utf8'))
    };
  } catch {
    return { path: '', summary: '暂无日报摘要' };
  }
}
