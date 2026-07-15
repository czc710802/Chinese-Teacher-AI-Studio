import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { getArchiveRecord } from './archive-pipeline.js';

const DEFAULT_PUBLIC_ORIGIN = 'https://pi.zhenwanyue.icu';
const DEFAULT_TTL_SECONDS = 86400;
const AUDIT_LOG = path.join('logs', 'audit.log');

const FILE_TYPES = {
  report: { fileName: 'report.md', contentType: 'text/markdown; charset=utf-8', extension: 'md' },
  markdown: { fileName: 'report.md', contentType: 'text/markdown; charset=utf-8', extension: 'md' },
  json: { fileName: 'report.json', contentType: 'application/json; charset=utf-8', extension: 'json' },
  docx: { fileName: 'report.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extension: 'docx' },
  pdf: { fileName: 'report.pdf', contentType: 'application/pdf', extension: 'pdf' },
  original: { fileName: 'original.md', contentType: 'text/markdown; charset=utf-8', extension: 'md' }
};

function redact(value) {
  return String(value || '')
    .replace(/token=[A-Za-z0-9._~-]+/g, 'token=***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
    .replace(/Basic\s+[A-Za-z0-9+/=]+/g, 'Basic ***');
}

function base64urlEncode(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8').toString('base64url');
}

function base64urlDecode(value) {
  return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function hmac(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function normalizeOrigin(env = process.env) {
  const raw = String(env.FEISHU_REPORT_PUBLIC_BASE_URL || env.PUBLIC_APP_ORIGIN || env.PUBLIC_APP_URL || DEFAULT_PUBLIC_ORIGIN).trim().replace(/\/+$/, '');
  const url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
  if (!/^https?:$/.test(url.protocol)) throw new Error('PUBLIC_APP_ORIGIN 协议无效');
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(url.hostname)) throw new Error('PUBLIC_APP_ORIGIN 不能是本机地址');
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(url.hostname)) throw new Error('PUBLIC_APP_ORIGIN 不能是局域网地址');
  return url.origin;
}

function getSecret(env = process.env) {
  const secret = String(env.FEISHU_FILE_LINK_SECRET || '').trim();
  if (secret) return secret;
  if (env.NODE_ENV === 'test') return 'test-link-secret';
  throw new Error('FEISHU_FILE_LINK_SECRET 未配置');
}

function ttlSeconds(env = process.env, override) {
  if (override != null) return Number(override);
  return Math.max(60, Number(env.FEISHU_FILE_LINK_TTL_SECONDS || DEFAULT_TTL_SECONDS));
}

export function isAllowedFileType(fileType) {
  return Object.prototype.hasOwnProperty.call(FILE_TYPES, String(fileType || ''));
}

export function normalizeFileType(fileType) {
  const normalized = String(fileType || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(normalized)) {
    const error = new Error('文件类型无效');
    error.statusCode = 400;
    throw error;
  }
  if (!isAllowedFileType(normalized)) {
    const error = new Error('文件类型不支持');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function normalizeArchiveId(archiveId) {
  const value = String(archiveId || '').trim();
  if (!value || value.includes('/') || value.includes('\\') || value.includes('..') || value.includes('\0')) {
    const error = new Error('归档 ID 无效');
    error.statusCode = 400;
    throw error;
  }
  return value;
}

export function createSignedDownloadToken({
  archiveId,
  fileType,
  userId = '',
  expiresInSeconds,
  env = process.env,
  now = Date.now()
} = {}) {
  const safeArchiveId = normalizeArchiveId(archiveId);
  const safeFileType = fileType === 'report-page' ? 'report-page' : normalizeFileType(fileType);
  const payload = {
    archiveId: safeArchiveId,
    fileType: safeFileType,
    userId: String(userId || 'feishu'),
    expiresAt: new Date(now + ttlSeconds(env, expiresInSeconds) * 1000).toISOString(),
    nonce: crypto.randomUUID()
  };
  const payloadText = JSON.stringify(payload);
  const signature = hmac(getSecret(env), payloadText);
  return base64urlEncode({ ...payload, signature });
}

export function verifySignedDownloadToken({
  archiveId,
  fileType,
  token,
  env = process.env,
  now = Date.now()
} = {}) {
  try {
    const expectedArchiveId = normalizeArchiveId(archiveId);
    const expectedFileType = fileType === 'report-page' ? 'report-page' : normalizeFileType(fileType);
    const parsed = JSON.parse(base64urlDecode(token));
    const { signature, ...payload } = parsed || {};
    if (!payload.archiveId || !payload.fileType || !payload.expiresAt || !payload.nonce || !signature) {
      return { ok: false, statusCode: 403, code: 'INVALID_SIGNATURE', message: '下载链接无效' };
    }
    if (payload.archiveId !== expectedArchiveId || payload.fileType !== expectedFileType) {
      return { ok: false, statusCode: 403, code: 'INVALID_SIGNATURE', message: '下载链接无效' };
    }
    if (new Date(payload.expiresAt).getTime() <= now) {
      return { ok: false, statusCode: 410, code: 'LINK_EXPIRED', message: '下载链接已过期，请重新生成' };
    }
    const expected = hmac(getSecret(env), JSON.stringify(payload));
    if (!safeCompare(signature, expected)) {
      return { ok: false, statusCode: 403, code: 'INVALID_SIGNATURE', message: '下载链接无效' };
    }
    return { ok: true, ...payload };
  } catch {
    return { ok: false, statusCode: 403, code: 'INVALID_SIGNATURE', message: '下载链接无效' };
  }
}

export function createSignedDownloadUrl({
  archiveId,
  fileType,
  userId,
  expiresInSeconds,
  env = process.env
} = {}) {
  const origin = normalizeOrigin(env);
  const safeArchiveId = normalizeArchiveId(archiveId);
  const safeFileType = normalizeFileType(fileType);
  const token = createSignedDownloadToken({ archiveId: safeArchiveId, fileType: safeFileType, userId, expiresInSeconds, env });
  return `${origin}/api/files/${encodeURIComponent(safeArchiveId)}/${safeFileType}?token=${encodeURIComponent(token)}`;
}

export function createSignedReportUrl({
  archiveId,
  userId,
  expiresInSeconds,
  env = process.env
} = {}) {
  const origin = normalizeOrigin(env);
  const safeArchiveId = normalizeArchiveId(archiveId);
  const token = createSignedDownloadToken({ archiveId: safeArchiveId, fileType: 'report-page', userId, expiresInSeconds, env });
  return `${origin}/report/${encodeURIComponent(safeArchiveId)}?token=${encodeURIComponent(token)}`;
}

export function findArchiveFile(record, fileType) {
  const safeFileType = normalizeFileType(fileType);
  const wanted = FILE_TYPES[safeFileType].fileName;
  return (record?.files || []).find((file) => file.name === wanted || String(file.remotePath || '').endsWith(`/${wanted}`)) || null;
}

export function getArchiveFileDescriptor({ appDir, archiveId, fileType } = {}) {
  const record = getArchiveRecord(appDir, normalizeArchiveId(archiveId));
  if (!record || record.archiveStatus !== 'archived') {
    const error = new Error('归档记录不存在或尚未完成');
    error.statusCode = 404;
    throw error;
  }
  const safeFileType = normalizeFileType(fileType);
  if (safeFileType === 'json' && record.reportJson) {
    return {
      record,
      file: {
        name: FILE_TYPES.json.fileName,
        remotePath: record.nasPath ? `${record.nasPath}/${FILE_TYPES.json.fileName}` : '',
        contentType: FILE_TYPES.json.contentType,
        inlineBuffer: Buffer.from(JSON.stringify(record.reportJson, null, 2), 'utf8')
      },
      fileType: safeFileType,
      contentType: FILE_TYPES[safeFileType].contentType
    };
  }
  const file = findArchiveFile(record, safeFileType);
  if (!file) {
    const error = new Error('归档文件尚未生成');
    error.statusCode = 404;
    throw error;
  }
  return {
    record,
    file,
    fileType: safeFileType,
    contentType: FILE_TYPES[safeFileType].contentType
  };
}

export async function buildArchiveDownloadLinks({
  appDir,
  archiveId,
  userId = '',
  env = process.env,
  client,
  expiresInSeconds
} = {}) {
  const record = getArchiveRecord(appDir, normalizeArchiveId(archiveId));
  if (!record || record.archiveStatus !== 'archived') return { archiveId, available: false, files: {} };
  const files = {};
  for (const type of ['report', 'markdown', 'docx', 'pdf', 'original', 'json']) {
    const file = findArchiveFile(record, type);
    if (!file) continue;
    let readable = true;
    if (client?.fileExists) {
      try {
        readable = await client.fileExists(file.remotePath);
      } catch {
        readable = false;
      }
    }
    if (readable) {
      files[type] = createSignedDownloadUrl({ archiveId: record.id, fileType: type, userId, expiresInSeconds, env });
    }
  }
  const reportJsonAvailable = Boolean(record.reportJson && Object.keys(record.reportJson || {}).length > 0);
  const reportUrl = files.report || files.markdown || reportJsonAvailable
    ? createSignedReportUrl({ archiveId: record.id, userId, expiresInSeconds, env })
    : '';
  return {
    archiveId: record.id,
    available: Boolean(reportUrl || files.pdf || files.docx),
    reportUrl,
    markdownUrl: files.markdown || files.report || '',
    docxUrl: files.docx || '',
    pdfUrl: files.pdf || '',
    originalUrl: files.original || '',
    jsonUrl: files.json || '',
    files
  };
}

export function contentDispositionFilename(record, file) {
  const base = `${record?.essayTitle || record?.id || 'archive'}-${file?.name || 'file'}`;
  const fallback = base.replace(/[^\w.-]+/g, '_') || 'archive-file';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(base)}`;
}

export function applyRange(buffer, rangeHeader) {
  if (!rangeHeader) return null;
  const match = String(rangeHeader).match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const total = buffer.length;
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= total) {
    return { invalid: true, total };
  }
  end = Math.min(end, total - 1);
  return {
    start,
    end,
    total,
    buffer: buffer.subarray(start, end + 1)
  };
}

export function auditFileAccess(appDir, event, details = {}) {
  try {
    const file = path.join(appDir, AUDIT_LOG);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      archiveId: details.archiveId || '',
      fileType: details.fileType || '',
      result: details.result || '',
      statusCode: details.statusCode || undefined,
      actorId: details.actorId || '',
      message: details.message ? redact(details.message) : undefined
    })}\n`, 'utf8');
  } catch {
    // audit must not break downloads
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function listHtml(items) {
  const list = Array.isArray(items) ? items : [items].filter(Boolean);
  if (!list.length) return '<li>暂无</li>';
  return list.map((item) => `<li>${escapeHtml(formatValue(item))}</li>`).join('');
}

function formatValue(value) {
  if (value == null || value === '') return '暂无';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatValue).join('\n');
  if (value.focus || value.title || value.type) {
    return [
      value.type ? `【${value.type}】` : '',
      value.focus || value.title || '',
      value.goal ? `目标：${value.goal}` : '',
      value.task ? `任务：${value.task}` : '',
      value.diagnosis ? `诊断：${value.diagnosis}` : '',
      value.logic_analysis ? `逻辑：${value.logic_analysis}` : '',
      value.action_steps ? `步骤：${value.action_steps}` : '',
      value.example_direction ? `示例：${value.example_direction}` : '',
      value.reason ? `理由：${value.reason}` : '',
      value.usage ? `用法：${value.usage}` : '',
      value.checkpoint ? `自查：${value.checkpoint}` : ''
    ].filter(Boolean).join(' ');
  }
  if (value.paragraph || value.original || value.revision) {
    return [
      value.paragraph ? `第${value.paragraph}段` : '',
      value.original ? `原文：${value.original}` : '',
      value.problem ? `问题：${value.problem}` : '',
      value.revision ? `修改：${value.revision}` : '',
      value.explanation ? `理由：${value.explanation}` : '',
      value.sentence_edits ? `逐句：${formatValue(value.sentence_edits)}` : ''
    ].filter(Boolean).join('\n');
  }
  return Object.entries(value).map(([key, item]) => `${key}：${formatValue(item)}`).join('\n');
}

function paragraphHtml(value) {
  return `<p>${escapeHtml(formatValue(value))}</p>`;
}

export function renderReportHtml({ record, reportJson = {}, links = {} } = {}) {
  const reportVersion = reportJson?.metadata?.reportVersion || reportJson?.reportVersion || record?.archiveVersion || '2.0';
  const teacherEssayUrl = links.teacherEssayUrl || '';
  const studentReportUrl = links.studentReportUrl || '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(record?.essayTitle || '作文 AI 批改报告')}</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f5f7f6; color: #16201d; }
    main { max-width: 860px; margin: 0 auto; padding: 24px 16px 56px; }
    header { padding: 20px 0; }
    h1 { font-size: 28px; margin: 0 0 8px; letter-spacing: 0; }
    h2 { border-left: 4px solid #1f7a68; font-size: 20px; margin: 28px 0 12px; padding-left: 10px; }
    .meta, section { background: #fff; border: 1px solid #dde5e1; border-radius: 8px; padding: 16px; }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    .meta b { display: block; font-size: 13px; color: #64726e; margin-bottom: 4px; }
    ul { margin: 0; padding-left: 20px; }
    .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
    .actions a { background: #1f7a68; border-radius: 8px; color: #fff; display: inline-block; padding: 10px 14px; text-decoration: none; }
    .actions a.secondary { background: #eef4f1; color: #1f5047; }
  </style>
</head>
<body>
  <main>
    <header>
      <p style="margin:0 0 8px;color:#5f716d;font-size:14px;">这是飞书归档预览页，仅用于快速预览与下载。</p>
      <h1>作文 AI 批改报告</h1>
      <p>${escapeHtml(record?.essayTitle || '未命名作文')}</p>
      <div class="actions">
        ${teacherEssayUrl ? `<a class="secondary" href="${escapeHtml(teacherEssayUrl)}">进入教师工作台</a>` : ''}
        ${studentReportUrl ? `<a class="secondary" href="${escapeHtml(studentReportUrl)}">查看我的作文报告</a>` : ''}
        ${links.docxUrl ? `<a href="${escapeHtml(links.docxUrl)}">下载 Word</a>` : ''}
        ${links.pdfUrl ? `<a href="${escapeHtml(links.pdfUrl)}">下载 PDF</a>` : ''}
        ${links.markdownUrl ? `<a class="secondary" href="${escapeHtml(links.markdownUrl)}">下载 Markdown</a>` : ''}
      </div>
    </header>
    <div class="meta">
      <div><b>学生</b>${escapeHtml(record?.studentName || '未填写')}</div>
      <div><b>班级</b>${escapeHtml(record?.className || '未填写')}</div>
      <div><b>总分</b>${escapeHtml(record?.score ?? reportJson.score ?? '未评分')}</div>
      <div><b>等级</b>${escapeHtml(record?.grade || reportJson.grade || reportJson.level || '未填写')}</div>
      <div><b>报告版本</b>${escapeHtml(reportVersion)}</div>
      <div><b>模型</b>${escapeHtml(record?.provider || 'unknown')} / ${escapeHtml(record?.model || 'unknown')}</div>
    </div>
    <section><h2>总体评价</h2>${paragraphHtml(reportJson.overallEvaluation || reportJson.overall_evaluation || reportJson.teacherComment || reportJson.teacher_comment || record?.teacherComment || '暂无')}</section>
    <section><h2>核心优点</h2><ul>${listHtml(reportJson.strengths || reportJson.coreAdvantages)}</ul></section>
    <section><h2>主要问题</h2><ul>${listHtml(reportJson.problems || reportJson.weaknesses || reportJson.mainProblems)}</ul></section>
    <section><h2>审题立意</h2>${paragraphHtml(reportJson.intentAnalysis || reportJson.topic_intent_analysis || reportJson.intent_analysis || '暂无')}</section>
    <section><h2>结构分析</h2>${paragraphHtml(reportJson.structureAnalysis || reportJson.structure_analysis || '暂无')}</section>
    <section><h2>逻辑论证</h2>${paragraphHtml(reportJson.logicAnalysis || reportJson.logic_analysis || '暂无')}</section>
    <section><h2>语言表达</h2>${paragraphHtml(reportJson.languageAnalysis || reportJson.language_analysis || '暂无')}</section>
    <section><h2>素材分析</h2>${paragraphHtml(reportJson.materialAnalysis || reportJson.material_analysis || '暂无')}<ul>${listHtml(reportJson.recommendedMaterials || reportJson.recommended_materials)}</ul></section>
    <section><h2>高考评分</h2>${paragraphHtml(reportJson.gaokaoScoring || reportJson.gaokao_scoring || reportJson.gaokao_dimensions || '暂无')}</section>
    <section><h2>修改建议</h2><ul>${listHtml(reportJson.suggestions)}</ul></section>
    <section><h2>逐段精修</h2><ul>${listHtml(reportJson.paragraphRefinements || reportJson.paragraph_refinements || reportJson.paragraph_rewrites)}</ul></section>
    <section><h2>段落分析</h2><ul>${listHtml(reportJson.paragraphAnalysis || reportJson.paragraph_analysis)}</ul></section>
    <section><h2>句子分析</h2><ul>${listHtml(reportJson.sentenceAnalysis || reportJson.sentence_analysis)}</ul></section>
    <section><h2>整篇升格文章</h2>${paragraphHtml(reportJson.excellentVersion || reportJson.excellent_version || reportJson.polished_full_text || '暂无')}</section>
    <section><h2>教师点评</h2>${paragraphHtml(reportJson.teacherComment || reportJson.teacher_comment || reportJson.teacher_overall || record?.teacherComment || '暂无')}</section>
    <section><h2>训练任务</h2><ul>${listHtml(reportJson.trainingTasks || reportJson.training_tasks || reportJson.nextTraining || reportJson.next_training)}</ul></section>
    <section><h2>成长分析</h2>${paragraphHtml(reportJson.growthAnalysis || reportJson.growth_analysis || '暂无')}</section>
  </main>
</body>
</html>`;
}
