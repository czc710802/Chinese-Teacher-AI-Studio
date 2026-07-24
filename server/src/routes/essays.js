import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { db } from '../db/connection.js';
import { requireUser } from '../middleware/auth.js';
import { recognizeImages } from '../services/openai.js';
import { gradeEssay } from '../services/essay-grading/grading-service.js';
import { buildReviewHistoryComparison, listVisibleEssayReviewHistory, saveEssayReviewVersion, selectCanonicalEssayReview } from '../services/essay-grading/review-history.js';
import { canReadEssay, getSubmissionDraft, resolveEssayAssignmentTarget, resolveEssayListScope, saveSubmissionDraft } from '../services/essay-access.js';
import { materializeMiniProgramEssayImages, promoteMaterializedEssayImages } from '../services/essay-image-batch.js';
import { buildEssayResultCard } from '../integrations/feishu/cards.js';
import { getActiveStudentBinding } from '../services/feishu-assignment-bindings.js';
import { refreshStudentProfile } from '../services/profile.js';
import { recordOcrArtifact, recordOriginalArtifact, recordReviewArtifact } from '../services/storage-artifacts.js';
import { archiveEssayToZSpaceAsync } from '../services/zspace-storage.js';
import { archiveEssayToNASAsync } from '../services/archive-pipeline.js';
import { canonicalEssayIdsSql, createOrReuseEssaySubmission } from '../services/essay-submission.js';
import { buildFeishuBusinessMigrationNotice, isFeishuBusinessEnabled } from '../integrations/feishu/config.js';
import gradingNormalizer from '../../../../Chinese-Teacher-AI-Workspace/shared/essay-grading/normalize-grading-result.js';

const { normalizeGradingResult } = gradingNormalizer;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({ dest: path.resolve(__dirname, '../../uploads') });
export const essayRouter = Router();
essayRouter.use(requireUser);

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

function extractTextFromUploadedFile(file) {
  const ext = path.extname(file.originalname || file.path).toLowerCase();
  if (['.txt', '.md'].includes(ext)) return fs.readFileSync(file.path, 'utf8');
  if (ext === '.docx') {
    const xml = execFileSync('unzip', ['-p', file.path, 'word/document.xml'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    return stripXmlText(xml);
  }
  if (ext === '.pdf') {
    try {
      return execFileSync('pdftotext', ['-layout', file.path, '-'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
    } catch {
      const error = new Error('PDF 文本提取工具不可用，请导出为 Word .docx 或使用拍照 OCR 提交');
      error.statusCode = 415;
      throw error;
    }
  }
  if (ext === '.doc') {
    const error = new Error('旧版 .doc 文件请先另存为 .docx 后提交');
    error.statusCode = 415;
    throw error;
  }
  const error = new Error('暂仅支持 TXT、Markdown、Word .docx 和可提取文本的 PDF 文档提交');
  error.statusCode = 415;
  throw error;
}

async function createReviewedEssay({ assignment, studentId, title, essayText, imagePaths = [], imageOcrText = '', sourceFiles = [], attachments = [], submitRound = 1, wordCount, submissionStatus = 'submitted', clientSubmissionKey = '', storageService, zspaceClient, logger = console, deferReview = false }) {
  const submission = createOrReuseEssaySubmission(db, {
    assignment,
    studentId,
    title,
    essayText,
    attachments,
    imagePaths,
    imageOcrText,
    clientSubmissionKey,
    submitRound,
    submissionStatus,
    wordCount,
    allowResubmit: assignment.allow_resubmit,
    allowLateSubmit: assignment.allow_late_submit,
    deadline: assignment.deadline,
    logger
  });
  if (submission.duplicate) {
    return {
      essayId: submission.essayId,
      duplicate: true,
      status: submission.submissionStatus,
      gradingStatus: submission.gradingStatus,
      submissionKey: submission.clientSubmissionKey
    };
  }
  const essayId = submission.essayId;
  await recordOriginalArtifact({ storageService, database: db, essayId, files: sourceFiles, text: sourceFiles.length ? '' : essayText, logger });
  if (imageOcrText) await recordOcrArtifact({ storageService, database: db, essayId, text: imageOcrText, files: sourceFiles, logger });

  const persistReview = async (review) => {
    saveEssayReviewVersion(db, {
      essayId,
      review,
      promptText: assignment.prompt || '',
      promptMode: 'latest',
      reportVersion: review.reportVersion || review.metadata?.reportVersion || '2.0',
      model: review.metadata?.model || review.ai_meta?.model || '',
      sourceType: 'web',
      createdByUserId: '',
      createdByRole: ''
    });
    await recordReviewArtifact({ storageService, database: db, essayId, review, logger });
    archiveEssayToZSpaceAsync({
      appDir: storageService?.rawConfig?.appDir || path.resolve(__dirname, '../../..'),
      database: db,
      essayId,
      client: zspaceClient,
      logger
    });
    archiveEssayToNASAsync({
      appDir: storageService?.rawConfig?.appDir || path.resolve(__dirname, '../../..'),
      database: db,
      essayId,
      client: zspaceClient,
      logger
    });
    try {
      refreshStudentProfile(studentId, { storageService, logger });
    } catch (error) {
      logger?.warn?.('refreshStudentProfile failed after submit', error?.message || error);
    }
  };

  const buildReviewInput = () => ({
    essayId,
    studentId,
    studentName: '',
    classId: assignment.class_id,
    grade: assignment.grade || '',
    title,
    prompt: assignment.prompt,
    essayText,
    sourceType: 'web',
    scoringStandard: assignment.scoring_standard || '',
    maxScore: assignment.full_score || 60,
    model: '',
    teacherRequirements: assignment.requirements || ''
  });

  if (deferReview) {
    setImmediate(() => {
      (async () => {
        try {
          const review = await gradeEssay(buildReviewInput(), { timeoutMs: 120000 });
          await persistReview(review);
        } catch (error) {
          logger?.error?.('background essay image review failed', {
            essayId,
            message: error?.message || String(error || ''),
            stack: error?.stack || ''
          });
          db.prepare('UPDATE essays SET grading_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('failed', essayId);
        }
      })().catch((error) => {
        logger?.error?.('background essay image review crashed', {
          essayId,
          message: error?.message || String(error || ''),
          stack: error?.stack || ''
        });
        db.prepare('UPDATE essays SET grading_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('failed', essayId);
      });
    });
    return { essayId, gradingStatus: 'grading', queuedReview: true };
  }

  const review = await gradeEssay(buildReviewInput());
  await persistReview(review);
  return { essayId };
}

essayRouter.get('/', (req, res) => {
  const scope = resolveEssayListScope(db, req.user, req.query);
  if (scope.status !== 200) return res.status(scope.status).json({ message: scope.message });
  const filters = [];
  const params = [];
  if (scope.studentId) {
    filters.push('e.student_id = ?');
    params.push(scope.studentId);
  }
  if (scope.classId) {
    filters.push('a.class_id = ?');
    params.push(scope.classId);
  }
  if (scope.teacherId) {
    filters.push('c.teacher_id = ?');
    params.push(scope.teacherId);
  }
  const assignmentId = Number(req.query.assignmentId || 0);
  if (Number.isFinite(assignmentId) && assignmentId > 0) {
    filters.push('e.assignment_id = ?');
    params.push(assignmentId);
  }
  const status = String(req.query.status || '').trim().toLowerCase();
  if (status) {
    if (status === 'completed') {
      filters.push('(e.grading_status = ? OR EXISTS (SELECT 1 FROM ai_reviews r WHERE r.essay_id = e.id AND r.total_score IS NOT NULL) OR e.status = ?)');
      params.push('graded', 'report_published');
    } else if (status === 'grading') {
      filters.push('e.grading_status = ?');
      params.push('grading');
    } else if (status === 'failed') {
      filters.push('(e.grading_status = ? OR e.status = ?)');
      params.push('failed', 'failed');
    } else if (status === 'submitted') {
      filters.push('(e.status = ? OR e.status = ?)');
      params.push('submitted', 'late_submitted');
    } else {
      filters.push('(e.status = ? OR e.grading_status = ?)');
      params.push(status, status);
    }
  }
  const gradingStatus = String(req.query.gradingStatus || '').trim().toLowerCase();
  if (gradingStatus) {
    filters.push('LOWER(COALESCE(e.grading_status, \'\')) = ?');
    params.push(gradingStatus);
  }
  const keyword = String(req.query.keyword || '').trim();
  if (keyword) {
    filters.push('(e.title LIKE ? OR a.title LIKE ? OR u.name LIKE ? OR c.name LIKE ? OR s.student_no LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like, like, like);
  }
  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const rows = db.prepare(`
    ${canonicalEssayIdsSql('e')}
    SELECT
      e.*,
      a.title AS assignment_title,
      a.class_id AS class_id,
      c.name AS class_name,
      c.grade AS class_grade,
      u.name AS student_name,
      s.student_no
    FROM canonical_essays ce
    JOIN essays e ON e.id = ce.id
    JOIN assignments a ON a.id = e.assignment_id
    JOIN classes c ON c.id = a.class_id
    JOIN students s ON s.id = e.student_id
    JOIN users u ON u.id = s.user_id
    ${whereClause}
    ORDER BY e.created_at DESC, e.id DESC
  `).all(...params);
  res.json(rows.map((row) => {
    const review = selectCanonicalEssayReview(db, row.id);
    return {
      ...row,
      total_score: review?.total_score ?? null,
      level: review?.level || '',
      review_id: review?.id || null,
      normalizedGradingResult: review ? normalizeGradingResult(review) : null
    };
  }));
});

essayRouter.get('/drafts/:assignmentId', (req, res) => {
  const result = getSubmissionDraft(db, req.user, req.params.assignmentId);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.draft || {});
});

essayRouter.post('/drafts', (req, res) => {
  const result = saveSubmissionDraft(db, req.user, req.body);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.draft);
});

essayRouter.get('/:id', (req, res) => {
  if (!canReadEssay(db, req.user, req.params.id)) return res.status(403).json({ message: '没有查看该作文的权限' });
  const essay = db.prepare(`
    SELECT e.*, a.title AS assignment_title, a.prompt, a.full_score, u.name AS student_name
    FROM essays e
    JOIN assignments a ON a.id = e.assignment_id
    JOIN students s ON s.id = e.student_id
    JOIN users u ON u.id = s.user_id
    WHERE e.id = ?
  `).get(req.params.id);
  if (!essay) return res.status(404).json({ message: '作文不存在' });
  const review = selectCanonicalEssayReview(db, req.params.id);
  const comments = db.prepare('SELECT * FROM teacher_comments WHERE essay_id = ? ORDER BY created_at DESC').all(req.params.id);
  const images = db.prepare('SELECT id, file_path, ocr_text, sort_order FROM essay_images WHERE essay_id = ? ORDER BY sort_order, id').all(req.params.id);
  const interactions = db.prepare('SELECT role, message, created_at FROM ai_tutor_conversations WHERE student_id = ? AND essay_id = ? ORDER BY created_at, id').all(essay.student_id, essay.id);
  const reviewPayload = review ? { ...review, raw: typeof review.raw_json === 'string' ? JSON.parse(review.raw_json || '{}') : (review.raw_json || {}) } : null;
  const normalizedGradingResult = normalizeGradingResult(review || null);
  const latestComment = comments[0]?.comment || '';
  if (latestComment) normalizedGradingResult.teacherComment = latestComment;
  res.json({
    essay,
    review: reviewPayload,
    normalizedGradingResult,
    comments,
    interactions,
    images: images.map((image, index) => ({ id: image.id, label: `原稿图片 ${index + 1}`, url: image.file_path, ocrText: image.ocr_text || '', sortOrder: image.sort_order })),
  });
});

essayRouter.post('/', async (req, res, next) => {
  try {
    const resolved = resolveEssayAssignmentTarget(db, req.user, req.body);
    if (resolved.status !== 200) return res.status(resolved.status).json({ message: resolved.message });
    const { studentId, assignment } = resolved;
    const essayText = String(req.body.original_text || req.body.originalText || req.body.essayText || req.body.text || '').trim();
    res.json(await createReviewedEssay({
      assignment,
      studentId,
      title: req.body.title,
      essayText,
      clientSubmissionKey: req.body.clientSubmissionKey || req.body.client_submission_key || '',
      submissionStatus: 'submitted',
      storageService: req.app.locals.storageService,
      zspaceClient: req.app.locals.zspaceClient,
      logger: req.app.locals.logger || console
    }));
  } catch (error) {
    next(error);
  }
});

essayRouter.post('/images', upload.array('images', 8), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ message: '请先选择照片或图片' });

    const assignmentAccess = resolveEssayAssignmentTarget(db, req.user, req.body);
    if (assignmentAccess.status !== 200) return res.status(assignmentAccess.status).json({ message: assignmentAccess.message });

    const essayText = String(await recognizeImages(req.files || []) || '').trim();
    if (!essayText) return res.status(422).json({ message: '未能识别文字，请重新拍摄清晰图片。' });

    const imagePaths = files.map((file) => `/uploads/${path.basename(file.path)}`);
    const result = await createReviewedEssay({
      assignment: assignmentAccess.assignment,
      studentId: assignmentAccess.studentId,
      title: req.body.title || '拍照上传作文',
      essayText,
      imagePaths,
      imageOcrText: essayText,
      sourceFiles: files,
      attachments: files.map((file) => ({ name: file.originalname, mimeType: file.mimetype, size: file.size })),
      clientSubmissionKey: req.body.clientSubmissionKey || req.body.client_submission_key || '',
      submissionStatus: 'submitted',
      storageService: req.app.locals.storageService,
      zspaceClient: req.app.locals.zspaceClient,
      logger: req.app.locals.logger || console,
      deferReview: true
    });
    res.json({ ...result, recognizedTextLength: essayText.length });
  } catch (error) {
    next(error);
  }
});

essayRouter.post('/images/base64', async (req, res, next) => {
  const uploadDir = path.resolve(__dirname, '../../uploads');
  let materialized = null;
  try {
    const images = Array.isArray(req.body?.images) ? req.body.images : [];
    if (!images.length) return res.status(400).json({ message: '请先选择照片或图片' });
    const assignmentAccess = resolveEssayAssignmentTarget(db, req.user, req.body);
    if (assignmentAccess.status !== 200) return res.status(assignmentAccess.status).json({ message: assignmentAccess.message });

    materialized = await materializeMiniProgramEssayImages(images, { uploadDir });
    const essayText = String(await recognizeImages(materialized.files || []) || '').trim();
    if (!essayText) return res.status(422).json({ message: '未能识别文字，请重新拍摄清晰图片。' });

    const persistedFiles = promoteMaterializedEssayImages(materialized, { uploadDir });
    const imagePaths = persistedFiles.map((file) => `/uploads/${path.relative(uploadDir, file.path).replace(/\\/g, '/')}`);
    const result = await createReviewedEssay({
      assignment: assignmentAccess.assignment,
      studentId: assignmentAccess.studentId,
      title: req.body.title || '拍照上传作文',
      essayText,
      imagePaths,
      imageOcrText: essayText,
      sourceFiles: persistedFiles,
      attachments: persistedFiles.map((file) => ({
        name: file.originalname,
        mimeType: file.mimetype,
        size: file.size
      })),
      clientSubmissionKey: req.body.clientSubmissionKey || req.body.client_submission_key || '',
      submissionStatus: 'submitted',
      storageService: req.app.locals.storageService,
      zspaceClient: req.app.locals.zspaceClient,
      logger: req.app.locals.logger || console,
      deferReview: true
    });
    res.json({ ...result, recognizedTextLength: essayText.length });
  } catch (error) {
    next(error);
  } finally {
    try {
      materialized?.cleanup?.();
    } catch (cleanupError) {
      req.app.locals.logger?.warn?.('mini program image temp cleanup failed', cleanupError?.message || cleanupError);
    }
  }
});

essayRouter.post('/files', upload.array('files', 4), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ message: '请先选择 Word 或文本文件' });
    const chunks = files.map((file) => extractTextFromUploadedFile(file)).filter(Boolean);
    const essayText = chunks.join('\n\n').trim();
    if (!essayText) return res.status(422).json({ message: '未能从文件中读取作文正文' });
    const resolved = resolveEssayAssignmentTarget(db, req.user, req.body);
    if (resolved.status !== 200) return res.status(resolved.status).json({ message: resolved.message });
    const result = await createReviewedEssay({
      assignment: resolved.assignment,
      studentId: resolved.studentId,
      title: req.body.title || path.basename(files[0].originalname, path.extname(files[0].originalname)) || 'Word 文档作文',
      essayText,
      sourceFiles: files,
      attachments: files.map((file) => ({ name: file.originalname, mimeType: file.mimetype, size: file.size })),
      clientSubmissionKey: req.body.clientSubmissionKey || req.body.client_submission_key || '',
      submissionStatus: 'submitted',
      storageService: req.app.locals.storageService,
      zspaceClient: req.app.locals.zspaceClient,
      logger: req.app.locals.logger || console
    });
    res.json({ ...result, extractedTextLength: essayText.length });
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ message: error.message });
    next(error);
  }
});

essayRouter.post('/ocr', upload.array('images', 8), async (req, res, next) => {
  try {
    const text = await recognizeImages(req.files || []);
    await recordOcrArtifact({
      storageService: req.app.locals.storageService,
      database: db,
      text,
      files: req.files || [],
      logger: req.app.locals.logger || console
    });
    res.json({ text, images: (req.files || []).map((file) => `/uploads/${path.basename(file.path)}`) });
  } catch (error) {
    next(error);
  }
});

essayRouter.post('/:id/comments', (req, res) => {
  const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(req.user.id);
  const result = db.prepare('INSERT INTO teacher_comments (essay_id, teacher_id, comment, score_adjustment) VALUES (?, ?, ?, ?)')
    .run(req.params.id, teacher?.id || req.body.teacher_id, req.body.comment, req.body.score_adjustment || 0);
  archiveEssayToZSpaceAsync({
    appDir: req.app.locals.appDir || path.resolve(__dirname, '../../..'),
    database: db,
    essayId: req.params.id,
    client: req.app.locals.zspaceClient,
    logger: req.app.locals.logger || console
  });
  archiveEssayToNASAsync({
    appDir: req.app.locals.appDir || path.resolve(__dirname, '../../..'),
    database: db,
    essayId: req.params.id,
    client: req.app.locals.zspaceClient,
    logger: req.app.locals.logger || console
  });
  res.json(db.prepare('SELECT * FROM teacher_comments WHERE id = ?').get(result.lastInsertRowid));
});

essayRouter.post('/:id/publish-report', async (req, res, next) => {
  try {
    if (!canReadEssay(db, req.user, req.params.id)) return res.status(403).json({ message: '没有发布该作文报告的权限' });
    const essay = db.prepare(`
      SELECT e.*, a.class_id, a.title AS assignment_title, a.full_score, u.name AS student_name
      FROM essays e
      JOIN assignments a ON a.id = e.assignment_id
      JOIN students s ON s.id = e.student_id
      JOIN users u ON u.id = s.user_id
      WHERE e.id = ?
    `).get(req.params.id);
    if (!essay) return res.status(404).json({ message: '作文不存在' });
    const reviewRow = selectCanonicalEssayReview(db, essay.id);
    if (!reviewRow) return res.status(409).json({ message: 'AI 批改尚未完成，不能发布报告' });

    db.prepare('UPDATE essays SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('report_published', essay.id);
    const raw = typeof reviewRow.raw_json === 'string' ? JSON.parse(reviewRow.raw_json || '{}') : (reviewRow.raw_json || {});
    const publicOrigin = String(req.app.locals.env?.PUBLIC_APP_ORIGIN || 'https://pi.zhenwanyue.icu').replace(/\/+$/, '');
    const binding = getActiveStudentBinding(db, essay.student_id, essay.class_id);
    let sent = false;
    if (binding?.feishu_open_id && req.app.locals.feishuService?.sendCard && isFeishuBusinessEnabled(req.app.locals.env || process.env)) {
      const card = buildEssayResultCard({
        totalScore: raw.total_score ?? reviewRow.total_score,
        fullScore: essay.full_score || 60,
        level: raw.level || reviewRow.level,
        coreAdvantages: raw.strengths || raw.coreAdvantages || [],
        mainProblems: raw.problems || raw.mainProblems || [],
        nextTraining: raw.next_training || raw.nextTraining || []
      }, {
        links: {
          reportUrl: `${publicOrigin}/review/${essay.id}`,
          pdfUrl: `${publicOrigin}/api/reports/essay/${essay.id}/pdf/download`,
          profileUrl: `${publicOrigin}/student`
        }
      });
      await req.app.locals.feishuService.sendCard(binding.feishu_open_id, card);
      sent = true;
    }
    res.json({
      ok: true,
      status: 'report_published',
      feishuSent: sent,
      feishuPaused: !isFeishuBusinessEnabled(req.app.locals.env || process.env),
      message: !isFeishuBusinessEnabled(req.app.locals.env || process.env) ? buildFeishuBusinessMigrationNotice(req.app.locals.env || process.env) : '',
      essayId: essay.id
    });
  } catch (error) {
    next(error);
  }
});

essayRouter.post('/:id/review', async (req, res, next) => {
  try {
    if (!canReadEssay(db, req.user, req.params.id)) return res.status(403).json({ message: '没有批阅该作文的权限' });
    const essay = db.prepare(`
      SELECT
        e.*,
        a.title AS assignment_title,
        a.prompt AS assignment_prompt,
        a.essay_type,
        a.full_score,
        a.class_id,
        c.grade AS class_grade,
        s.id AS student_internal_id,
        u.name AS student_name
      FROM essays e
      JOIN assignments a ON a.id = e.assignment_id
      JOIN classes c ON c.id = a.class_id
      JOIN students s ON s.id = e.student_id
      JOIN users u ON u.id = s.user_id
      WHERE e.id = ?
    `).get(req.params.id);
    if (!essay) return res.status(404).json({ message: '作文不存在' });
    const essayText = essay.revised_text || essay.original_text;
    const review = await gradeEssay({
      essayId: essay.id,
      studentId: essay.student_id,
      studentName: essay.student_name,
      classId: essay.class_id,
      grade: essay.class_grade || '',
      title: essay.title || essay.assignment_title || '',
      prompt: essay.assignment_prompt || '',
      essayText,
      sourceType: 'web',
      scoringStandard: '',
      maxScore: essay.full_score || 60,
      model: '',
      teacherRequirements: ''
    });

    saveEssayReviewVersion(db, {
      essayId: essay.id,
      review,
      promptText: essay.assignment_prompt || '',
      promptMode: 'latest',
      reportVersion: review.reportVersion || review.metadata?.reportVersion || '2.0',
      model: review.metadata?.model || review.ai_meta?.model || '',
      sourceType: 'web',
      createdByUserId: String(req.user?.id || ''),
      createdByRole: String(req.user?.role || '')
    });

    await recordReviewArtifact({ storageService: req.app.locals.storageService, database: db, essayId: essay.id, review, logger: req.app.locals.logger || console });
    archiveEssayToZSpaceAsync({
      appDir: req.app.locals.appDir || path.resolve(__dirname, '../../..'),
      database: db,
      essayId: essay.id,
      client: req.app.locals.zspaceClient,
      logger: req.app.locals.logger || console
    });
    archiveEssayToNASAsync({
      appDir: req.app.locals.appDir || path.resolve(__dirname, '../../..'),
      database: db,
      essayId: essay.id,
      client: req.app.locals.zspaceClient,
      logger: req.app.locals.logger || console
    });
    try {
      refreshStudentProfile(essay.student_id, { storageService: req.app.locals.storageService, logger: req.app.locals.logger || console });
    } catch (error) {
      (req.app.locals.logger || console).warn?.('refreshStudentProfile failed after review', error?.message || error);
    }
    res.json({ message: '批阅完成', review });
  } catch (error) {
    next(error);
  }
});

essayRouter.get('/:id/history', (req, res) => {
  if (!canReadEssay(db, req.user, req.params.id)) return res.status(403).json({ message: '没有查看该作文历史的权限' });
  const history = listVisibleEssayReviewHistory(db, req.params.id);
  res.json({ items: history, total: history.length, comparison: buildReviewHistoryComparison(history) });
});
