import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

const DEFAULT_ROOT_DIR = 'Chinese Teacher AI Studio';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_URL = 'http://192.168.100.164:5005';
const QUEUE_DIR = path.join('data', 'storage-queue');
const QUEUE_FILE = 'zspace-pending.json';

const BASE_DIRECTORIES = [
  '01_作文中心',
  '01_作文中心/原文',
  '01_作文中心/OCR文本',
  '01_作文中心/批改报告',
  '01_作文中心/PDF',
  '01_作文中心/Word',
  '02_学生档案',
  '03_教师备课',
  '04_PPT中心',
  '05_试卷中心',
  '06_作文素材库',
  '07_AI知识库',
  '08_OCR识别',
  '09_AI批改报告',
  '10_模板中心',
  '11_系统日志',
  '11_系统日志/connection-tests',
  '99_Backup'
];

function boolEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function safeErrorMessage(error) {
  return String(error?.message || error || '未知错误')
    .replace(/Basic\s+[A-Za-z0-9+/=]+/g, 'Basic ***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
    .replace(/password=[^&\s]+/gi, 'password=***')
    .slice(0, 500);
}

function parseConfig(env = process.env) {
  const enabled = boolEnv(env.ZSPACE_ENABLED, false);
  const baseUrl = String(env.ZSPACE_WEBDAV_URL || DEFAULT_URL).trim();
  const username = String(env.ZSPACE_WEBDAV_USERNAME || '').trim();
  const password = String(env.ZSPACE_WEBDAV_PASSWORD || '');
  const rootDirectory = String(env.ZSPACE_ROOT_DIR || DEFAULT_ROOT_DIR).trim() || DEFAULT_ROOT_DIR;
  const allowSelfSigned = boolEnv(env.ZSPACE_ALLOW_SELF_SIGNED, false);
  const timeoutMs = Math.max(1000, Number(env.ZSPACE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  let parsedUrl;

  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error('ZSPACE_WEBDAV_URL 格式无效，请填写 http://host:port 或 https://host:port');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || !parsedUrl.hostname) {
    throw new Error('ZSPACE_WEBDAV_URL 只允许 http 或 https 且必须包含主机名');
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new Error('ZSPACE_WEBDAV_URL 不允许包含用户名或密码，请使用环境变量 ZSPACE_WEBDAV_USERNAME/ZSPACE_WEBDAV_PASSWORD');
  }
  if (enabled && (!username || !password)) {
    throw new Error('ZSPACE_WEBDAV_USERNAME 或 ZSPACE_WEBDAV_PASSWORD 未配置');
  }

  return {
    enabled,
    baseUrl: parsedUrl.origin,
    username,
    password,
    rootDirectory,
    allowSelfSigned,
    timeoutMs
  };
}

export function requiredZSpaceDirectories() {
  return [...BASE_DIRECTORIES];
}

export function sanitizePathSegment(value, fallback = '未填写') {
  const cleaned = String(value || '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\.\.+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function sanitizeRemotePath(remotePath) {
  const normalized = String(remotePath || '').replace(/\\/g, '/');
  if (normalized.includes('\0')) throw new Error('远程路径无效');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..' || part.includes('..'))) {
    throw new Error('远程路径不允许路径穿越');
  }
  return parts.map((part) => sanitizePathSegment(part)).join('/');
}

function joinRemote(...parts) {
  return parts.filter((part) => part != null && String(part).trim() !== '')
    .map((part) => sanitizeRemotePath(part))
    .filter(Boolean)
    .join('/');
}

function webDavPath(config, remotePath = '') {
  const root = sanitizeRemotePath(config.rootDirectory);
  const file = sanitizeRemotePath(remotePath);
  const segments = [root, file].filter(Boolean).flatMap((item) => item.split('/').filter(Boolean));
  return `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

function webDavUrl(config, remotePath = '') {
  const url = new URL(config.baseUrl);
  url.pathname = webDavPath(config, remotePath);
  return url.toString();
}

function authHeader(config) {
  return `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`;
}

async function requestWithNode(urlValue, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS, allowSelfSigned = false) {
  const url = new URL(urlValue);
  const transport = url.protocol === 'https:' ? https : http;
  return await new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: timeoutMs,
      rejectUnauthorized: url.protocol === 'https:' ? !allowSelfSigned : undefined
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          status: res.statusCode || 0,
          ok: Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300),
          async text() {
            return body.toString('utf8');
          },
          async arrayBuffer() {
            return body;
          }
        });
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('ETIMEDOUT WebDAV 请求超时'));
    });
    req.on('error', reject);
    if (options.body != null) req.write(options.body);
    req.end();
  });
}

function splitFileName(remotePath) {
  const parsed = path.posix.parse(remotePath);
  return { dir: parsed.dir, base: parsed.name, ext: parsed.ext };
}

function queuePath(appDir) {
  return path.join(appDir, QUEUE_DIR, QUEUE_FILE);
}

function readQueue(appDir) {
  const file = queuePath(appDir);
  if (!fs.existsSync(file)) return { version: 1, tasks: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { version: 1, tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
  } catch {
    return { version: 1, tasks: [] };
  }
}

function writeQueue(appDir, data) {
  const file = queuePath(appDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, tasks: data.tasks || [] }, null, 2)}\n`, 'utf8');
}

function queuePendingUpload({ appDir, artifacts, error, metadata = {} }) {
  const dir = path.join(appDir, QUEUE_DIR, 'payloads');
  fs.mkdirSync(dir, { recursive: true });
  const store = readQueue(appDir);
  const queuedAt = new Date().toISOString();
  for (const artifact of artifacts) {
    const taskId = randomUUID();
    const payloadPath = path.join(dir, `${taskId}-${sanitizePathSegment(path.basename(artifact.remotePath), 'payload')}`);
    fs.writeFileSync(payloadPath, artifact.buffer);
    store.tasks.push({
      task_id: taskId,
      provider: 'zspace-webdav',
      remote_path: artifact.remotePath,
      local_path: payloadPath,
      content_type: artifact.contentType || 'application/octet-stream',
      status: 'pending',
      retry_count: 0,
      last_error: safeErrorMessage(error),
      created_at: queuedAt,
      updated_at: queuedAt,
      metadata
    });
  }
  writeQueue(appDir, store);
  return store.tasks.slice(-artifacts.length);
}

export function queueZSpaceUploadArtifacts({ appDir, artifacts, error, metadata = {} }) {
  return queuePendingUpload({ appDir, artifacts, error, metadata });
}

function markdownReport({ essay = {}, review = {} }) {
  const raw = review.raw_json ? JSON.parse(review.raw_json) : review;
  const strengths = Array.isArray(raw.strengths) ? raw.strengths : [];
  const problems = Array.isArray(raw.problems) ? raw.problems : [];
  const suggestions = Array.isArray(raw.suggestions) ? raw.suggestions : [];
  return `# ${essay.title || '未命名作文'} 批改报告

- 分数：${review.total_score ?? raw.total_score ?? ''}
- 等级：${review.level || raw.level || ''}

## 原文
${essay.original_text || ''}

## 优点
${strengths.length ? strengths.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n') : '- 未填写'}

## 问题
${problems.length ? problems.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n') : '- 未填写'}

## 建议
${suggestions.length ? suggestions.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n') : '- 未填写'}
`;
}

function timestampId() {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}_${randomUUID().slice(0, 8)}`;
}

function essayFileStem(context) {
  return sanitizePathSegment([
    context.metadata.createdAt ? new Date(context.metadata.createdAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    context.metadata.studentId || 'student',
    context.metadata.studentName || '未填写',
    context.metadata.essayTitle || `essay-${context.essay.id}`,
    context.essay.id
  ].join('_'));
}

function makeDocxBuffer(title, sections) {
  const children = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })];
  for (const section of sections) {
    children.push(new Paragraph({ text: section.title, heading: HeadingLevel.HEADING_2 }));
    const content = Array.isArray(section.content) ? section.content : [section.content || ''];
    for (const item of content) {
      children.push(new Paragraph({ children: [new TextRun(String(item || ''))] }));
    }
  }
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

function makePdfBuffer(title, markdown) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const fontCandidates = [
      '/Library/Fonts/Arial Unicode.ttf',
      '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
      '/System/Library/Fonts/STHeiti Medium.ttc'
    ];
    const fontPath = fontCandidates.find((candidate) => fs.existsSync(candidate));
    if (fontPath) doc.font(fontPath);
    doc.fontSize(18).text(title);
    doc.moveDown();
    doc.fontSize(10).text(markdown.replace(/```json|```/g, ''), { lineGap: 4 });
    doc.end();
  });
}

function makeArchiveContext(database, essayId) {
  const essay = database.prepare(`
    SELECT e.*, a.title AS assignment_title, s.id AS student_id, s.student_no, s.grade AS student_grade,
           u.name AS student_name, c.name AS class_name, c.grade AS class_grade
    FROM essays e
    JOIN assignments a ON a.id = e.assignment_id
    JOIN students s ON s.id = e.student_id
    JOIN users u ON u.id = s.user_id
    JOIN classes c ON c.id = a.class_id
    WHERE e.id = ?
  `).get(essayId);
  if (!essay) throw new Error('作文不存在，无法归档到极空间');
  const review = database.prepare('SELECT * FROM ai_reviews WHERE essay_id = ? ORDER BY id DESC LIMIT 1').get(essayId);
  if (!review) throw new Error('批改结果不存在，无法归档到极空间');
  const images = database.prepare('SELECT file_path, ocr_text FROM essay_images WHERE essay_id = ? ORDER BY sort_order, id').all(essayId);
  const comments = database.prepare(`
    SELECT tc.id, tc.comment, tc.score_adjustment, tc.created_at, u.name AS teacher_name
    FROM teacher_comments tc
    LEFT JOIN teachers t ON t.id = tc.teacher_id
    LEFT JOIN users u ON u.id = t.user_id
    WHERE tc.essay_id = ?
    ORDER BY tc.created_at ASC, tc.id ASC
  `).all(essayId);
  const scoreTrend = database.prepare(`
    SELECT e.id AS essay_id, e.title, e.created_at, ar.total_score, ar.level
    FROM essays e
    LEFT JOIN ai_reviews ar ON ar.essay_id = e.id
    WHERE e.student_id = ?
    ORDER BY e.created_at ASC, e.id ASC
  `).all(essay.student_id);
  const grade = sanitizePathSegment(essay.student_grade || essay.class_grade || '未填写');
  const className = sanitizePathSegment(essay.class_name || '未填写');
  const studentName = sanitizePathSegment(essay.student_name || '未填写');
  const date = new Date(essay.created_at || Date.now()).toISOString().slice(0, 10);
  const title = sanitizePathSegment(essay.title || essay.assignment_title || `essay-${essay.id}`);
  const essayBasePath = joinRemote('01_作文中心');
  const ocrBasePath = joinRemote('08_OCR识别');
  const studentFolder = sanitizePathSegment(`${essay.student_no || essay.student_id || '未填写'}_${essay.student_name || '未填写'}`);
  const metadata = {
    studentName: essay.student_name || '',
    studentId: String(essay.student_id || ''),
    grade,
    className,
    essayTitle: essay.title || essay.assignment_title || '',
    score: review.total_score ?? null,
    level: review.level || '',
    source: 'web',
    createdAt: essay.created_at || '',
    archivedAt: new Date().toISOString(),
    storageProvider: 'zspace-webdav'
  };
  return { essay, review, images, comments, scoreTrend, essayBasePath, ocrBasePath, studentFolder, metadata };
}

async function archiveArtifacts(context) {
  const reviewRaw = context.review.raw_json ? JSON.parse(context.review.raw_json) : context.review;
  const stem = essayFileStem(context);
  const reportMarkdown = markdownReport({ essay: context.essay, review: context.review });
  const docxBuffer = await makeDocxBuffer('作文自动批改报告', [
    { title: '作文信息', content: [`学生：${context.metadata.studentName}`, `题目：${context.metadata.essayTitle}`, `分数：${context.metadata.score ?? ''}`, `等级：${context.metadata.level}`] },
    { title: '学生原文', content: context.essay.original_text || '' },
    { title: 'AI批改记录', content: JSON.stringify(reviewRaw, null, 2) },
    { title: '教师点评', content: context.comments.map((comment) => `${comment.teacher_name || '教师'}：${comment.comment}`) }
  ]);
  const pdfBuffer = await makePdfBuffer('作文自动批改报告', reportMarkdown);
  const artifacts = [
    {
      remotePath: joinRemote('01_作文中心/原文', `${stem}.txt`),
      contentType: 'text/plain; charset=utf-8',
      buffer: Buffer.from(context.essay.original_text || '', 'utf8')
    },
    {
      remotePath: joinRemote('01_作文中心/原文', `${stem}.json`),
      contentType: 'application/json; charset=utf-8',
      buffer: Buffer.from(JSON.stringify(context.essay, null, 2), 'utf8')
    },
    {
      remotePath: joinRemote('01_作文中心/批改报告', `${stem}-grading-result.json`),
      contentType: 'application/json; charset=utf-8',
      buffer: Buffer.from(JSON.stringify(reviewRaw, null, 2), 'utf8')
    },
    {
      remotePath: joinRemote('01_作文中心/批改报告', `${stem}-grading-report.md`),
      contentType: 'text/markdown; charset=utf-8',
      buffer: Buffer.from(reportMarkdown, 'utf8')
    },
    {
      remotePath: joinRemote('01_作文中心/PDF', `${stem}.pdf`),
      contentType: 'application/pdf',
      buffer: pdfBuffer
    },
    {
      remotePath: joinRemote('01_作文中心/Word', `${stem}.docx`),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: docxBuffer
    },
    {
      remotePath: joinRemote('01_作文中心/批改报告', `${stem}-metadata.json`),
      contentType: 'application/json; charset=utf-8',
      buffer: Buffer.from(JSON.stringify(context.metadata, null, 2), 'utf8')
    },
    {
      remotePath: joinRemote('02_学生档案', context.studentFolder, '历次作文', `${stem}.txt`),
      contentType: 'text/plain; charset=utf-8',
      buffer: Buffer.from(context.essay.original_text || '', 'utf8')
    },
    {
      remotePath: joinRemote('02_学生档案', context.studentFolder, '历次作文', `${stem}.json`),
      contentType: 'application/json; charset=utf-8',
      buffer: Buffer.from(JSON.stringify(context.essay, null, 2), 'utf8')
    },
    {
      remotePath: joinRemote('02_学生档案', context.studentFolder, 'AI批改记录', `${stem}.json`),
      contentType: 'application/json; charset=utf-8',
      buffer: Buffer.from(JSON.stringify(reviewRaw, null, 2), 'utf8')
    },
    {
      remotePath: joinRemote('02_学生档案', context.studentFolder, '分数变化', 'score-trend.json'),
      contentType: 'application/json; charset=utf-8',
      buffer: Buffer.from(JSON.stringify(context.scoreTrend, null, 2), 'utf8')
    },
    {
      remotePath: joinRemote('02_学生档案', context.studentFolder, '教师点评', `${stem}.json`),
      contentType: 'application/json; charset=utf-8',
      buffer: Buffer.from(JSON.stringify(context.comments, null, 2), 'utf8')
    }
  ];
  for (const [index, image] of context.images.entries()) {
    if (image.ocr_text) {
      artifacts.push({
        remotePath: joinRemote('01_作文中心/OCR文本', `${stem}-ocr-${index + 1}.txt`),
        contentType: 'text/plain; charset=utf-8',
        buffer: Buffer.from(image.ocr_text, 'utf8')
      });
      artifacts.push({
        remotePath: joinRemote('08_OCR识别', `${stem}-ocr-${index + 1}.txt`),
        contentType: 'text/plain; charset=utf-8',
        buffer: Buffer.from(image.ocr_text, 'utf8')
      });
    }
  }
  return artifacts;
}

export async function buildFormalEssayArtifacts({ database, essayId } = {}) {
  const context = makeArchiveContext(database, essayId);
  const artifacts = await archiveArtifacts(context);
  return { context, artifacts };
}

export function formalStoragePathFor(category, filename = `artifact-${timestampId()}.json`) {
  const directories = {
    essayOriginal: '01_作文中心/原文',
    essayOcr: '01_作文中心/OCR文本',
    essayReport: '01_作文中心/批改报告',
    essayPdf: '01_作文中心/PDF',
    essayWord: '01_作文中心/Word',
    studentProfile: '02_学生档案',
    teacherPrep: '03_教师备课',
    ppt: '04_PPT中心',
    paper: '05_试卷中心',
    ocrCache: '08_OCR识别',
    systemLog: '11_系统日志'
  };
  return joinRemote(directories[category] || '11_系统日志', filename);
}

export async function uploadFormalArtifact({ appDir = process.cwd(), client, category, filename, data, text, buffer, contentType, logger = console } = {}) {
  const zspaceClient = client || createZSpaceClient();
  if (!zspaceClient?.config?.enabled) return { ok: true, skipped: true, reason: 'ZSPACE_ENABLED=false' };
  const payload = Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(text != null ? String(text) : JSON.stringify(data ?? {}, null, 2), 'utf8');
  const resolvedContentType = contentType || (text != null ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8');
  const remotePath = formalStoragePathFor(category, sanitizePathSegment(filename || `artifact-${timestampId()}.json`));
  const artifact = { remotePath, buffer: payload, contentType: resolvedContentType };
  try {
    await zspaceClient.uploadBuffer(remotePath, payload, resolvedContentType);
    return { ok: true, queued: false, remotePath };
  } catch (error) {
    const queued = queuePendingUpload({
      appDir,
      artifacts: [artifact],
      error,
      metadata: {
        category,
        filename: artifact.remotePath,
        storageProvider: 'zspace-webdav',
        archivedAt: new Date().toISOString()
      }
    });
    logger.warn?.('极空间正式产物归档失败，已写入本地待重试队列', { message: safeErrorMessage(error), queued: queued.length });
    return { ok: false, queued: true, files: queued.length, error: safeErrorMessage(error), remotePath };
  }
}

export function uploadFormalArtifactAsync(options = {}) {
  setImmediate(() => {
    uploadFormalArtifact(options).catch((error) => {
      options.logger?.warn?.('极空间正式产物后台归档异常，已忽略以保护主流程', { message: safeErrorMessage(error) });
    });
  });
}

export async function retryPendingUploads({ appDir, client, logger = console } = {}) {
  const store = readQueue(appDir);
  let synced = 0;
  let failed = 0;
  for (const task of store.tasks.filter((item) => item.status === 'pending')) {
    try {
      await client.uploadBuffer(task.remote_path, fs.readFileSync(task.local_path), task.content_type);
      task.status = 'synced';
      task.last_error = '';
      task.synced_at = new Date().toISOString();
      task.updated_at = task.synced_at;
      synced += 1;
    } catch (error) {
      task.retry_count = Number(task.retry_count || 0) + 1;
      task.last_error = safeErrorMessage(error);
      task.updated_at = new Date().toISOString();
      failed += 1;
      logger.warn?.('极空间待上传任务同步失败', { message: task.last_error });
    }
  }
  writeQueue(appDir, store);
  return { synced, failed, pending: store.tasks.filter((item) => item.status === 'pending').length };
}

export function createZSpaceClient({ env = process.env, fetchImpl, logger = console } = {}) {
  const config = parseConfig(env);
  const request = fetchImpl
    ? (url, options) => fetchImpl(url, options)
    : (url, options) => requestWithNode(url, options, config.timeoutMs, config.allowSelfSigned);

  async function davRequest(remotePath, { method = 'GET', headers = {}, body } = {}) {
    const requestHeaders = {
      Authorization: authHeader(config),
      ...headers
    };
    const response = await request(webDavUrl(config, remotePath), { method, headers: requestHeaders, body });
    return response;
  }

  async function fileExists(remotePath) {
    const response = await davRequest(remotePath, { method: 'PROPFIND', headers: { Depth: '0' } });
    if ([200, 207].includes(response.status)) return true;
    if (response.status === 404) return false;
    if ([401, 403].includes(response.status)) throw new Error(`WebDAV 无权限访问：HTTP ${response.status}`);
    return false;
  }

  async function ensureDirectory(remotePath = '') {
    const safePath = sanitizeRemotePath(remotePath);
    const segments = safePath.split('/').filter(Boolean);
    let current = '';
    if (!await fileExists('')) {
      const rootResponse = await davRequest('', { method: 'MKCOL' });
      if (![201, 405].includes(rootResponse.status) && !(rootResponse.status === 409 && await fileExists(''))) {
        throw new Error(`WebDAV 创建根目录失败：HTTP ${rootResponse.status}`);
      }
    }
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (await fileExists(current)) continue;
      const response = await davRequest(current, { method: 'MKCOL' });
      if (![201, 405].includes(response.status) && !(response.status === 409 && await fileExists(current))) {
        throw new Error(`WebDAV 创建目录失败：HTTP ${response.status}`);
      }
    }
    return { ok: true, path: safePath };
  }

  async function ensureBaseDirectories() {
    let created = 0;
    let existed = 0;
    let failed = 0;
    const details = [];
    for (const directory of BASE_DIRECTORIES) {
      try {
        const existedBefore = await fileExists(directory);
        await ensureDirectory(directory);
        existed += existedBefore ? 1 : 0;
        created += existedBefore ? 0 : 1;
        details.push({ path: directory, status: existedBefore ? 'exists' : 'created' });
      } catch (error) {
        failed += 1;
        details.push({ path: directory, status: 'failed', error: safeErrorMessage(error) });
      }
    }
    return { total: BASE_DIRECTORIES.length, created, existed, failed, details };
  }

  async function uniqueRemotePath(remotePath) {
    const safePath = sanitizeRemotePath(remotePath);
    if (!await fileExists(safePath)) return safePath;
    const parsed = splitFileName(safePath);
    return path.posix.join(parsed.dir, `${parsed.base}-${Date.now()}-${randomUUID().slice(0, 8)}${parsed.ext}`);
  }

  async function uploadBuffer(remotePath, buffer, contentType = 'application/octet-stream') {
    const safePath = await uniqueRemotePath(remotePath);
    await ensureDirectory(path.posix.dirname(safePath));
    const response = await davRequest(safePath, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: Buffer.from(buffer)
    });
    if (![200, 201, 204].includes(response.status)) throw new Error(`WebDAV 上传失败：HTTP ${response.status}`);
    return { ok: true, remotePath: safePath };
  }

  async function uploadText(remotePath, text) {
    return uploadBuffer(remotePath, Buffer.from(String(text || ''), 'utf8'), 'text/plain; charset=utf-8');
  }

  async function uploadJson(remotePath, data) {
    return uploadBuffer(remotePath, Buffer.from(JSON.stringify(data, null, 2), 'utf8'), 'application/json; charset=utf-8');
  }

  async function downloadFile(remotePath) {
    const safePath = sanitizeRemotePath(remotePath);
    const response = await davRequest(safePath, { method: 'GET' });
    if (!response.ok) throw new Error(`WebDAV 下载失败：HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async function listDirectory(remotePath = '') {
    const response = await davRequest(remotePath, { method: 'PROPFIND', headers: { Depth: '1' } });
    if (![200, 207].includes(response.status)) throw new Error(`WebDAV 列目录失败：HTTP ${response.status}`);
    const body = await response.text();
    return [...body.matchAll(/<[^>]*href[^>]*>([^<]+)<\/[^>]*href>/g)].map((match) => decodeURIComponent(match[1]));
  }

  async function deleteFile(remotePath) {
    const safePath = sanitizeRemotePath(remotePath);
    const response = await davRequest(safePath, { method: 'DELETE' });
    if (![200, 202, 204, 404].includes(response.status)) throw new Error(`WebDAV 删除失败：HTTP ${response.status}`);
    return { ok: true };
  }

  async function testConnection() {
    const checkedAt = new Date().toISOString();
    const startedAt = Date.now();
    if (!config.enabled) {
      return { enabled: false, connected: false, baseUrl: config.baseUrl, rootDirectory: config.rootDirectory, writable: false, latencyMs: 0, checkedAt, error: 'ZSPACE_ENABLED=false' };
    }
    try {
      const rootResponse = await davRequest('', { method: 'PROPFIND', headers: { Depth: '0' } });
      if (![200, 207, 404].includes(rootResponse.status)) {
        throw new Error(`WebDAV 登录或根目录检查失败：HTTP ${rootResponse.status}`);
      }
      await ensureDirectory('11_系统日志/connection-tests');
      const content = `zspace-connection-test-${checkedAt}-${randomUUID()}`;
      const remotePath = `11_系统日志/connection-tests/${Date.now()}-${randomUUID()}.txt`;
      await uploadText(remotePath, content);
      const downloaded = await downloadFile(remotePath);
      if (downloaded.toString('utf8') !== content) throw new Error('WebDAV 读写校验内容不一致');
      await deleteFile(remotePath);
      return { enabled: true, connected: true, baseUrl: config.baseUrl, rootDirectory: config.rootDirectory, writable: true, latencyMs: Date.now() - startedAt, checkedAt, error: null };
    } catch (error) {
      logger.warn?.('极空间 WebDAV 连接测试失败', { message: safeErrorMessage(error) });
      return { enabled: config.enabled, connected: false, baseUrl: config.baseUrl, rootDirectory: config.rootDirectory, writable: false, latencyMs: Date.now() - startedAt, checkedAt, error: safeErrorMessage(error) };
    }
  }

  let scheduler = null;
  const clientApi = {
    config,
    testConnection,
    ensureDirectory,
    ensureBaseDirectories,
    uploadBuffer,
    uploadText,
    uploadJson,
    downloadFile,
    fileExists,
    listDirectory,
    deleteFile,
    sanitizePathSegment,
    retryPendingUploads({ appDir }) {
      return retryPendingUploads({ appDir, client: clientApi, logger });
    },
    startPendingUploadScheduler({ appDir, intervalMs = 60000 } = {}) {
      if (!config.enabled || scheduler) return scheduler;
      scheduler = setInterval(() => {
        retryPendingUploads({ appDir, client: clientApi, logger }).catch((error) => {
          logger.warn?.('极空间待上传队列自动同步失败', { message: safeErrorMessage(error) });
        });
      }, Math.max(10000, Number(intervalMs || 60000)));
      scheduler.unref?.();
      return scheduler;
    },
    stopPendingUploadScheduler() {
      if (scheduler) clearInterval(scheduler);
      scheduler = null;
    }
  };

  return clientApi;
}

export async function archiveEssayToZSpace({ appDir = process.cwd(), database, essayId, client, logger = console } = {}) {
  const zspaceClient = client || createZSpaceClient();
  if (!zspaceClient?.config?.enabled) return { ok: true, skipped: true, reason: 'ZSPACE_ENABLED=false' };
  const { context, artifacts } = await buildFormalEssayArtifacts({ appDir, database, essayId });
  try {
    for (const artifact of artifacts) {
      await zspaceClient.uploadBuffer(artifact.remotePath, artifact.buffer, artifact.contentType);
    }
    return { ok: true, queued: false, files: artifacts.length, basePath: context.essayBasePath };
  } catch (error) {
    const queued = queuePendingUpload({ appDir, artifacts, error, metadata: context.metadata });
    logger.warn?.('极空间归档失败，已写入本地待重试队列', { message: safeErrorMessage(error), queued: queued.length });
    return { ok: false, queued: true, files: queued.length, error: safeErrorMessage(error), basePath: context.essayBasePath };
  }
}

export function archiveEssayToZSpaceAsync({ appDir, database, essayId, client, logger = console } = {}) {
  setImmediate(() => {
    archiveEssayToZSpace({ appDir, database, essayId, client, logger }).catch((error) => {
      logger.warn?.('极空间后台归档异常，已忽略以保护主流程', { message: safeErrorMessage(error) });
    });
  });
}
