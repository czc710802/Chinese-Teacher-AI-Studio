import crypto from 'node:crypto';

import { parseJson, safeJson } from '../../utils/json.js';

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function normalizeTeacherReview(review = {}) {
  return {
    status: String(review.status || 'draft'),
    finalScore: review.finalScore ?? review.final_score ?? null,
    comment: String(review.comment || review.overallComment || review.teacherComment || ''),
    strengths: toArray(review.strengths || review.mainStrengths || []),
    weaknesses: toArray(review.weaknesses || review.mainProblems || []),
    suggestions: toArray(review.suggestions || review.priorityImprovements || []),
    updatedAt: review.updatedAt || new Date().toISOString(),
    updatedByUserId: String(review.updatedByUserId || review.teacherId || ''),
    updatedByRole: String(review.updatedByRole || 'teacher'),
    draftSavedAt: review.draftSavedAt || null,
    submittedAt: review.submittedAt || null
  };
}

function asString(value, fallback = '') {
  return String(value ?? fallback);
}

function promptVersionFrom(promptText = '', explicit = '') {
  const trimmed = String(explicit || '').trim();
  if (trimmed) return trimmed;
  const hash = crypto.createHash('sha1').update(String(promptText || '')).digest('hex').slice(0, 10);
  return `p-${hash}`;
}

function normalizeReviewRow(row = {}) {
  return {
    ...row,
    dimension_scores: parseJson(row.dimension_scores, []),
    strengths: parseJson(row.strengths, []),
    problems: parseJson(row.problems, []),
    paragraph_comments: parseJson(row.paragraph_comments, []),
    editable_sentences: parseJson(row.editable_sentences, []),
    suggestions: parseJson(row.suggestions, []),
    good_sentences: parseJson(row.good_sentences, []),
    next_training: parseJson(row.next_training, []),
    raw_json: parseJson(row.raw_json, {}),
    version_number: Number(row.version_number || 1),
    report_version: asString(row.report_version || '2.0'),
    prompt_version: asString(row.prompt_version || ''),
    prompt_text: asString(row.prompt_text || ''),
    prompt_mode: asString(row.prompt_mode || ''),
    model: asString(row.model || ''),
    source_type: asString(row.source_type || ''),
    grading_job_id: asString(row.grading_job_id || ''),
    rerun_reason: asString(row.rerun_reason || ''),
    created_by_user_id: asString(row.created_by_user_id || ''),
    created_by_role: asString(row.created_by_role || '')
  };
}

export function getLatestEssayReview(database, essayId) {
  const row = database.prepare(`
    SELECT *
    FROM ai_reviews
    WHERE essay_id = ?
    ORDER BY COALESCE(version_number, 1) DESC, id DESC
    LIMIT 1
  `).get(essayId);
  return row ? normalizeReviewRow(row) : null;
}

export function listEssayReviewHistory(database, essayId) {
  return database.prepare(`
    SELECT *
    FROM ai_reviews
    WHERE essay_id = ?
    ORDER BY COALESCE(version_number, 1) ASC, id ASC
  `).all(essayId).map(normalizeReviewRow);
}

export function saveEssayReviewVersion(database, {
  essayId,
  review = {},
  promptText = '',
  promptMode = '',
  promptVersion = '',
  reportVersion = '',
  model = '',
  sourceType = '',
  rerunReason = '',
  createdByUserId = '',
  createdByRole = '',
  gradingJobId = ''
} = {}) {
  const latest = getLatestEssayReview(database, essayId);
  const versionNumber = latest ? Number(latest.version_number || 1) + 1 : 1;
  const resolvedPromptText = String(promptText || latest?.prompt_text || '');
  const resolvedPromptVersion = promptVersionFrom(resolvedPromptText, promptVersion || review?.metadata?.promptVersion || review?.promptVersion || '');
  const resolvedReportVersion = String(reportVersion || review?.reportVersion || review?.metadata?.reportVersion || '2.0');
  const resolvedModel = String(model || review?.metadata?.model || review?.ai_meta?.model || '');
  const resolvedSourceType = String(sourceType || review?.metadata?.sourceType || 'web');
  const resolvedJobId = String(gradingJobId || crypto.randomUUID());
  const rawJson = JSON.stringify(review || {});

  const insert = database.prepare(`
    INSERT INTO ai_reviews (
      essay_id,
      version_number,
      report_version,
      prompt_version,
      prompt_text,
      prompt_mode,
      model,
      source_type,
      grading_job_id,
      rerun_reason,
      created_by_user_id,
      created_by_role,
      total_score,
      level,
      dimension_scores,
      strengths,
      problems,
      paragraph_comments,
      editable_sentences,
      suggestions,
      upgraded_paragraph,
      good_sentences,
      next_training,
      raw_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = insert.run(
    essayId,
    versionNumber,
    resolvedReportVersion,
    resolvedPromptVersion,
    resolvedPromptText,
    String(promptMode || ''),
    resolvedModel,
    resolvedSourceType,
    resolvedJobId,
    String(rerunReason || ''),
    String(createdByUserId || ''),
    String(createdByRole || ''),
    Number(review.total_score ?? review.totalScore ?? 0),
    String(review.level || review.grade || ''),
    safeJson(toArray(review.dimension_scores ?? review.dimensionScores ?? [])),
    safeJson(toArray(review.strengths ?? review.coreAdvantages ?? [])),
    safeJson(toArray(review.problems ?? review.mainProblems ?? review.weaknesses ?? [])),
    safeJson(toArray(review.paragraph_comments ?? review.paragraphComments ?? [])),
    safeJson(toArray(review.editable_sentences ?? review.editableSentences ?? [])),
    safeJson(toArray(review.suggestions ?? [])),
    String(review.upgraded_paragraph || review.upgradedParagraph || review.polished_full_text || review.polishedFullText || ''),
    safeJson(toArray(review.good_sentences ?? review.goodSentences ?? [])),
    safeJson(toArray(review.next_training ?? review.nextTraining ?? [])),
    rawJson
  );
  database.prepare('UPDATE essays SET report_id = ?, grading_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(result.lastInsertRowid, 'graded', essayId);
  const updated = database.prepare('SELECT * FROM ai_reviews WHERE id = ?').get(result.lastInsertRowid);
  return updated ? normalizeReviewRow(updated) : getLatestEssayReview(database, essayId);
}

export function saveTeacherReview(database, {
  essayId,
  reviewId = '',
  versionNumber = null,
  teacherReview = {},
  teacherId = '',
  teacherRole = 'teacher'
} = {}) {
  let target = null;
  if (reviewId) {
    target = database.prepare('SELECT * FROM ai_reviews WHERE id = ? AND essay_id = ?').get(reviewId, essayId);
  } else if (versionNumber !== null && versionNumber !== undefined && versionNumber !== '') {
    target = database.prepare('SELECT * FROM ai_reviews WHERE essay_id = ? AND version_number = ? ORDER BY id DESC LIMIT 1').get(essayId, Number(versionNumber));
  }
  if (!target) target = getLatestEssayReview(database, essayId);
  if (!target) {
    const error = new Error('未找到对应批改报告');
    error.statusCode = 404;
    throw error;
  }

  const review = normalizeTeacherReview({
    ...teacherReview,
    updatedByUserId: teacherId,
    updatedByRole: teacherRole
  });
  const rawJson = { ...(target.raw_json || {}) };
  rawJson.teacherReview = review;

  database.prepare('UPDATE ai_reviews SET raw_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(JSON.stringify(rawJson), target.id);

  if (String(review.status || 'draft') === 'submitted' && teacherId) {
    const existing = database.prepare('SELECT id FROM teacher_comments WHERE essay_id = ? AND teacher_id = ? ORDER BY id DESC LIMIT 1')
      .get(essayId, teacherId || null);
    const comment = review.comment || '';
    const scoreAdjustment = review.finalScore == null ? 0 : Number(review.finalScore) - Number(target.total_score || 0);
    if (existing) {
      database.prepare('UPDATE teacher_comments SET comment = ?, score_adjustment = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(comment, scoreAdjustment, existing.id);
    } else {
      database.prepare('INSERT INTO teacher_comments (essay_id, teacher_id, comment, score_adjustment) VALUES (?, ?, ?, ?)')
      .run(essayId, teacherId || null, comment, scoreAdjustment);
    }
  }

  return getLatestEssayReview(database, essayId);
}

export function buildReviewHistoryComparison(history = []) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const latest = history[history.length - 1];
  const previous = history[history.length - 2];
  return {
    scoreDelta: Number(latest.total_score || 0) - Number(previous.total_score || 0),
    levelFrom: previous.level || '',
    levelTo: latest.level || '',
    promptFrom: previous.prompt_text || '',
    promptTo: latest.prompt_text || '',
    modelFrom: previous.model || '',
    modelTo: latest.model || '',
    suggestionsChanged: JSON.stringify(previous.suggestions || []) !== JSON.stringify(latest.suggestions || []),
    rawChanged: JSON.stringify(previous.raw_json || {}) !== JSON.stringify(latest.raw_json || {})
  };
}
