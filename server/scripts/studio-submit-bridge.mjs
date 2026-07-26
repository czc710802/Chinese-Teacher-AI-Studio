import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: new URL('../../.env.production', import.meta.url) });

const { db } = await import('../src/db/connection.js');
const { recognizeImages, repairIncompleteGradingResult } = await import('../src/services/openai.js');
const { gradeEssay } = await import('../src/services/essay-grading/grading-service.js');
const { analyzeGradingResultCompleteness, mergeGradingResultSupplement, saveEssayReviewVersion, validateCompleteGradingResult } = await import('../src/services/essay-grading/review-history.js');
const { refreshStudentProfile } = await import('../src/services/profile.js');
const { materializeMiniProgramEssayImages, promoteMaterializedEssayImages } = await import('../src/services/essay-image-batch.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.resolve(__dirname, '../../uploads');

const payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');

function normalizeText(value = '') {
  return String(value || '').trim();
}

function safeParseJson(value, fallback = []) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function normalizeAttachmentsForKey(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      kind: normalizeText(item?.kind || ''),
      name: normalizeText(item?.name || item?.originalname || ''),
      mimeType: normalizeText(item?.mimeType || item?.mimetype || ''),
      size: Number(item?.size) || 0,
    }))
    .sort((a, b) => `${a.kind}|${a.name}|${a.size}|${a.mimeType}`.localeCompare(`${b.kind}|${b.name}|${b.size}|${b.mimeType}`, 'zh-Hans-CN'));
}

function buildSubmissionKey({ assignmentId, studentId, title, essayText, images, files, attachments, clientSubmissionKey, now }) {
  const explicit = normalizeText(clientSubmissionKey);
  if (explicit) return explicit;
  const hash = crypto.createHash('sha1').update(JSON.stringify({
    assignmentId: Number(assignmentId) || 0,
    studentId: Number(studentId) || 0,
    title: normalizeText(title),
    essayText: normalizeText(essayText).replace(/\s+/g, ' '),
    images: normalizeAttachmentsForKey(images),
    files: normalizeAttachmentsForKey(files),
    attachments: normalizeAttachmentsForKey(attachments),
  })).digest('hex');
  return `legacy-${hash}`;
}

function ensureEssaySubmissionColumns(database) {
  const columns = new Set(database.prepare('PRAGMA table_info(essays);').all().map((row) => row.name));
  const alters = [];
  if (!columns.has('client_submission_key')) alters.push("ALTER TABLE essays ADD COLUMN client_submission_key TEXT DEFAULT ''");
  if (!columns.has('submission_group_key')) alters.push("ALTER TABLE essays ADD COLUMN submission_group_key TEXT DEFAULT ''");
  if (alters.length) database.exec(alters.join(';\n'));

  const missingRows = database.prepare(`
    SELECT id, assignment_id AS assignmentId, student_id AS studentId, title, original_text AS originalText, attachments, COALESCE(submitted_at, created_at, '') AS submittedAt
    FROM essays
    WHERE COALESCE(client_submission_key, '') = '' OR COALESCE(submission_group_key, '') = ''
    ORDER BY COALESCE(submitted_at, created_at, '') ASC, id ASC;
  `).all();
  const updateRow = database.prepare(`
    UPDATE essays
    SET client_submission_key = ?,
        submission_group_key = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?;
  `);
  for (const row of missingRows) {
    const groupKey = buildSubmissionKey({
      assignmentId: row.assignmentId,
      studentId: row.studentId,
      title: row.title,
      essayText: row.originalText,
      attachments: safeParseJson(row.attachments, []),
      now: row.submittedAt,
    });
    const clientKey = `legacy-client-${Number(row.id) || 0}`;
    updateRow.run(clientKey, groupKey, row.id);
  }
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_essays_client_submission_key ON essays(client_submission_key);');
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_essays_submission_version ON essays(assignment_id, student_id, submit_round);');
  database.exec('CREATE INDEX IF NOT EXISTS idx_essays_submission_group_key ON essays(assignment_id, student_id, submission_group_key, submitted_at, id);');
}

function stripXmlText(xml) {
  return String(xml || '')
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extensionFromMimeType(mimeType = '', name = '') {
  const type = String(mimeType || '').toLowerCase();
  if (type.startsWith('image/')) return path.extname(String(name || '')).toLowerCase() || '.jpg';
  if (type === 'text/plain') return '.txt';
  if (type === 'text/markdown') return '.md';
  if (type === 'application/pdf') return '.pdf';
  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return '.docx';
  if (type === 'application/msword') return '.doc';
  const ext = path.extname(String(name || '')).toLowerCase();
  if (ext) return ext;
  return '.bin';
}

function materializeUploadedFiles(items = [], prefix = 'file') {
  if (!Array.isArray(items) || !items.length) return null;
  fs.mkdirSync(uploadDir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(uploadDir, `${prefix}-`));
  const files = items.map((item, index) => {
    const base64 = String(item?.base64 || item?.data || '').replace(/^data:[^;]+;base64,/, '');
    if (!base64) throw new Error(`第 ${index + 1} 个文件缺少 base64 内容`);
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) throw new Error(`第 ${index + 1} 个文件无法解析`);
    const safeName = String(item?.name || `${prefix}-${index + 1}`).trim().replace(/[\\/]+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '_') || `${prefix}-${index + 1}`;
    const ext = extensionFromMimeType(item?.mimeType || item?.mimetype || '', safeName);
    const filePath = path.join(tempDir, `${safeName.replace(/\.[^.]+$/, '')}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    fs.writeFileSync(filePath, buffer);
    return {
      path: filePath,
      originalname: safeName,
      mimetype: item?.mimeType || item?.mimetype || 'application/octet-stream',
      size: buffer.length,
    };
  });
  return {
    tempDir,
    files,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function extractTextFromUploadedFile(file) {
  const ext = path.extname(file.originalname || file.path).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif'].includes(ext)) {
    const error = new Error('图片请走图片批量上传流程，不要直接作为普通文件提交');
    error.statusCode = 415;
    throw error;
  }
  if (['.txt', '.md'].includes(ext)) return fs.readFileSync(file.path, 'utf8');
  if (ext === '.docx') {
    const xml = execFileSync('unzip', ['-p', file.path, 'word/document.xml'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    return stripXmlText(xml);
  }
  if (ext === '.pdf') {
    try {
      return execFileSync('pdftotext', ['-layout', file.path, '-'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
    } catch {
      const error = new Error('PDF 文本提取工具不可用，请使用 Word 文档或图片上传');
      error.statusCode = 415;
      throw error;
    }
  }
  if (ext === '.doc') {
    const error = new Error('旧版 .doc 文件请先另存为 .docx 后提交');
    error.statusCode = 415;
    throw error;
  }
  if (ext === '.bin') {
    const error = new Error('暂不支持该文件类型，请上传 Word 文档或清晰图片');
    error.statusCode = 415;
    throw error;
  }
  const error = new Error('暂仅支持 TXT、Markdown、Word .docx 和可提取文本的 PDF 文档提交');
  error.statusCode = 415;
  throw error;
}

async function resolveEssayText(payloadValue) {
  const images = Array.isArray(payloadValue.images) ? payloadValue.images : [];
  const files = Array.isArray(payloadValue.files) ? payloadValue.files : [];
  const originalText = normalizeText(payloadValue.originalText || payloadValue.original_text || payloadValue.content || payloadValue.essayText || payloadValue.text || payloadValue.revised_text || '');
  const uploadArtifacts = [];
  let imageText = '';
  let fileText = '';
  let materializedImages = null;
  let materializedFiles = null;

  try {
    if (images.length) {
      materializedImages = await materializeMiniProgramEssayImages(images, { uploadDir });
      imageText = String(await recognizeImages(materializedImages.files || []) || '').trim();
      const promoted = promoteMaterializedEssayImages(materializedImages, { uploadDir });
      uploadArtifacts.push(...promoted.map((file, index) => ({
        kind: 'image',
        path: `/uploads/${path.relative(uploadDir, file.path).replace(/\\/g, '/')}`,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        ocrText: imageText,
        sortOrder: index,
      })));
    }

    if (files.length) {
      materializedFiles = materializeUploadedFiles(files, 'essay-file');
      const imageFiles = materializedFiles.files.filter((file) => String(file.mimetype || '').toLowerCase().startsWith('image/') || ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif'].includes(path.extname(file.originalname || file.path).toLowerCase()));
      const documentFiles = materializedFiles.files.filter((file) => !imageFiles.includes(file));

      if (imageFiles.length) {
        const recognized = await recognizeImages(imageFiles);
        fileText = [fileText, String(recognized || '').trim()].filter(Boolean).join('\n\n').trim();
        uploadArtifacts.push(...imageFiles.map((file, index) => ({
          kind: 'image',
          path: file.path,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
          ocrText: String(recognized || '').trim(),
          sortOrder: index,
        })));
      }

      if (documentFiles.length) {
        const docText = documentFiles.map((file) => extractTextFromUploadedFile(file)).join('\n\n').trim();
        fileText = [fileText, docText].filter(Boolean).join('\n\n').trim();
        uploadArtifacts.push(...documentFiles.map((file) => ({
          kind: 'file',
          path: file.path,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
        })));
      }
    }

    const essayText = [imageText, fileText, originalText].find((value) => String(value || '').trim()) || '';
    if (!essayText) {
      throw new Error('请先上传图片、Word 文档或输入作文正文');
    }
    return {
      essayText,
      imageText,
      fileText,
      uploadArtifacts,
      cleanup() {
        try { materializedImages?.cleanup?.(); } catch {}
        try { materializedFiles?.cleanup?.(); } catch {}
      },
    };
  } catch (error) {
    try { materializedImages?.cleanup?.(); } catch {}
    try { materializedFiles?.cleanup?.(); } catch {}
    throw error;
  }
}

const assignmentId = Number(payload.assignmentId || payload.assignment_id || payload.taskId || payload.task_id || 0);
const studentId = Number(payload.studentId || payload.student_id || 0);
if (!assignmentId || !studentId) throw new Error('无效的作文或学生');

ensureEssaySubmissionColumns(db);

const isTeacherRegrade = false;

const assignment = db.prepare(`
  SELECT a.id, a.class_id AS classId, a.title, a.prompt, a.requirements, a.writing_hint AS writingHint,
    a.reference_materials_json AS referenceMaterialsJson, a.essay_type AS essayType, a.full_score AS fullScore,
    COALESCE(a.grade,'') AS grade, COALESCE(a.min_words,0) AS minWords, COALESCE(a.max_words,0) AS maxWords,
    COALESCE(a.status,'published') AS status, COALESCE(a.allow_resubmit,0) AS allowResubmit,
    COALESCE(a.allow_late_submit,0) AS allowLateSubmit, COALESCE(a.allow_student_view_result,1) AS allowStudentViewResult,
    COALESCE(a.allow_image_upload,1) AS allowImageUpload, COALESCE(a.allow_word_upload,1) AS allowWordUpload,
    COALESCE(a.ai_model,'deepseek') AS aiModel, COALESCE(a.start_time,'') AS startTime, COALESCE(a.deadline,'') AS deadline,
    c.name AS className, COALESCE(c.grade,'') AS classGrade
  FROM assignments a
  JOIN classes c ON c.id = a.class_id
  WHERE a.id = ? LIMIT 1
`).get(assignmentId);
if (!assignment) throw new Error('作文任务不存在');
if (String(assignment.status || 'published') !== 'published') throw new Error('作文任务尚未发布');

const student = db.prepare(`
  SELECT s.id AS studentId, u.name AS studentName, COALESCE(s.student_no,'') AS studentNo, COALESCE(s.grade,'') AS grade
  FROM students s
  JOIN users u ON u.id = s.user_id
  WHERE s.id = ?
`).get(studentId);
if (!student) throw new Error('学生档案不存在');

const member = db.prepare('SELECT 1 AS ok FROM class_students WHERE class_id = ? AND student_id = ? LIMIT 1').get(assignment.classId, studentId);
if (!member) throw new Error('没有提交该作文任务的权限');

const resolved = await resolveEssayText(payload);
const essayText = resolved.essayText;
const attachmentJson = JSON.stringify(Array.isArray(payload.attachments) ? payload.attachments : []);
const submissionKey = buildSubmissionKey({
  assignmentId,
  studentId,
  title: payload.title || assignment.title || '作文提交',
  essayText,
  images: Array.isArray(payload.images) ? payload.images : [],
  files: Array.isArray(payload.files) ? payload.files : [],
  attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
  clientSubmissionKey: payload.clientSubmissionKey || payload.client_submission_key || '',
  now: payload.now || new Date().toISOString(),
});
const now = payload.now ? new Date(payload.now) : new Date();
const deadline = assignment.deadline ? new Date(assignment.deadline) : null;
const isPastDeadline = deadline && !Number.isNaN(deadline.getTime()) && now.getTime() > deadline.getTime();
if (isPastDeadline && !Number(assignment.allowLateSubmit || 0)) throw new Error('作业已截止，不能提交');

const resolvedWordCount = essayText.replace(/\s/g, '').replace(/[\u3400-\u9fff]/g, ' ').trim()
  ? essayText.length
  : 0;
let submitRound = 0;
let essayId = 0;

db.exec('BEGIN IMMEDIATE');
try {
  const existing = db.prepare(`
    SELECT id, grading_status AS gradingStatus, status, submit_round AS submitRound
    FROM essays
    WHERE assignment_id = ? AND student_id = ? AND client_submission_key = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(assignment.id, studentId, submissionKey);
  if (existing?.id) {
    const reviewRow = db.prepare('SELECT * FROM ai_reviews WHERE essay_id = ? ORDER BY version_number DESC, id DESC LIMIT 1').get(existing.id);
    db.exec('ROLLBACK');
    resolved.cleanup();
    process.stdout.write(JSON.stringify({
      essayId: existing.id,
      essayText,
      status: String(existing.gradingStatus || existing.status || 'submitted'),
      gradingStatus: existing.gradingStatus || 'submitted',
      submitRound: Number(existing.submitRound || 1),
      submissionVersion: Number(existing.submitRound || 1),
      normalizedGradingResult: reviewRow ? safeParseJson(reviewRow.raw_json, {}) : {},
      duplicate: true,
    }));
    process.exit(0);
  }

  const existingRound = db.prepare(`
    SELECT MAX(submit_round) AS maxRound, COUNT(*) AS count
    FROM essays
    WHERE assignment_id = ? AND student_id = ?
  `).get(assignment.id, studentId);
  submitRound = Number(existingRound.maxRound || 0) + 1;

  const nextEssayIdRow = db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM essays').get();
  essayId = Number(nextEssayIdRow?.nextId || 1);

  db.prepare(`
    INSERT INTO essays (
      id, assignment_id, student_id, title, original_text, revised_text, attachments, word_count, status, grading_status, submitted_at, submit_round, client_submission_key, submission_group_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'grading', CURRENT_TIMESTAMP, ?, ?, ?)
  `).run(
    essayId,
    assignment.id,
    studentId,
    String(payload.title || assignment.title || '作文提交'),
    essayText,
    '',
    attachmentJson,
    resolvedWordCount,
    isPastDeadline ? 'late_submitted' : 'submitted',
    submitRound,
    submissionKey,
    submissionKey,
  );
  const insertImage = db.prepare('INSERT INTO essay_images (essay_id, file_path, ocr_text, sort_order) VALUES (?, ?, ?, ?)');
  for (const [index, item] of (resolved.uploadArtifacts || []).filter((file) => file.kind === 'image').entries()) {
    insertImage.run(essayId, item.path, item.ocrText || '', item.sortOrder ?? index);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  resolved.cleanup();
  throw error;
}

try {
  let review = await gradeEssay({
    essayId,
    studentId,
    studentName: student.studentName,
    classId: assignment.classId,
    grade: assignment.grade || student.grade || '',
    title: String(payload.title || assignment.title || '作文提交'),
    prompt: assignment.prompt || '',
    essayText,
    sourceType: 'web',
    maxScore: assignment.fullScore || 60,
    teacherRequirements: assignment.requirements || '',
  });
  let analysis = analyzeGradingResultCompleteness(review);
  if (!analysis.isComplete) {
    try {
      const repaired = await repairIncompleteGradingResult({
        assignment: { title: assignment.title || '', prompt: assignment.prompt || '', requirements: assignment.requirements || '', full_score: assignment.fullScore || 60 },
        essayText,
        review,
        missingFields: [...new Set([...analysis.missingCoreFields, ...analysis.missingRepairableFields])],
        timeoutMs: 60000
      });
      review = mergeGradingResultSupplement(review, repaired);
      analysis = analyzeGradingResultCompleteness(review);
    } catch (repairError) {
      console.warn('grading repair attempt failed', {
        essayId,
        message: repairError?.message || String(repairError || '')
      });
    }
  }
  if (analysis.missingCoreFields.length) {
    db.prepare('UPDATE essays SET grading_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run('repairing', essayId);
    const error = new Error(`完整批改结果不完整：缺少${analysis.missingCoreFields.join('、')}`);
    error.code = 'INCOMPLETE_GRADING_RESULT';
    error.statusCode = 422;
    error.missingCoreFields = analysis.missingCoreFields;
    error.missingRepairableFields = analysis.missingRepairableFields;
    throw error;
  }
  validateCompleteGradingResult(review);
  db.exec('BEGIN IMMEDIATE');
  try {
    saveEssayReviewVersion(db, {
      essayId,
      review,
      promptText: assignment.prompt || '',
      promptMode: 'student-submit',
      reportVersion: review.reportVersion || '2.0',
      model: review.metadata?.model || '',
      sourceType: 'web',
      rerunReason: 'student-submit',
      createdByUserId: String(studentId || ''),
      createdByRole: 'student',
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  try {
    refreshStudentProfile(studentId, { storageService: null, logger: console });
  } catch (error) {
    console.warn('refreshStudentProfile after submit failed', error?.message || error);
  }
  resolved.cleanup();
  process.stdout.write(JSON.stringify({
    essayId,
    essayText,
    status: 'graded',
    historyType: analysis.needsRepair ? 'repairing' : 'complete',
    gradingStatus: analysis.needsRepair ? 'repairing' : 'graded',
    submitRound,
    submissionVersion: submitRound,
    totalScore: review.totalScore,
    level: review.level,
    normalizedGradingResult: review,
  }));
} catch (error) {
  db.prepare('UPDATE essays SET grading_status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run('failed', essayId);
  resolved.cleanup();
  throw error;
}
