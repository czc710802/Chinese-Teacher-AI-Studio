import crypto from 'node:crypto';
import { safeJson } from '../utils/json.js';

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
      size: Number(item?.size) || 0
    }))
    .sort((a, b) => `${a.kind}|${a.name}|${a.size}|${a.mimeType}`.localeCompare(`${b.kind}|${b.name}|${b.size}|${b.mimeType}`, 'zh-Hans-CN'));
}

export function buildEssaySubmissionKey({ assignmentId, studentId, title, essayText, images, files, attachments, clientSubmissionKey }) {
  const explicit = normalizeText(clientSubmissionKey);
  if (explicit) return explicit;
  const hash = crypto.createHash('sha1').update(JSON.stringify({
    assignmentId: Number(assignmentId) || 0,
    studentId: Number(studentId) || 0,
    title: normalizeText(title),
    essayText: normalizeText(essayText).replace(/\s+/g, ' '),
    images: normalizeAttachmentsForKey(images),
    files: normalizeAttachmentsForKey(files),
    attachments: normalizeAttachmentsForKey(attachments)
  })).digest('hex');
  return `legacy-${hash}`;
}

export function canonicalEssayGroupSql(alias = 'e') {
  const trimmedAlias = String(alias || 'e').trim() || 'e';
  return `COALESCE(NULLIF(${trimmedAlias}.submission_group_key, ''), NULLIF(${trimmedAlias}.client_submission_key, ''), CAST(${trimmedAlias}.id AS TEXT))`;
}

export function canonicalEssayIdsSql(alias = 'e') {
  const trimmedAlias = String(alias || 'e').trim() || 'e';
  return `
    WITH canonical_essays AS (
      SELECT MAX(${trimmedAlias}.id) AS id
      FROM essays ${trimmedAlias}
      GROUP BY ${trimmedAlias}.assignment_id, ${trimmedAlias}.student_id, ${canonicalEssayGroupSql(trimmedAlias)}
    )
  `;
}

export function ensureEssaySubmissionColumns(database) {
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
    const groupKey = buildEssaySubmissionKey({
      assignmentId: row.assignmentId,
      studentId: row.studentId,
      title: row.title,
      essayText: row.originalText,
      attachments: safeParseJson(row.attachments, [])
    });
    const clientKey = `legacy-client-${Number(row.id) || 0}`;
    updateRow.run(clientKey, groupKey, row.id);
  }
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_essays_client_submission_key ON essays(client_submission_key);');
  database.exec('CREATE INDEX IF NOT EXISTS idx_essays_submission_group_key ON essays(assignment_id, student_id, submission_group_key, submitted_at, id);');
}

function countEssayWords(text = '') {
  const value = normalizeText(text);
  if (!value) return 0;
  const cjk = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (value.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length;
  return cjk + words;
}

export function createOrReuseEssaySubmission(database, {
  assignment,
  studentId,
  title,
  essayText,
  attachments = [],
  imagePaths = [],
  imageOcrText = '',
  clientSubmissionKey = '',
  submitRound = 1,
  submissionStatus = 'submitted',
  wordCount,
  allowResubmit = null,
  allowLateSubmit = null,
  deadline = '',
  now = new Date(),
  logger = console
}) {
  if (!assignment || !assignment.id) throw new Error('作文任务不存在');
  if (!Number.isFinite(Number(studentId)) || Number(studentId) <= 0) throw new Error('学生档案不存在');

  ensureEssaySubmissionColumns(database);

  const normalizedEssayText = normalizeText(essayText);
  if (!normalizedEssayText) throw new Error('请先粘贴或输入作文正文');

  const submissionKey = buildEssaySubmissionKey({
    assignmentId: assignment.id,
    studentId,
    title,
    essayText: normalizedEssayText,
    attachments,
    clientSubmissionKey
  });
  const resolvedWordCount = Number.isFinite(Number(wordCount)) ? Number(wordCount) : countEssayWords(normalizedEssayText);
  const resolvedStatus = String(submissionStatus || 'submitted').trim() || 'submitted';
  const allowResubmitFlag = allowResubmit == null ? Number(assignment.allow_resubmit || 0) : Number(allowResubmit ? 1 : 0);
  const allowLateSubmitFlag = allowLateSubmit == null ? Number(assignment.allow_late_submit || 0) : Number(allowLateSubmit ? 1 : 0);
  const currentNow = now instanceof Date ? now : new Date(now);
  const deadlineDate = deadline ? new Date(deadline) : null;
  const isPastDeadline = deadlineDate && !Number.isNaN(deadlineDate.getTime()) && currentNow.getTime() > deadlineDate.getTime();
  if (isPastDeadline && !allowLateSubmitFlag) {
    throw new Error('作业已截止，不能提交');
  }

  database.exec('BEGIN IMMEDIATE');
  try {
    const existing = database.prepare(`
      SELECT id, grading_status AS gradingStatus, status, submit_round AS submitRound, client_submission_key AS clientSubmissionKey, submission_group_key AS submissionGroupKey
      FROM essays
      WHERE assignment_id = ? AND student_id = ? AND client_submission_key = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(assignment.id, studentId, submissionKey);
    if (existing?.id) {
      const reviewRow = database.prepare('SELECT * FROM ai_reviews WHERE essay_id = ? ORDER BY version_number DESC, id DESC LIMIT 1').get(existing.id);
      database.exec('ROLLBACK');
      return {
        duplicate: true,
        essayId: Number(existing.id),
        submitRound: Number(existing.submitRound || submitRound || 1),
        submissionStatus: String(existing.gradingStatus || existing.status || resolvedStatus || 'submitted'),
        gradingStatus: String(existing.gradingStatus || existing.status || resolvedStatus || 'submitted'),
        clientSubmissionKey: existing.clientSubmissionKey || submissionKey,
        submissionGroupKey: existing.submissionGroupKey || submissionKey,
        normalizedGradingResult: reviewRow ? safeParseJson(reviewRow.raw_json, {}) : {}
      };
    }

    const existingRound = database.prepare(`
      SELECT MAX(submit_round) AS maxRound, COUNT(*) AS count
      FROM essays
      WHERE assignment_id = ? AND student_id = ?
    `).get(assignment.id, studentId);
    if (Number(existingRound.count || 0) > 0 && !allowResubmitFlag) {
      database.exec('ROLLBACK');
      throw new Error('该作业已提交，请勿重复提交');
    }

    const nextEssayIdRow = database.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM essays').get();
    const essayId = Number(nextEssayIdRow?.nextId || 1);
    const nextSubmitRound = Number(existingRound.maxRound || 0) + 1;
    database.prepare(`
      INSERT INTO essays (
        id, assignment_id, student_id, title, original_text, revised_text, attachments, word_count, status, grading_status, submitted_at, submit_round, client_submission_key, submission_group_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'grading', CURRENT_TIMESTAMP, ?, ?, ?)
    `).run(
      essayId,
      assignment.id,
      studentId,
      normalizeText(title) || normalizeText(assignment.title) || '作文提交',
      normalizedEssayText,
      '',
      safeJson(attachments),
      resolvedWordCount,
      isPastDeadline ? 'late_submitted' : resolvedStatus,
      nextSubmitRound,
      submissionKey,
      submissionKey
    );

    const insertImage = database.prepare('INSERT INTO essay_images (essay_id, file_path, ocr_text, sort_order) VALUES (?, ?, ?, ?)');
    (Array.isArray(imagePaths) ? imagePaths : []).forEach((filePath, index) => insertImage.run(
      essayId,
      filePath,
      normalizeText(imageOcrText),
      index
    ));

    database.exec('COMMIT');
    return {
      duplicate: false,
      essayId,
      submitRound: nextSubmitRound,
      submissionStatus: isPastDeadline ? 'late_submitted' : resolvedStatus,
      gradingStatus: 'grading',
      clientSubmissionKey: submissionKey,
      submissionGroupKey: submissionKey
    };
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch (rollbackError) {
      logger?.warn?.('rollback failed for essay submission', rollbackError?.message || rollbackError);
    }
    throw error;
  }
}
