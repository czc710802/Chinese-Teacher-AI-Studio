import crypto from 'node:crypto';

import { parseJson, safeJson } from '../../utils/json.js';
import uiText from '../../../../../Chinese-Teacher-AI-Workspace/shared/essay-grading/ui-text.cjs';

const { humanText } = uiText;

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function firstText(...values) {
  for (const value of values) {
    const resolved = humanText(value, '');
    if (resolved) return resolved;
  }
  return '';
}

function firstNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isMeaningfulValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export function mergeGradingResultSupplement(base = {}, supplement = {}) {
  const result = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(supplement || {})) {
    if (!isMeaningfulValue(value)) continue;
    const current = result[key];
    if (current && typeof current === 'object' && !Array.isArray(current) && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = mergeGradingResultSupplement(current, value);
      continue;
    }
    result[key] = Array.isArray(value) ? value.slice() : value;
  }
  return result;
}

export function canonicalizeGradingResult(review = {}) {
  const strengths = toArray(review.strengths ?? review.coreAdvantages ?? review.core_advantages ?? review.summary?.mainStrengths);
  const typoAnalysis = toArray(review.typoAnalysis ?? review.typos ?? review.spellingIssues ?? review.wrongWords ?? review.wrong_words);
  const sentenceIssues = toArray(review.sentenceIssues ?? review.editableSentences ?? review.editable_sentences ?? review.sentenceCorrections ?? review.paragraphComments ?? review.paragraph_comments ?? review.paragraphAnalysis ?? review.paragraphAnalysis);
  const socraticQuestions = toArray(review.socraticQuestions ?? review.socratic_questions ?? review.thinkingCoach?.questions ?? review.thinking_coach?.questions ?? review.thinkingImprovement?.nextQuestions ?? review.thinking_improvement?.next_questions ?? review.nextQuestions ?? review.next_questions);
  const paragraphRefinements = toArray(review.paragraphRefinements ?? review.paragraph_refinements ?? review.paragraphRewrites ?? review.paragraph_rewrites);
  const sentenceIssueProblems = sentenceIssues.map((item) => {
    if (typeof item === 'string') return String(item).trim();
    return String(item?.problem || item?.comment || item?.analysis || '').trim();
  }).filter(Boolean);
  const sentenceIssueRevisions = sentenceIssues.map((item) => {
    if (typeof item === 'string') return '';
    return String(item?.revision || item?.suggestion || item?.rewrite || '').trim();
  }).filter(Boolean);
  const weakSpots = toArray(review.weakSpots ?? review.weaknesses ?? review.problems ?? review.mainProblems ?? review.main_problems ?? review.summary?.mainProblems ?? review.growthAnalysis?.weaknesses ?? review.growth_analysis?.weaknesses ?? review.logicAnalysis?.logicalBreaks ?? review.logic_analysis?.logicalBreaks).concat(sentenceIssueProblems);
  const revisionSuggestions = toArray(review.revisionSuggestions ?? review.improvementSuggestions ?? review.improvement_suggestions ?? review.suggestions ?? review.nextTraining ?? review.next_training ?? review.trainingTasks ?? review.training_tasks).concat(sentenceIssueRevisions);
  const normalizedSentenceIssues = sentenceIssues.length ? sentenceIssues : weakSpots.map((problem, index) => ({
    paragraph: index + 1,
    original: '',
    problem,
    revision: revisionSuggestions[index] || '',
    explanation: problem
  }));
  const totalScore = firstNumber(review.totalScore, review.total_score, review.score?.total, review.score);
  const grade = firstText(review.grade, review.level, review.score?.level);
  const thesisAnalysis = firstText(review.thesisAnalysis, review.topicIntentAnalysis, review.topic_intent_analysis, review.topicAnalysis, review.topic_analysis, review.intentAnalysis, review.intent_analysis);
  const contentAnalysis = firstText(review.contentAnalysis, review.materialAnalysis, review.material_analysis, review.content_analysis);
  const structureAnalysis = firstText(review.structureAnalysis, review.structure_analysis);
  const languageAnalysis = firstText(review.languageAnalysis, review.language_analysis);
  const materialAnalysis = firstText(review.materialAnalysis, review.material_analysis, review.contentAnalysis, review.content_analysis);
  const summary = firstText(review.summary, review.overallEvaluation, review.overall_evaluation, review.teacherOverall, review.teacher_overall, review.teacherComment, review.teacher_comment, review.feedback, review.detailedFeedback, review.detailed_feedback);
  const upgradedEssay = firstText(review.upgradedEssay, review.upgraded_essay, review.excellentVersion, review.excellent_version, review.polishedFullText, review.polished_full_text, review.improvedEssay, review.improved_essay, review.upgradedParagraph, review.upgraded_paragraph);
  const reportMetadata = {
    model: firstText(review.reportMetadata?.model, review.metadata?.model, review.ai_meta?.model, review.model),
    gradingVersion: firstText(review.reportMetadata?.gradingVersion, review.metadata?.gradingVersion, review.metadata?.promptVersion, review.reportVersion, review.report_version, review.promptVersion, review.prompt_version),
    promptVersion: firstText(review.reportMetadata?.promptVersion, review.promptVersion, review.prompt_version),
    reportVersion: firstText(review.reportMetadata?.reportVersion, review.reportVersion, review.report_version),
    generatedAt: firstText(review.reportMetadata?.generatedAt, review.metadata?.generatedAt, review.metadata?.createdAt, review.created_at, review.createdAt),
    sourceType: firstText(review.reportMetadata?.sourceType, review.sourceType, review.source_type)
  };

  return {
    ...review,
    totalScore,
    total_score: totalScore,
    grade,
    level: grade,
    dimensionScores: toArray(review.dimensionScores ?? review.dimension_scores),
    dimension_scores: toArray(review.dimension_scores ?? review.dimensionScores),
    thesisAnalysis,
    topicIntentAnalysis: thesisAnalysis,
    topic_intent_analysis: thesisAnalysis,
    contentAnalysis,
    content_analysis: contentAnalysis,
    structureAnalysis,
    structure_analysis: structureAnalysis,
    languageAnalysis,
    language_analysis: languageAnalysis,
    materialAnalysis,
    material_analysis: materialAnalysis,
    strengths,
    weakSpots,
    weaknesses: weakSpots,
    problems: weakSpots,
    mainProblems: weakSpots,
    main_problems: weakSpots,
    typoAnalysis,
    typos: typoAnalysis,
    spellingIssues: typoAnalysis,
    sentenceIssues: normalizedSentenceIssues,
    editableSentences: normalizedSentenceIssues,
    sentenceCorrections: normalizedSentenceIssues,
    revisionSuggestions,
    improvementSuggestions: revisionSuggestions,
    suggestions: revisionSuggestions,
    socraticQuestions,
    upgradedEssay,
    excellentVersion: upgradedEssay,
    excellent_version: upgradedEssay,
    polishedFullText: upgradedEssay,
    polished_full_text: upgradedEssay,
    paragraphRefinements,
    paragraph_refinements: paragraphRefinements,
    paragraphRewrites: paragraphRefinements,
    paragraph_rewrites: paragraphRefinements,
    summary,
    overallEvaluation: summary,
    overall_evaluation: summary,
    teacherOverall: summary,
    teacher_overall: summary,
    teacherComment: firstText(review.teacherComment, review.teacher_comment, review.teacher_overall),
    teacher_comment: firstText(review.teacherComment, review.teacher_comment, review.teacher_overall),
    reportMetadata,
    metadata: { ...(review.metadata || {}), ...reportMetadata }
  };
}

export function analyzeGradingResultCompleteness(review = {}) {
  const normalized = canonicalizeGradingResult(review);
  const missingCoreFields = [];
  const missingRepairableFields = [];
  if (!Number.isFinite(Number(normalized.totalScore))) missingCoreFields.push('总分');
  if (!String(normalized.grade || '').trim()) missingCoreFields.push('等级');
  if (!toArray(normalized.dimensionScores).length) missingCoreFields.push('分项评分');
  if (!String(normalized.thesisAnalysis || '').trim()) missingCoreFields.push('审题立意');
  if (!String(normalized.contentAnalysis || '').trim()) missingCoreFields.push('内容分析');
  if (!String(normalized.structureAnalysis || '').trim()) missingCoreFields.push('结构分析');
  if (!String(normalized.languageAnalysis || '').trim()) missingCoreFields.push('语言分析');
  if (!String(normalized.materialAnalysis || '').trim()) missingCoreFields.push('素材分析');
  if (!String(normalized.summary || '').trim()) missingCoreFields.push('综合评价');
  if (!String(normalized.reportMetadata?.model || '').trim()) missingCoreFields.push('报告元数据');
  if (!toArray(normalized.strengths).length) missingRepairableFields.push('优点');
  if (!toArray(normalized.weakSpots).length) missingRepairableFields.push('弱项');
  if (!toArray(normalized.sentenceIssues).length) missingRepairableFields.push('病句分析');
  if (!toArray(normalized.revisionSuggestions).length) missingRepairableFields.push('修改建议');
  if (!toArray(normalized.socraticQuestions).length) missingRepairableFields.push('苏格拉底追问');
  if (!String(normalized.upgradedEssay || '').trim()) missingRepairableFields.push('升格文章');
  if (!toArray(normalized.paragraphRefinements).length) missingRepairableFields.push('逐段点评');
  return {
    normalized,
    missingCoreFields,
    missingRepairableFields,
    isComplete: missingCoreFields.length === 0 && missingRepairableFields.length === 0,
    needsRepair: missingCoreFields.length === 0 && missingRepairableFields.length > 0
  };
}

export function validateCompleteGradingResult(review = {}) {
  const analysis = analyzeGradingResultCompleteness(review);
  if (analysis.missingCoreFields.length) {
    const error = new Error(`完整批改结果不完整：缺少${analysis.missingCoreFields.join('、')}`);
    error.code = 'INCOMPLETE_GRADING_RESULT';
    error.statusCode = 502;
    error.missingCoreFields = analysis.missingCoreFields;
    error.missingRepairableFields = analysis.missingRepairableFields;
    throw error;
  }
  return analysis;
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

function reviewVisibilityScore(review = {}) {
  const normalized = canonicalizeGradingResult(review?.raw_json || review || {});
  const analysis = analyzeGradingResultCompleteness(normalized);
  const coreMissingCount = analysis.missingCoreFields.length;
  const repairMissingCount = analysis.missingRepairableFields.length;
  return {
    normalized,
    analysis,
    statusRank: coreMissingCount === 0 ? (repairMissingCount === 0 ? 0 : 1) : 2,
    repairMissingCount,
    versionNumber: Number(review?.version_number || 1),
    id: Number(review?.id || 0)
  };
}

function compareVisibleReviews(a, b) {
  if (a.statusRank !== b.statusRank) return a.statusRank - b.statusRank;
  if (a.repairMissingCount !== b.repairMissingCount) return a.repairMissingCount - b.repairMissingCount;
  if (a.versionNumber !== b.versionNumber) return b.versionNumber - a.versionNumber;
  return b.id - a.id;
}

export function selectCanonicalEssayReview(database, essayId) {
  const reviews = listEssayReviewHistory(database, essayId);
  if (!reviews.length) return null;
  const ranked = reviews.map((review) => ({ review, ...reviewVisibilityScore(review) }));
  ranked.sort(compareVisibleReviews);
  return ranked[0]?.review || null;
}

export function listVisibleEssayReviewHistory(database, essayId) {
  const review = selectCanonicalEssayReview(database, essayId);
  return review ? [review] : [];
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
  const normalizedReview = canonicalizeGradingResult(review);
  if (resolvedSourceType === 'web' || resolvedSourceType === 'image') validateCompleteGradingResult(normalizedReview);
  const resolvedJobId = String(gradingJobId || crypto.randomUUID());
  const rawJson = JSON.stringify(normalizedReview || {});

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
    Number(normalizedReview.totalScore ?? normalizedReview.total_score ?? 0),
    String(normalizedReview.grade || normalizedReview.level || ''),
    safeJson(toArray(normalizedReview.dimensionScores ?? normalizedReview.dimension_scores ?? [])),
    safeJson(toArray(normalizedReview.strengths ?? [])),
    safeJson(toArray(normalizedReview.weakSpots ?? normalizedReview.problems ?? normalizedReview.mainProblems ?? [])),
    safeJson(toArray(normalizedReview.paragraph_comments ?? normalizedReview.paragraphComments ?? [])),
    safeJson(toArray(normalizedReview.editable_sentences ?? normalizedReview.editableSentences ?? normalizedReview.sentenceIssues ?? [])),
    safeJson(toArray(normalizedReview.suggestions ?? normalizedReview.revisionSuggestions ?? [])),
    String(normalizedReview.upgradedEssay || normalizedReview.upgraded_paragraph || normalizedReview.upgradedParagraph || normalizedReview.polished_full_text || normalizedReview.polishedFullText || ''),
    safeJson(toArray(normalizedReview.good_sentences ?? normalizedReview.goodSentences ?? [])),
    safeJson(toArray(normalizedReview.next_training ?? normalizedReview.nextTraining ?? [])),
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
