import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sectionsToDocxBuffer, sectionsToPdfBuffer } from './exporter.js';
import { createZSpaceClient, queueZSpaceUploadArtifacts, sanitizePathSegment } from './zspace-storage.js';
import { updateStudentGrowthProfileAsync } from './student-profile/profile-service.js';
import { parseJson } from '../utils/json.js';

const ARCHIVE_VERSION = '1.1';
const ARCHIVE_INDEX = path.join('data', 'archive-records.json');
const ARCHIVE_LOG = path.join('logs', 'archive.log');

function safeErrorMessage(error) {
  return String(error?.message || error || '未知错误')
    .replace(/Basic\s+[A-Za-z0-9+/=]+/g, 'Basic ***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
    .replace(/password=[^&\s]+/gi, 'password=***')
    .slice(0, 500);
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function appIndexPath(appDir) {
  return path.join(appDir, ARCHIVE_INDEX);
}

export function readArchiveRecords(appDir = process.cwd()) {
  const file = appIndexPath(appDir);
  if (!fs.existsSync(file)) return { version: 1, records: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { version: 1, records: Array.isArray(parsed.records) ? parsed.records : [] };
  } catch {
    return { version: 1, records: [] };
  }
}

function writeArchiveRecords(appDir, data) {
  const file = appIndexPath(appDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ version: 1, records: data.records || [] }, null, 2)}\n`, 'utf8');
}

function upsertArchiveRecord(appDir, record) {
  const store = readArchiveRecords(appDir);
  const index = store.records.findIndex((item) => item.id === record.id);
  if (index >= 0) store.records[index] = { ...store.records[index], ...record, updatedAt: new Date().toISOString() };
  else store.records.unshift({ ...record, updatedAt: new Date().toISOString() });
  writeArchiveRecords(appDir, store);
  return record;
}

export function getArchiveRecord(appDir, id) {
  return readArchiveRecords(appDir).records.find((record) => String(record.id) === String(id)) || null;
}

export function listArchiveRecords(appDir, filters = {}) {
  const query = String(filters.search || '').trim();
  let rows = readArchiveRecords(appDir).records;
  if (filters.className) rows = rows.filter((record) => record.className === filters.className);
  if (filters.student) rows = rows.filter((record) => `${record.studentId}${record.studentName}`.includes(filters.student));
  if (filters.month) rows = rows.filter((record) => String(record.createdAt || '').startsWith(filters.month));
  if (filters.title) rows = rows.filter((record) => String(record.essayTitle || '').includes(filters.title));
  if (query) {
    rows = rows.filter((record) => `${record.className}${record.studentId}${record.studentName}${record.essayTitle}${record.archiveStatus}`.includes(query));
  }
  const sort = String(filters.sort || 'createdAt_desc');
  return [...rows].sort((a, b) => {
    if (sort === 'title_asc') return String(a.essayTitle || '').localeCompare(String(b.essayTitle || ''), 'zh-CN');
    if (sort === 'student_asc') return String(a.studentName || '').localeCompare(String(b.studentName || ''), 'zh-CN');
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
}

export function deleteArchiveRecord(appDir, id) {
  const store = readArchiveRecords(appDir);
  const before = store.records.length;
  store.records = store.records.filter((record) => String(record.id) !== String(id));
  writeArchiveRecords(appDir, store);
  return { deleted: before - store.records.length };
}

function logArchive(appDir, event, details = {}) {
  const file = path.join(appDir, ARCHIVE_LOG);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const line = {
    time: new Date().toISOString(),
    event,
    ...details,
    error: details.error ? safeErrorMessage(details.error) : undefined
  };
  fs.appendFileSync(file, `${JSON.stringify(line)}\n`, 'utf8');
}

export function buildArchiveRemoteBasePath({ className, studentNo, studentName, essayTitle, createdAt }) {
  const date = new Date(createdAt || Date.now());
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = String(safeDate.getFullYear());
  const month = `${year}-${String(safeDate.getMonth() + 1).padStart(2, '0')}`;
  const studentFolder = sanitizePathSegment(`${studentNo || '未填写'}_${studentName || '未填写'}`);
  return [
    'Archive',
    sanitizePathSegment(className || '未填写'),
    studentFolder,
    year,
    month,
    sanitizePathSegment(essayTitle || `作文-${Date.now()}`)
  ].join('/');
}

function pickDimension(raw, names) {
  const dimensions = Array.isArray(raw.dimension_scores) ? raw.dimension_scores : [];
  return dimensions.find((item) => names.some((name) => String(item?.name || '').includes(name))) || null;
}

function normalizeReviewJson(review, reviewRaw) {
  const raw = reviewRaw || {};
  const dimensionScores = Array.isArray(raw.dimension_scores) ? raw.dimension_scores : parseJson(review.dimension_scores, []);
  const normalized = {
    score: raw.total_score ?? review.total_score ?? null,
    grade: raw.level || review.level || '',
    level: raw.level || review.level || '',
    overallEvaluation: raw.overall_evaluation || raw.overallEvaluation || raw.teacher_comment || raw.teacher_overall || '',
    strengths: Array.isArray(raw.strengths) ? raw.strengths : parseJson(review.strengths, []),
    problems: Array.isArray(raw.problems) ? raw.problems : parseJson(review.problems, []),
    weaknesses: Array.isArray(raw.weaknesses) ? raw.weaknesses : parseJson(review.problems, []),
    dimensionScores,
    logicAnalysis: raw.logic_analysis || raw.logicAnalysis || raw.thinking_coach?.diagnosis || raw.thinking_coach || raw.thinking_improvement || pickDimension({ dimension_scores: dimensionScores }, ['逻辑', '结构'])?.comment || '',
    languageAnalysis: raw.language_analysis || raw.languageAnalysis || pickDimension({ dimension_scores: dimensionScores }, ['语言', '表达'])?.comment || '',
    intentAnalysis: raw.topic_intent_analysis || raw.topicIntentAnalysis || raw.intent_analysis || raw.idea_analysis || pickDimension({ dimension_scores: dimensionScores }, ['审题', '立意'])?.comment || '',
    structureAnalysis: raw.structure_analysis || raw.structureAnalysis || pickDimension({ dimension_scores: dimensionScores }, ['结构'])?.comment || '',
    materialAnalysis: raw.material_analysis || raw.materialAnalysis || raw.content_analysis || pickDimension({ dimension_scores: dimensionScores }, ['内容', '素材'])?.comment || '',
    recommendedMaterials: Array.isArray(raw.recommended_materials) ? raw.recommended_materials : raw.recommendedMaterials || [],
    gaokaoScoring: raw.gaokao_scoring || raw.gaokaoScoring || raw.gaokao_dimensions || {},
    paragraphRefinements: Array.isArray(raw.paragraph_refinements) ? raw.paragraph_refinements : (raw.paragraphRefinements || raw.paragraph_rewrites || []),
    paragraphAnalysis: Array.isArray(raw.paragraphAnalysis) ? raw.paragraphAnalysis : (Array.isArray(raw.paragraph_refinements) ? raw.paragraph_refinements : []),
    sentenceAnalysis: Array.isArray(raw.sentenceAnalysis) ? raw.sentenceAnalysis : (Array.isArray(raw.editable_sentences) ? raw.editable_sentences : []),
    excellentVersion: raw.excellent_version || raw.excellentVersion || raw.polished_full_text || '',
    teacherComment: raw.teacher_comment || raw.teacher_overall || review.teacher_overall || '',
    suggestions: Array.isArray(raw.suggestions) ? raw.suggestions : parseJson(review.suggestions, []),
    trainingTasks: Array.isArray(raw.training_tasks) ? raw.training_tasks : (raw.trainingTasks || (Array.isArray(raw.next_training) ? raw.next_training : parseJson(review.next_training, []))),
    growthAnalysis: raw.growth_analysis || raw.growthAnalysis || {},
    raw: jsonClone(raw)
  };
  return normalized;
}

function markdownList(items) {
  const list = Array.isArray(items) ? items : [items].filter(Boolean);
  return list.length ? list.map((item) => `- ${formatContent(item)}`).join('\n') : '- 暂无';
}

function formatContent(value) {
  if (value == null || value === '') return '暂无';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatContent).join('\n');
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
      value.sentence_edits ? `逐句：${formatContent(value.sentence_edits)}` : ''
    ].filter(Boolean).join('\n');
  }
  return Object.entries(value).map(([key, item]) => `${key}：${formatContent(item)}`).join('\n');
}

export function generateArchiveMarkdown({ essay, metadata, reportJson, ocrText }) {
  return `# ${metadata.essayTitle || '未命名作文'} 教师可读批改报告

- 学生：${metadata.studentName || '未填写'}
- 学号：${metadata.studentId || '未填写'}
- 班级：${metadata.className || '未填写'}
- 分数：${metadata.score ?? '未评分'}
- 等级：${metadata.grade || '未填写'}
- 模型：${metadata.provider || 'unknown'} / ${metadata.model || 'unknown'}

## 作文原文
${essay.original_text || ''}

## OCR文本
${ocrText || '无'}

## 评分与等级
${reportJson.score ?? '未评分'}，${reportJson.grade || reportJson.level || '未填写'}

## 总体评价
${reportJson.overallEvaluation || '暂无'}

## 优点
${markdownList(reportJson.strengths)}

## 不足
${markdownList(reportJson.problems || reportJson.weaknesses)}

## 审题立意
${reportJson.intentAnalysis || '暂无'}

## 结构分析
${reportJson.structureAnalysis || '暂无'}

## 逻辑分析
${reportJson.logicAnalysis || '暂无'}

## 语言分析
${reportJson.languageAnalysis || '暂无'}

## 素材分析
${reportJson.materialAnalysis || '暂无'}

### 推荐素材
${markdownList(reportJson.recommendedMaterials)}

## 高考评分
${formatContent(reportJson.gaokaoScoring)}

## 提升建议
${markdownList(reportJson.suggestions)}

## 逐段精修
${markdownList(reportJson.paragraphRefinements)}

## 整篇升格文章
${reportJson.excellentVersion || '暂无'}

## 教师评语
${reportJson.teacherComment || '暂无'}

## 训练任务
${markdownList(reportJson.trainingTasks)}

## 成长分析
${formatContent(reportJson.growthAnalysis)}
`;
}

function originalMarkdown(essay, metadata) {
  return `# ${metadata.essayTitle || '未命名作文'}

- 学生：${metadata.studentName || '未填写'}
- 学号：${metadata.studentId || '未填写'}
- 班级：${metadata.className || '未填写'}
- 提交时间：${metadata.createdAt || ''}

${essay.original_text || ''}
`;
}

function reportSections({ essay, metadata, reportJson, reportMarkdown }) {
  return [
    { title: '作文信息', content: [`学生：${metadata.studentName}`, `学号：${metadata.studentId}`, `班级：${metadata.className}`, `题目：${metadata.essayTitle}`, `分数：${metadata.score ?? ''}`, `等级：${metadata.grade}`] },
    { title: '作文原文', content: essay.original_text || '' },
    { title: '总体评价', content: reportJson.overallEvaluation },
    { title: '主要优点', content: reportJson.strengths },
    { title: '主要不足', content: reportJson.problems || reportJson.weaknesses },
    { title: '审题立意', content: reportJson.intentAnalysis },
    { title: '结构分析', content: reportJson.structureAnalysis },
    { title: '逻辑分析', content: reportJson.logicAnalysis },
    { title: '语言分析', content: reportJson.languageAnalysis },
    { title: '素材分析', content: reportJson.materialAnalysis },
    { title: '推荐素材', content: reportJson.recommendedMaterials },
    { title: '高考评分', content: formatContent(reportJson.gaokaoScoring) },
    { title: '提升建议', content: reportJson.suggestions },
    { title: '逐段精修', content: reportJson.paragraphRefinements },
    { title: '段落分析', content: reportJson.paragraphAnalysis },
    { title: '句子分析', content: reportJson.sentenceAnalysis },
    { title: '整篇升格文章', content: reportJson.excellentVersion },
    { title: '教师评语', content: reportJson.teacherComment },
    { title: '训练任务', content: reportJson.trainingTasks },
    { title: '成长分析', content: formatContent(reportJson.growthAnalysis) },
    { title: 'Markdown报告', content: reportMarkdown }
  ];
}

function collectArchiveContext(database, essayId) {
  const essay = database.prepare(`
    SELECT e.*, a.title AS assignment_title, a.prompt AS assignment_prompt, a.full_score,
           s.id AS internal_student_id, s.student_no, s.grade AS student_grade,
           u.id AS student_user_id, u.name AS student_name,
           c.name AS class_name, c.grade AS class_grade
    FROM essays e
    JOIN assignments a ON a.id = e.assignment_id
    JOIN students s ON s.id = e.student_id
    JOIN users u ON u.id = s.user_id
    JOIN classes c ON c.id = a.class_id
    WHERE e.id = ?
  `).get(essayId);
  if (!essay) throw new Error('作文不存在，无法归档');
  const review = database.prepare('SELECT * FROM ai_reviews WHERE essay_id = ? ORDER BY id DESC LIMIT 1').get(essayId);
  if (!review) throw new Error('批改结果不存在，无法归档');
  const images = database.prepare('SELECT file_path, ocr_text FROM essay_images WHERE essay_id = ? ORDER BY sort_order, id').all(essayId);
  const reviewRaw = review.raw_json ? JSON.parse(review.raw_json) : {};
  return { essay, review, reviewRaw, images };
}

export async function buildArchiveFiles({ database, essayId, now = new Date() } = {}) {
  const { essay, review, reviewRaw, images } = collectArchiveContext(database, essayId);
  const reportJson = normalizeReviewJson(review, reviewRaw);
  const basePath = buildArchiveRemoteBasePath({
    className: essay.class_name,
    studentNo: essay.student_no || essay.internal_student_id,
    studentName: essay.student_name,
    essayTitle: essay.title || essay.assignment_title,
    createdAt: essay.created_at
  });
  const ocrText = images.map((image) => image.ocr_text).filter(Boolean).join('\n\n');
  const metadata = {
    studentId: String(essay.student_no || essay.internal_student_id || ''),
    studentName: essay.student_name || '',
    className: essay.class_name || '',
    essayTitle: essay.title || essay.assignment_title || '',
    createdAt: essay.created_at || '',
    provider: reviewRaw.ai_meta?.provider || reviewRaw.provider || '',
    model: reviewRaw.ai_meta?.model || reviewRaw.model || '',
    score: reportJson.score,
    grade: reportJson.grade,
    wordCount: String(essay.original_text || '').replace(/\s/g, '').length,
    archiveVersion: ARCHIVE_VERSION,
    archiveStatus: 'pending',
    nasPath: basePath
  };
  const reportMarkdown = generateArchiveMarkdown({ essay, metadata, reportJson, ocrText });
  const sections = reportSections({ essay, metadata, reportJson, reportMarkdown });
  const docxBuffer = await sectionsToDocxBuffer('作文自动归档报告', sections);
  const pdfBuffer = await sectionsToPdfBuffer('作文自动归档报告', sections);
  const finalMetadata = { ...metadata, archivedAt: now.toISOString() };
  const artifacts = [
    { remotePath: `${basePath}/original.md`, contentType: 'text/markdown; charset=utf-8', buffer: Buffer.from(originalMarkdown(essay, finalMetadata), 'utf8') },
    { remotePath: `${basePath}/ocr.txt`, contentType: 'text/plain; charset=utf-8', buffer: Buffer.from(ocrText || '', 'utf8') },
    { remotePath: `${basePath}/report.json`, contentType: 'application/json; charset=utf-8', buffer: Buffer.from(JSON.stringify(reportJson, null, 2), 'utf8') },
    { remotePath: `${basePath}/report.md`, contentType: 'text/markdown; charset=utf-8', buffer: Buffer.from(reportMarkdown, 'utf8') },
    { remotePath: `${basePath}/report.docx`, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docxBuffer },
    { remotePath: `${basePath}/report.pdf`, contentType: 'application/pdf', buffer: pdfBuffer },
    { remotePath: `${basePath}/metadata.json`, contentType: 'application/json; charset=utf-8', buffer: Buffer.from(JSON.stringify({ ...finalMetadata, archiveStatus: 'archived' }, null, 2), 'utf8') }
  ];
  return { essay, review, images, reportJson, metadata: finalMetadata, basePath, artifacts };
}

export async function archiveEssayToNAS({ appDir = process.cwd(), database, essayId, client, logger = console } = {}) {
  const startedAt = Date.now();
  const archiveId = `essay-${essayId}`;
  const zspaceClient = client || createZSpaceClient();
  const generated = await buildArchiveFiles({ database, essayId });
  const baseRecord = {
    id: archiveId,
    essayId: String(essayId),
    studentId: generated.metadata.studentId,
    studentName: generated.metadata.studentName,
    studentUserId: generated.essay.student_user_id,
    className: generated.metadata.className,
    essayTitle: generated.metadata.essayTitle,
    createdAt: generated.metadata.createdAt,
    provider: generated.metadata.provider,
    model: generated.metadata.model,
    score: generated.metadata.score,
    grade: generated.metadata.grade,
    wordCount: generated.metadata.wordCount,
    archiveVersion: ARCHIVE_VERSION,
    nasPath: generated.basePath,
    reportJson: generated.reportJson,
    files: generated.artifacts.map((artifact) => ({ name: path.posix.basename(artifact.remotePath), remotePath: artifact.remotePath, contentType: artifact.contentType }))
  };

  if (!zspaceClient?.config?.enabled) {
    const record = upsertArchiveRecord(appDir, { ...baseRecord, archiveStatus: 'skipped', error: 'ZSPACE_ENABLED=false' });
    return { ok: true, skipped: true, queued: false, record, files: generated.artifacts.length, basePath: generated.basePath };
  }

  try {
    logArchive(appDir, 'directory.ensure.start', { path: generated.basePath });
    await zspaceClient.ensureDirectory?.(generated.basePath);
    logArchive(appDir, 'directory.ensure.ok', { path: generated.basePath });
    for (const artifact of generated.artifacts) {
      await zspaceClient.uploadBuffer(artifact.remotePath, artifact.buffer, artifact.contentType);
      logArchive(appDir, 'upload.ok', { remotePath: artifact.remotePath, bytes: artifact.buffer.length });
    }
    const record = upsertArchiveRecord(appDir, {
      ...baseRecord,
      archiveStatus: 'archived',
      archivedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt
    });
    logArchive(appDir, 'archive.ok', { id: archiveId, files: generated.artifacts.length, durationMs: Date.now() - startedAt });
    updateStudentGrowthProfileAsync({
      appDir,
      archiveRecord: record,
      reportJson: generated.reportJson,
      metadata: generated.metadata,
      client: zspaceClient,
      logger
    });
    return { ok: true, queued: false, record, files: generated.artifacts.length, basePath: generated.basePath };
  } catch (error) {
    const queued = queueZSpaceUploadArtifacts({
      appDir,
      artifacts: generated.artifacts,
      error,
      metadata: { ...generated.metadata, archiveId, nasPath: generated.basePath }
    });
    const record = upsertArchiveRecord(appDir, {
      ...baseRecord,
      archiveStatus: 'queued',
      queuedAt: new Date().toISOString(),
      error: safeErrorMessage(error),
      durationMs: Date.now() - startedAt
    });
    logArchive(appDir, 'archive.queued', { id: archiveId, files: queued.length, durationMs: Date.now() - startedAt, error });
    logger.warn?.('作文归档 NAS 上传失败，已写入本地待重试队列', { id: archiveId, message: safeErrorMessage(error), files: queued.length });
    return { ok: false, queued: true, record, files: queued.length, error: safeErrorMessage(error), basePath: generated.basePath };
  }
}

export function archiveEssayToNASAsync({ appDir, database, essayId, client, logger = console } = {}) {
  setImmediate(() => {
    archiveEssayToNAS({ appDir, database, essayId, client, logger }).catch((error) => {
      logger.warn?.('作文 Archive 后台归档异常，已忽略以保护批改主流程', { message: safeErrorMessage(error), essayId });
    });
  });
}

export async function deleteArchiveFromNAS({ appDir, id, client, logger = console } = {}) {
  const record = getArchiveRecord(appDir, id);
  if (!record) return { deleted: 0, filesDeleted: 0 };
  let filesDeleted = 0;
  if (client?.config?.enabled && Array.isArray(record.files)) {
    for (const file of record.files) {
      try {
        await client.deleteFile(file.remotePath);
        filesDeleted += 1;
      } catch (error) {
        logger.warn?.('删除 NAS 归档文件失败，已继续删除本地索引', { message: safeErrorMessage(error), remotePath: file.remotePath });
      }
    }
  }
  const result = deleteArchiveRecord(appDir, id);
  return { ...result, filesDeleted };
}

export async function archiveSyntheticPayload({ appDir = process.cwd(), client, payload, logger = console } = {}) {
  const archiveId = payload.id || `smoke-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const basePath = buildArchiveRemoteBasePath(payload);
  const metadata = {
    studentId: payload.studentNo || payload.studentId || '0000',
    studentName: payload.studentName || 'Smoke',
    className: payload.className || 'Smoke',
    essayTitle: payload.essayTitle || 'Archive Smoke',
    createdAt: payload.createdAt || new Date().toISOString(),
    provider: payload.provider || 'deepseek',
    model: payload.model || 'deepseek-chat',
    score: payload.score ?? 48,
    grade: payload.grade || '二类文',
    wordCount: String(payload.originalText || '').replace(/\s/g, '').length,
    archiveVersion: ARCHIVE_VERSION,
    archiveStatus: 'pending',
    nasPath: basePath
  };
  const reportJson = payload.reportJson || {
    score: metadata.score,
    grade: metadata.grade,
    strengths: ['归档链路可用'],
    problems: [],
    logicAnalysis: 'Smoke 测试逻辑分析',
    languageAnalysis: 'Smoke 测试语言分析',
    intentAnalysis: 'Smoke 测试立意分析',
    materialAnalysis: 'Smoke 测试素材分析',
    suggestions: ['保持链路稳定'],
    trainingTasks: ['定期运行归档 smoke']
  };
  const essay = { original_text: payload.originalText || '青年应当在个人选择中承担时代责任。' };
  const reportMarkdown = generateArchiveMarkdown({ essay, metadata, reportJson, ocrText: payload.ocrText || '' });
  const sections = reportSections({ essay, metadata, reportJson, reportMarkdown });
  const artifacts = [
    { remotePath: `${basePath}/original.md`, contentType: 'text/markdown; charset=utf-8', buffer: Buffer.from(originalMarkdown(essay, metadata), 'utf8') },
    { remotePath: `${basePath}/ocr.txt`, contentType: 'text/plain; charset=utf-8', buffer: Buffer.from(payload.ocrText || '', 'utf8') },
    { remotePath: `${basePath}/report.json`, contentType: 'application/json; charset=utf-8', buffer: Buffer.from(JSON.stringify(reportJson, null, 2), 'utf8') },
    { remotePath: `${basePath}/report.md`, contentType: 'text/markdown; charset=utf-8', buffer: Buffer.from(reportMarkdown, 'utf8') },
    { remotePath: `${basePath}/report.docx`, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: await sectionsToDocxBuffer('作文自动归档报告', sections) },
    { remotePath: `${basePath}/report.pdf`, contentType: 'application/pdf', buffer: await sectionsToPdfBuffer('作文自动归档报告', sections) },
    { remotePath: `${basePath}/metadata.json`, contentType: 'application/json; charset=utf-8', buffer: Buffer.from(JSON.stringify({ ...metadata, archiveStatus: 'archived' }, null, 2), 'utf8') }
  ];
  try {
    logArchive(appDir, 'directory.ensure.start', { path: basePath });
    await client.ensureDirectory(basePath);
    logArchive(appDir, 'directory.ensure.ok', { path: basePath });
    for (const artifact of artifacts) {
      await client.uploadBuffer(artifact.remotePath, artifact.buffer, artifact.contentType);
      logArchive(appDir, 'upload.ok', { remotePath: artifact.remotePath, bytes: artifact.buffer.length });
    }
    const record = upsertArchiveRecord(appDir, { id: archiveId, ...metadata, reportJson: jsonClone(reportJson), archiveStatus: 'archived', files: artifacts.map((artifact) => ({ name: path.posix.basename(artifact.remotePath), remotePath: artifact.remotePath, contentType: artifact.contentType })) });
    logArchive(appDir, 'archive.ok', { id: archiveId, files: artifacts.length });
    return { ok: true, queued: false, record, files: artifacts.length, basePath, checks: { json: true, markdown: true, word: true, pdf: true, metadata: true, nasUpload: true } };
  } catch (error) {
    const queued = queueZSpaceUploadArtifacts({ appDir, artifacts, error, metadata });
    logArchive(appDir, 'archive.queued', { id: archiveId, files: queued.length, error });
    return { ok: false, queued: true, files: queued.length, basePath, error: safeErrorMessage(error), checks: { json: true, markdown: true, word: true, pdf: true, metadata: true, nasUpload: false } };
  }
}
