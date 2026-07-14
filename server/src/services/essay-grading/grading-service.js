import { reviewEssay } from '../openai.js';
import { buildReviewPrompt } from '../prompt.js';
import { countEssayWords } from '../essay-access.js';

function toArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined && item !== null && item !== '');
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizeEssayInput(input = {}, options = {}) {
  const essayId = String(firstValue(input.essayId, options.essayId, '') || '');
  const student = {
    id: String(firstValue(input.studentId, options.studentId, input.student?.id, options.student?.id, '') || ''),
    name: String(firstValue(input.studentName, options.studentName, input.student?.name, options.student?.name, '') || ''),
    classId: String(firstValue(input.classId, options.classId, input.student?.classId, options.student?.classId, '') || ''),
    grade: String(firstValue(input.grade, options.grade, input.student?.grade, options.student?.grade, '') || '')
  };
  const title = String(firstValue(input.title, options.title, '') || '').trim();
  const prompt = String(firstValue(input.prompt, options.prompt, input.teacherRequirements, options.teacherRequirements, '') || '').trim();
  const essayText = String(firstValue(input.essayText, options.essayText, input.text, options.text, '') || '').trim();
  const sourceType = String(firstValue(input.sourceType, options.sourceType, 'api') || 'api');
  const maxScore = Number(firstValue(input.maxScore, options.maxScore, input.fullScore, options.fullScore, 60) || 60);
  return {
    essayId,
    student,
    title,
    prompt,
    essayText,
    sourceType,
    scoringStandard: String(firstValue(input.scoringStandard, options.scoringStandard, '') || ''),
    maxScore: Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 60,
    model: String(firstValue(input.model, options.model, '') || ''),
    teacherRequirements: String(firstValue(input.teacherRequirements, options.teacherRequirements, '') || ''),
    essayType: String(firstValue(input.essayType, options.essayType, '材料作文') || '材料作文'),
    createdAt: String(firstValue(input.createdAt, options.createdAt, new Date().toISOString()) || new Date().toISOString())
  };
}

function mapScoreField(review = {}) {
  const total = Number(review.total_score ?? review.totalScore ?? review.score ?? 0);
  const max = Number(review.full_score ?? review.fullScore ?? review.maxScore ?? 60) || 60;
  return {
    total,
    max,
    level: String(review.level || review.grade || ''),
    percentile: review.percentile ?? null,
    confidence: review.confidence ?? null
  };
}

function mapDimensions(review = {}) {
  return {
    theme: review.theme || review.topic_intent_analysis || review.topicIntentAnalysis || '',
    content: review.material_analysis || review.materialAnalysis || review.content_analysis || '',
    structure: review.structure_analysis || review.structureAnalysis || '',
    logic: review.logic_analysis || review.logicAnalysis || '',
    argumentation: review.argumentation || review.logic_analysis || review.logicAnalysis || '',
    evidence: review.evidence || review.material_analysis || review.materialAnalysis || '',
    language: review.language_analysis || review.languageAnalysis || '',
    literaryExpression: review.literary_expression || review.literaryExpression || '',
    innovation: review.innovation || review.originality || '',
    writingStandard: review.writing_standard || review.writingStandard || ''
  };
}

function normalizeUnifiedReview(review = {}, context = {}) {
  const score = mapScoreField(review);
  const student = context.student || { id: '', name: '', classId: '', grade: '' };
  const overallComment = String(firstValue(
    review.overall_evaluation,
    review.overallEvaluation,
    review.teacher_overall,
    review.teacherComment,
    ''
  ) || '');
  const strengths = toArray(review.strengths ?? review.coreAdvantages);
  const problems = toArray(review.problems ?? review.mainProblems ?? review.weaknesses);
  const priorityImprovements = toArray(review.next_training ?? review.nextTraining ?? review.suggestions)
    .map((item) => (typeof item === 'string' ? item : item?.focus || item?.diagnosis || item?.task || JSON.stringify(item)))
    .filter(Boolean);
  const paragraphAnalysis = toArray(review.paragraph_refinements ?? review.paragraphRefinements ?? review.paragraph_rewrites ?? review.paragraphRewrites);
  const sentenceAnalysis = toArray(review.editable_sentences ?? review.editableSentences);
  const logicAnalysis = {
    centralClaim: String(review.logic_analysis || review.logicAnalysis || ''),
    subClaims: toArray(review.logic_thinking_score?.items).map((item) => item?.name).filter(Boolean),
    reasoningChain: toArray(review.suggestions).map((item) => item?.logic_analysis || item?.action_steps || item?.diagnosis || '').filter(Boolean),
    logicalBreaks: problems,
    counterargument: String(review.thinking_coach?.guidance || ''),
    depthSuggestions: toArray(review.thinking_improvement?.next_questions || review.thinkingImprovement?.next_questions)
  };

  const result = {
    reportVersion: '2.0',
    essayId: context.essayId || '',
    student,
    essay: {
      title: context.title || '',
      prompt: context.prompt || '',
      text: context.essayText || '',
      wordCount: countEssayWords(context.essayText || '')
    },
    score,
    dimensions: mapDimensions(review),
    summary: {
      overallComment,
      mainStrengths: strengths,
      mainProblems: problems,
      priorityImprovements
    },
    paragraphAnalysis,
    sentenceAnalysis,
    logicAnalysis,
    languageIssues: toArray(review.languageIssues || review.language_issues || []),
    typos: toArray(review.typos || review.spellingIssues || []),
    goodSentences: toArray(review.good_sentences ?? review.goodSentences),
    revisionPlan: priorityImprovements,
    exampleRevisions: toArray(review.paragraph_refinements ?? review.paragraphRefinements),
    rewrittenParagraphs: toArray(review.paragraph_rewrites ?? review.paragraphRewrites),
    teacherReview: {
      status: review.teacherReview?.status || 'pending',
      comment: review.teacherReview?.comment || review.teacherComment || review.teacher_comment || '',
      finalScore: review.teacherReview?.finalScore ?? review.teacher_review?.finalScore ?? null
    },
    artifacts: {
      htmlUrl: review.artifacts?.htmlUrl || '',
      pdfUrl: review.artifacts?.pdfUrl || '',
      docxUrl: review.artifacts?.docxUrl || ''
    },
    metadata: {
      model: review.ai_meta?.model || review.model || context.model || '',
      promptVersion: review.promptVersion || 'p1.5',
      createdAt: context.createdAt || new Date().toISOString(),
      sourceType: context.sourceType || 'api'
    },
    raw: review
  };

  return {
    ...result,
    total_score: score.total,
    full_score: score.max,
    dimension_scores: toArray(review.dimension_scores ?? review.dimensionScores),
    overall_evaluation: overallComment,
    topic_intent_analysis: String(review.topic_intent_analysis || review.topicIntentAnalysis || ''),
    structure_analysis: String(review.structure_analysis || review.structureAnalysis || ''),
    logic_analysis: String(review.logic_analysis || review.logicAnalysis || ''),
    language_analysis: String(review.language_analysis || review.languageAnalysis || ''),
    material_analysis: String(review.material_analysis || review.materialAnalysis || ''),
    recommended_materials: toArray(review.recommended_materials ?? review.recommendedMaterials),
    gaokao_scoring: review.gaokao_scoring || review.gaokaoScoring || review.gaokao_dimensions || null,
    paragraph_refinements: paragraphAnalysis,
    paragraph_rewrites: paragraphAnalysis,
    excellent_version: String(review.excellent_version || review.excellentVersion || review.polished_full_text || review.polishedFullText || ''),
    strengths,
    core_advantages: strengths,
    problems,
    main_problems: problems,
    paragraph_comments: toArray(review.paragraph_comments ?? review.paragraphComments),
    editable_sentences: sentenceAnalysis,
    suggestions: toArray(review.suggestions ?? review.suggestion),
    upgraded_paragraph: String(review.upgraded_paragraph || review.upgradedParagraph || ''),
    good_sentences: toArray(review.good_sentences ?? review.goodSentences),
    next_training: priorityImprovements,
    training_tasks: toArray(review.training_tasks ?? review.trainingTasks ?? review.next_training ?? review.nextTraining),
    teacher_comment: String(review.teacher_comment || review.teacherComment || review.teacher_overall || ''),
    title_revision: String(review.title_revision || review.titleRevision || ''),
    opening_revision: String(review.opening_revision || review.openingRevision || ''),
    ending_revision: String(review.ending_revision || review.endingRevision || ''),
    polished_full_text: String(review.polished_full_text || review.polishedFullText || ''),
    growth_analysis: review.growth_analysis || review.growthAnalysis || null,
    logic_thinking_score: review.logic_thinking_score || review.logicThinkingScore || null,
    thinking_depth: review.thinking_depth || review.thinkingDepth || null,
    thinking_improvement: review.thinking_improvement || review.thinkingImprovement || null,
    teacher_overall: String(review.teacher_overall || review.teacherOverall || review.teacher_comment || review.teacherComment || ''),
    totalScore: score.total,
    fullScore: score.max,
    level: score.level,
    dimensionScores: toArray(review.dimension_scores ?? review.dimensionScores),
    overallEvaluation: overallComment,
    topicIntentAnalysis: String(review.topic_intent_analysis || review.topicIntentAnalysis || ''),
    structureAnalysis: String(review.structure_analysis || review.structureAnalysis || ''),
    logicAnalysisText: String(review.logic_analysis || review.logicAnalysis || ''),
    languageAnalysis: String(review.language_analysis || review.languageAnalysis || ''),
    materialAnalysis: String(review.material_analysis || review.materialAnalysis || ''),
    recommendedMaterials: toArray(review.recommended_materials ?? review.recommendedMaterials),
    gaokaoScoring: review.gaokao_scoring || review.gaokaoScoring || review.gaokao_dimensions || null,
    paragraphRefinements: paragraphAnalysis,
    excellentVersion: String(review.excellent_version || review.excellentVersion || review.polished_full_text || review.polishedFullText || ''),
    coreAdvantages: strengths,
    mainProblems: problems,
    paragraphComments: toArray(review.paragraph_comments ?? review.paragraphComments),
    editableSentences: sentenceAnalysis,
    suggestions: toArray(review.suggestions ?? review.suggestion),
    upgradedParagraph: String(review.upgraded_paragraph || review.upgradedParagraph || ''),
    goodSentences: toArray(review.good_sentences ?? review.goodSentences),
    nextTraining: priorityImprovements,
    trainingTasks: toArray(review.training_tasks ?? review.trainingTasks ?? review.next_training ?? review.nextTraining),
    teacherComment: String(review.teacher_comment || review.teacherComment || review.teacher_overall || ''),
    titleRevision: String(review.title_revision || review.titleRevision || ''),
    openingRevision: String(review.opening_revision || review.openingRevision || ''),
    endingRevision: String(review.ending_revision || review.endingRevision || ''),
    polishedFullText: String(review.polished_full_text || review.polishedFullText || ''),
    growthAnalysis: review.growth_analysis || review.growthAnalysis || null,
    logicThinkingScore: review.logic_thinking_score || review.logicThinkingScore || null,
    thinkingDepth: review.thinking_depth || review.thinkingDepth || null,
    thinkingImprovement: review.thinking_improvement || review.thinkingImprovement || null
  };
}

export async function gradeEssay(input = {}, options = {}) {
  const context = normalizeEssayInput(input, options);
  const assignment = {
    title: context.title || '作文批改',
    prompt: context.prompt || context.teacherRequirements || '请按高中语文 60 分制完成作文批改。',
    essay_type: context.essayType,
    full_score: context.maxScore
  };
  const review = await reviewEssay({ assignment, essayText: context.essayText });
  return normalizeUnifiedReview(review, context);
}

export { buildReviewPrompt };
export { normalizeUnifiedReview as normalizeGradingResult };
