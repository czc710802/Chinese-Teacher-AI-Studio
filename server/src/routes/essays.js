import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/connection.js';
import { requireUser } from '../middleware/auth.js';
import { reviewEssay, recognizeImages } from '../services/openai.js';
import { canReadEssay, resolveEssayAssignmentTarget, resolveEssayListScope, resolveEssaySubmitTarget } from '../services/essay-access.js';
import { refreshStudentProfile } from '../services/profile.js';
import { recordOcrArtifact, recordOriginalArtifact, recordReviewArtifact } from '../services/storage-artifacts.js';
import { archiveEssayToZSpaceAsync } from '../services/zspace-storage.js';
import { archiveEssayToNASAsync } from '../services/archive-pipeline.js';
import { safeJson } from '../utils/json.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({ dest: path.resolve(__dirname, '../../uploads') });
export const essayRouter = Router();
essayRouter.use(requireUser);

async function createReviewedEssay({ assignment, studentId, title, essayText, imagePaths = [], imageOcrText = '', sourceFiles = [], storageService, zspaceClient, logger = console }) {
  const result = db.prepare(`
    INSERT INTO essays (assignment_id, student_id, title, original_text, revised_text, submit_round)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(assignment.id, studentId, title, essayText, '', 1);
  const essayId = result.lastInsertRowid;

  const insertImage = db.prepare('INSERT INTO essay_images (essay_id, file_path, ocr_text, sort_order) VALUES (?, ?, ?, ?)');
  imagePaths.forEach((filePath, index) => insertImage.run(essayId, filePath, imageOcrText, index));
  await recordOriginalArtifact({ storageService, database: db, essayId, files: sourceFiles, text: sourceFiles.length ? '' : essayText, logger });
  if (imageOcrText) await recordOcrArtifact({ storageService, database: db, essayId, text: imageOcrText, files: sourceFiles, logger });

  const review = await reviewEssay({ assignment, essayText });
  db.prepare(`
    INSERT INTO ai_reviews
    (essay_id, total_score, level, dimension_scores, strengths, problems, paragraph_comments, editable_sentences, suggestions, upgraded_paragraph, good_sentences, next_training, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    essayId,
    review.total_score,
    review.level,
    safeJson(review.dimension_scores),
    safeJson(review.strengths),
    safeJson(review.problems),
    safeJson(review.paragraph_comments),
    safeJson(review.editable_sentences),
    safeJson(review.suggestions),
    review.upgraded_paragraph || '',
    safeJson(review.good_sentences),
    safeJson(review.next_training),
    JSON.stringify(review)
  );
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
  refreshStudentProfile(studentId, { storageService, logger });
  return { essayId };
}

essayRouter.get('/', (req, res) => {
  const scope = resolveEssayListScope(db, req.user, req.query);
  if (scope.status !== 200) return res.status(scope.status).json({ message: scope.message });
  const rows = db.prepare(`
    SELECT e.*, a.title AS assignment_title, u.name AS student_name, ar.total_score, ar.level
    FROM essays e
    JOIN assignments a ON a.id = e.assignment_id
    JOIN students s ON s.id = e.student_id
    JOIN users u ON u.id = s.user_id
    LEFT JOIN ai_reviews ar ON ar.essay_id = e.id
    WHERE (? IS NULL OR e.student_id = ?) AND (? IS NULL OR a.class_id = ?)
    ORDER BY e.created_at DESC
  `).all(scope.studentId || null, scope.studentId || null, scope.classId || null, scope.classId || null);
  res.json(rows);
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
  const review = db.prepare('SELECT * FROM ai_reviews WHERE essay_id = ? ORDER BY id DESC LIMIT 1').get(req.params.id);
  const comments = db.prepare('SELECT * FROM teacher_comments WHERE essay_id = ? ORDER BY created_at DESC').all(req.params.id);
  const images = db.prepare('SELECT id, file_path, ocr_text, sort_order FROM essay_images WHERE essay_id = ? ORDER BY sort_order, id').all(req.params.id);
  res.json({ essay, review: review ? { ...review, raw: JSON.parse(review.raw_json) } : null, comments, images });
});

essayRouter.post('/', async (req, res, next) => {
  try {
    const resolved = resolveEssaySubmitTarget(db, req.user, req.body);
    if (resolved.status !== 200) return res.status(resolved.status).json({ message: resolved.message });
    const { studentId, assignment, essayText } = resolved;
    res.json(await createReviewedEssay({
      assignment,
      studentId,
      title: req.body.title,
      essayText,
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

    const resolved = resolveEssayAssignmentTarget(db, req.user, req.body);
    if (resolved.status !== 200) return res.status(resolved.status).json({ message: resolved.message });

    const essayText = String(await recognizeImages(req.files || []) || '').trim();
    if (!essayText) return res.status(422).json({ message: 'AI 未能识别出作文文字，请重新拍照或上传更清晰的图片' });

    const imagePaths = files.map((file) => `/uploads/${path.basename(file.path)}`);
    const result = await createReviewedEssay({
      assignment: resolved.assignment,
      studentId: resolved.studentId,
      title: req.body.title || '拍照上传作文',
      essayText,
      imagePaths,
      imageOcrText: essayText,
      sourceFiles: files,
      storageService: req.app.locals.storageService,
      zspaceClient: req.app.locals.zspaceClient,
      logger: req.app.locals.logger || console
    });
    res.json({ ...result, recognizedTextLength: essayText.length });
  } catch (error) {
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

essayRouter.post('/:id/review', async (req, res, next) => {
  try {
    if (!canReadEssay(db, req.user, req.params.id)) return res.status(403).json({ message: '没有批阅该作文的权限' });
    const essay = db.prepare(`
      SELECT e.*, a.title AS assignment_title, a.prompt AS assignment_prompt, a.essay_type, a.full_score
      FROM essays e
      JOIN assignments a ON a.id = e.assignment_id
      WHERE e.id = ?
    `).get(req.params.id);
    if (!essay) return res.status(404).json({ message: '作文不存在' });

    const assignment = {
      title: essay.assignment_title,
      prompt: essay.assignment_prompt,
      essay_type: essay.essay_type,
      full_score: essay.full_score
    };
    const essayText = essay.revised_text || essay.original_text;

    const review = await reviewEssay({ assignment, essayText });

    const existing = db.prepare('SELECT id FROM ai_reviews WHERE essay_id = ?').get(essay.id);
    if (existing) {
      db.prepare(`
        UPDATE ai_reviews SET
          total_score = ?, level = ?, dimension_scores = ?, strengths = ?, problems = ?,
          paragraph_comments = ?, editable_sentences = ?, suggestions = ?, upgraded_paragraph = ?,
          good_sentences = ?, next_training = ?, raw_json = ?
        WHERE essay_id = ?
      `).run(
        review.total_score, review.level,
        safeJson(review.dimension_scores), safeJson(review.strengths), safeJson(review.problems),
        safeJson(review.paragraph_comments), safeJson(review.editable_sentences), safeJson(review.suggestions),
        review.upgraded_paragraph || '', safeJson(review.good_sentences), safeJson(review.next_training),
        JSON.stringify(review), essay.id
      );
    } else {
      db.prepare(`
        INSERT INTO ai_reviews
        (essay_id, total_score, level, dimension_scores, strengths, problems, paragraph_comments,
         editable_sentences, suggestions, upgraded_paragraph, good_sentences, next_training, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        essay.id, review.total_score, review.level,
        safeJson(review.dimension_scores), safeJson(review.strengths), safeJson(review.problems),
        safeJson(review.paragraph_comments), safeJson(review.editable_sentences), safeJson(review.suggestions),
        review.upgraded_paragraph || '', safeJson(review.good_sentences), safeJson(review.next_training),
        JSON.stringify(review)
      );
    }

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
    refreshStudentProfile(essay.student_id, { storageService: req.app.locals.storageService, logger: req.app.locals.logger || console });
    res.json({ message: '批阅完成', review });
  } catch (error) {
    next(error);
  }
});
