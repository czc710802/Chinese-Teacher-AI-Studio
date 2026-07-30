function firstValue(source, keys = []) {
  for (const key of keys) {
    const value = key.includes('.') ? key.split('.').reduce((acc, part) => acc && acc[part], source) : source?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function asText(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function collectNarrativeText(source = {}) {
  const analysis = source?.analysis && typeof source.analysis === 'object' ? source.analysis : {};
  const candidates = [
    source.overall_evaluation,
    source.overallEvaluation,
    source.summary,
    source.teacherComment,
    source.teacher_comment,
    source.teacherOverall,
    source.teacher_overall,
    source.logic_analysis,
    source.logicAnalysis,
    source.content_analysis,
    source.contentAnalysis,
    source.structure_analysis,
    source.structureAnalysis,
    source.language_analysis,
    source.languageAnalysis,
    source.material_analysis,
    source.materialAnalysis,
    source.thesisAnalysis,
    source.topicIntentAnalysis,
    source.topic_intent_analysis,
    source.topicAnalysis,
    source.topic_analysis,
    source.growth_analysis,
    source.growthAnalysis,
    source.thinking_improvement?.current,
    source.thinkingImprovement?.current,
    source.thinking_coach?.diagnosis,
    source.thinkingCoach?.diagnosis,
    analysis.summary,
    analysis.overallComment,
    analysis.teacherComment,
    analysis.logicAnalysis,
    analysis.contentAnalysis,
    analysis.structureAnalysis,
    analysis.languageAnalysis,
    analysis.materialAnalysis,
    analysis.thesisAnalysis,
    analysis.topicAnalysis,
    analysis.topicIntentAnalysis
  ];
  return candidates.map(asText).filter(Boolean).join('\n');
}

function extractNarrativeHints(text = '') {
  const source = String(text || '');
  if (!source.trim()) return [];
  const patterns = [
    /(?:最大优点(?:在于|是|为)|优点(?:在于|是|为)|亮点(?:在于|是|为))([^。；;\n]+)/,
    /(?:最大短板(?:在于|是|为)|最大问题(?:在于|是|为)|短板(?:在于|是|为)|问题(?:在于|是|为)|不足(?:在于|是|为))([^。；;\n]+)/,
    /(?:修改建议|改进建议|完善建议|建议)(?:[:：]\s*)?([^。；;\n]+)/,
    /(?:需在|应在|需要在)([^。；;\n]+?)(?:上|方面)(?:重点)?(?:训练|提升|加强|完善)?/
  ];
  const output = [];
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[1]) {
      output.push(
        ...String(match[1])
          .split(/[，,、；;]/)
          .map((item) => item.trim())
          .filter(Boolean)
      );
    }
  }
  return [...new Set(output)];
}

function pickScoreValue(score = {}) {
  if (score && typeof score === 'object' && !Array.isArray(score)) {
    return firstValue(score, ['total', 'score', 'value', 'points']);
  }
  return score;
}

function normalizeScoreBlock(review = {}) {
  const score = review.score;
  if (!score || typeof score !== 'object' || Array.isArray(score)) return {};
  return {
    total: firstValue(score, ['total', 'score', 'value', 'points']),
    max: firstValue(score, ['max', 'full', 'fullScore', 'maximum']),
    level: firstValue(score, ['level', 'grade', 'label'])
  };
}

function normalizeScalarScore(review = {}, scoreBlock = {}) {
  const directScore = firstValue(review, ['score', 'score.total', 'score.score', 'score.value', 'score.points']);
  if (directScore !== undefined) return directScore;
  if (review.score && typeof review.score === 'object' && !Array.isArray(review.score)) return review.score;
  return firstValue(review, ['totalScore', 'total_score']) ?? scoreBlock.total ?? null;
}

function normalizeTotalScore(review = {}, scoreBlock = {}) {
  const directScore = review?.score;
  if (Number.isFinite(Number(directScore))) return Number(directScore);
  if (directScore && typeof directScore === 'object' && !Array.isArray(directScore)) {
    const value = firstValue(directScore, ['total', 'score', 'value', 'points']);
    if (value !== undefined && value !== null && value !== '') return Number(value);
  }
  const explicit = firstValue(review, ['totalScore', 'total_score']);
  if (explicit !== undefined && explicit !== null && explicit !== '') return Number(explicit);
  const blockValue = pickScoreValue(scoreBlock);
  if (blockValue !== undefined && blockValue !== null && blockValue !== '') return Number(blockValue);
  return null;
}

function defaultRecommendedList(value) {
  return asArray(value);
}

function defaultRecommendedText(value) {
  return asText(value);
}

function defaultRecommendedObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function extractOriginalEssayText(review = {}) {
  return firstValue(review, [
    'essay.text',
    'essayText',
    'originalEssay',
    'essay.content',
    'essay.body',
    'submission.text',
    'submission.content'
  ]);
}

function replaceFirstOccurrence(source = '', searchValue = '', replacementValue = '') {
  const text = String(source || '');
  const needle = String(searchValue || '');
  if (!text || !needle) return text;
  const index = text.indexOf(needle);
  if (index < 0) return text;
  return `${text.slice(0, index)}${replacementValue}${text.slice(index + needle.length)}`;
}

function synthesizeRevisedEssayFromSentenceIssues(review = {}, normalized = {}) {
  const originalEssay = String(extractOriginalEssayText(review) || '').trim();
  if (!originalEssay) return '';
  const sentenceIssues = asArray(
    normalized.sentenceIssues
    || normalized.editableSentences
    || normalized.editable_sentences
    || normalized.sentenceCorrections
  );
  if (!sentenceIssues.length) return '';

  let synthesized = originalEssay;
  let changed = false;
  for (const issue of sentenceIssues) {
    if (!issue || typeof issue !== 'object') continue;
    const original = asText(issue.original || issue.source || issue.text || issue.before || issue.sentence || '');
    const revision = asText(issue.revision || issue.revised || issue.rewrite || issue.after || issue.suggestion || '');
    if (!original || !revision) continue;
    const next = replaceFirstOccurrence(synthesized, original, revision);
    if (next !== synthesized) {
      synthesized = next;
      changed = true;
      continue;
    }
    const originalNoSpace = original.replace(/\s+/g, '');
    const synthesizedNoSpace = synthesized.replace(/\s+/g, '');
    const looseIndex = originalNoSpace ? synthesizedNoSpace.indexOf(originalNoSpace) : -1;
    if (looseIndex >= 0) {
      const normalizedChars = [...synthesized];
      const compact = synthesized.replace(/\s+/g, '');
      const before = compact.slice(0, looseIndex);
      const after = compact.slice(looseIndex + originalNoSpace.length);
      synthesized = `${before}${revision}${after}`;
      changed = true;
    }
  }
  return changed ? synthesized.trim() : '';
}

export function normalizeGradingResultAliases(review = {}) {
  const scoreBlock = normalizeScoreBlock(review);
  const normalized = { ...review };

  if (normalized.totalScore === undefined || normalized.totalScore === null || normalized.totalScore === '') {
    normalized.totalScore = normalizeTotalScore(review, scoreBlock);
  }
  if (normalized.total_score === undefined || normalized.total_score === null || normalized.total_score === '') {
    normalized.total_score = normalized.totalScore;
  }
  if (normalized.score === undefined || normalized.score === null || normalized.score === '') {
    normalized.score = normalizeScalarScore(review, scoreBlock);
  }
  if (normalized.grade === undefined || normalized.grade === null || normalized.grade === '') {
    normalized.grade = firstValue(review, ['grade', 'level']) ?? scoreBlock.level ?? '';
  }
  if (normalized.level === undefined || normalized.level === null || normalized.level === '') {
    normalized.level = normalized.grade;
  }

  const dimensionScores = firstValue(review, ['dimensionScores', 'dimension_scores', 'dimensions', 'score.dimensions', 'score.dimensionScores']);
  if (!asArray(normalized.dimensionScores).length && dimensionScores !== undefined) {
    normalized.dimensionScores = dimensionScores;
  }
  if (!asArray(normalized.dimension_scores).length && normalized.dimensionScores !== undefined) {
    normalized.dimension_scores = normalized.dimensionScores;
  }
  if (!asArray(normalized.dimensions).length && normalized.dimensionScores !== undefined) {
    normalized.dimensions = normalized.dimensionScores;
  }

  const strengths = firstValue(review, ['strengths', 'strength', 'goodPoints', 'coreAdvantages', 'core_advantages', 'advantages', '优点', '优长']);
  if (!asArray(normalized.strengths).length && strengths !== undefined) normalized.strengths = strengths;

  const weakSpots = firstValue(review, ['weakSpots', 'weaknesses', 'problems', 'problem', 'mainProblems', 'main_problems', 'issues', 'weakness', 'weakness_list', '弱项', '不足']);
  if (!asArray(normalized.weakSpots).length && weakSpots !== undefined) normalized.weakSpots = weakSpots;

  const problems = firstValue(review, ['problems', 'problem', 'weaknesses', 'weakSpots', 'mainProblems', 'main_problems', 'issues', 'weakness', '弱项', '不足']);
  if (!asArray(normalized.problems).length && problems !== undefined) normalized.problems = problems;

  if (!asArray(normalized.weaknesses).length && normalized.problems !== undefined) normalized.weaknesses = normalized.problems;
  if (!asArray(normalized.mainProblems).length && normalized.problems !== undefined) normalized.mainProblems = normalized.problems;
  if (!asArray(normalized.main_problems).length && normalized.problems !== undefined) normalized.main_problems = normalized.problems;

  const revisionSuggestions = firstValue(review, ['revisionSuggestions', 'improvementSuggestions', 'improvement_suggestions', 'suggestions', 'advice', 'advises', 'recommendations', 'improvements', 'nextTraining', 'next_training', 'trainingTasks', 'training_tasks', '修改建议']);
  if (!asArray(normalized.revisionSuggestions).length && revisionSuggestions !== undefined) normalized.revisionSuggestions = revisionSuggestions;
  if (!asArray(normalized.improvementSuggestions).length && normalized.revisionSuggestions !== undefined) normalized.improvementSuggestions = normalized.revisionSuggestions;
  if (!asArray(normalized.suggestions).length && normalized.revisionSuggestions !== undefined) normalized.suggestions = normalized.revisionSuggestions;
  if (!asArray(normalized.improvements).length && normalized.revisionSuggestions !== undefined) normalized.improvements = normalized.revisionSuggestions;

  const narrativeHints = extractNarrativeHints(collectNarrativeText(review));
  if (!asArray(normalized.strengths).length && narrativeHints.length) {
    const inferredStrengths = narrativeHints.filter((item) => /优点|亮点|结构意识|表达|文采|比喻|思路|框架|结构/.test(item));
    if (inferredStrengths.length) normalized.strengths = inferredStrengths;
  }
  if (!asArray(normalized.weakSpots).length && narrativeHints.length) {
    const inferredWeakSpots = narrativeHints.filter((item) => /短板|问题|不足|偏移|偏题|断裂|残缺|浅层|口号化|堆砌|不完整/.test(item));
    if (inferredWeakSpots.length) normalized.weakSpots = inferredWeakSpots;
  }
  if (!asArray(normalized.problems).length && normalized.weakSpots !== undefined) normalized.problems = normalized.weakSpots;
  if (!asArray(normalized.revisionSuggestions).length && narrativeHints.length) normalized.revisionSuggestions = narrativeHints.slice(0, 8);

  const upgradedEssay = firstValue(review, ['upgradedEssay', 'upgraded_essay', 'excellentVersion', 'excellent_version', 'polishedFullText', 'polished_full_text', 'improvedEssay', 'improved_essay', 'rewrite', 'optimizedEssay', 'optimized_essay', 'revisedEssay', 'revised_essay', 'upgradedParagraph', 'upgraded_paragraph', '升格作文']);
  if (!asText(normalized.upgradedEssay) && upgradedEssay !== undefined) normalized.upgradedEssay = upgradedEssay;
  if (!asText(normalized.excellentVersion) && normalized.upgradedEssay !== undefined) normalized.excellentVersion = normalized.upgradedEssay;
  if (!asText(normalized.polishedFullText) && normalized.upgradedEssay !== undefined) normalized.polishedFullText = normalized.upgradedEssay;
  if (!asText(normalized.polished_full_text) && normalized.upgradedEssay !== undefined) normalized.polished_full_text = normalized.upgradedEssay;
  if (!asText(normalized.revisedEssay) && normalized.upgradedEssay !== undefined) normalized.revisedEssay = normalized.upgradedEssay;
  if (!asText(normalized.revised_essay) && normalized.upgradedEssay !== undefined) normalized.revised_essay = normalized.upgradedEssay;
  if (!asText(normalized.optimizedEssay) && normalized.revisedEssay !== undefined) normalized.optimizedEssay = normalized.revisedEssay;
  if (!asText(normalized.optimized_essay) && normalized.revisedEssay !== undefined) normalized.optimized_essay = normalized.revisedEssay;

  const synthesizedRevisedEssay = synthesizeRevisedEssayFromSentenceIssues(review, normalized);
  if (!asText(normalized.revisedEssay) && synthesizedRevisedEssay) normalized.revisedEssay = synthesizedRevisedEssay;
  if (!asText(normalized.revised_essay) && synthesizedRevisedEssay) normalized.revised_essay = synthesizedRevisedEssay;
  if (!asText(normalized.upgradedEssay) && normalized.revisedEssay) normalized.upgradedEssay = normalized.revisedEssay;

  const summary = firstValue(review, ['summary', 'overallEvaluation', 'overall_evaluation', 'teacherComment', 'teacher_comment', 'teacherOverall', 'teacher_overall', 'feedback', 'detailedFeedback', 'detailed_feedback', '综合评价', '总体评价']);
  if (!asText(normalized.summary) && summary !== undefined) normalized.summary = summary;
  if (!asText(normalized.overallEvaluation) && normalized.summary !== undefined) normalized.overallEvaluation = normalized.summary;
  if (!asText(normalized.overall_evaluation) && normalized.summary !== undefined) normalized.overall_evaluation = normalized.summary;
  if (!asText(normalized.teacherComment) && normalized.summary !== undefined) normalized.teacherComment = normalized.summary;
  if (!asText(normalized.teacher_comment) && normalized.summary !== undefined) normalized.teacher_comment = normalized.summary;

  const thesis = firstValue(review, ['thesisAnalysis', 'topicIntentAnalysis', 'topic_intent_analysis', 'topicAnalysis', 'topic_analysis', 'intentAnalysis', 'intent_analysis', '审题立意']);
  if (!asText(normalized.thesisAnalysis) && thesis !== undefined) normalized.thesisAnalysis = thesis;
  if (!asText(normalized.topicIntentAnalysis) && normalized.thesisAnalysis !== undefined) normalized.topicIntentAnalysis = normalized.thesisAnalysis;
  if (!asText(normalized.topic_intent_analysis) && normalized.thesisAnalysis !== undefined) normalized.topic_intent_analysis = normalized.thesisAnalysis;
  if (!asText(normalized.topicAnalysis) && normalized.thesisAnalysis !== undefined) normalized.topicAnalysis = normalized.thesisAnalysis;
  if (!asText(normalized.topic_analysis) && normalized.thesisAnalysis !== undefined) normalized.topic_analysis = normalized.thesisAnalysis;

  const contentAnalysis = firstValue(review, ['contentAnalysis', 'content_analysis', 'materialAnalysis', 'material_analysis', '内容分析', '素材分析']);
  if (!asText(normalized.contentAnalysis) && contentAnalysis !== undefined) normalized.contentAnalysis = contentAnalysis;
  if (!asText(normalized.content_analysis) && normalized.contentAnalysis !== undefined) normalized.content_analysis = normalized.contentAnalysis;
  if (!asText(normalized.analysis?.contentAnalysis) && normalized.contentAnalysis !== undefined && normalized.analysis && typeof normalized.analysis === 'object') normalized.analysis.contentAnalysis = normalized.contentAnalysis;

  const structureAnalysis = firstValue(review, ['structureAnalysis', 'structure_analysis', '结构分析']);
  if (!asText(normalized.structureAnalysis) && structureAnalysis !== undefined) normalized.structureAnalysis = structureAnalysis;
  if (!asText(normalized.structure_analysis) && normalized.structureAnalysis !== undefined) normalized.structure_analysis = normalized.structureAnalysis;

  const languageAnalysis = firstValue(review, ['languageAnalysis', 'language_analysis', '语言分析']);
  if (!asText(normalized.languageAnalysis) && languageAnalysis !== undefined) normalized.languageAnalysis = languageAnalysis;
  if (!asText(normalized.language_analysis) && normalized.languageAnalysis !== undefined) normalized.language_analysis = normalized.languageAnalysis;

  const materialAnalysis = firstValue(review, ['materialAnalysis', 'material_analysis', '素材分析']);
  if (!asText(normalized.materialAnalysis) && materialAnalysis !== undefined) normalized.materialAnalysis = materialAnalysis;
  if (!asText(normalized.material_analysis) && normalized.materialAnalysis !== undefined) normalized.material_analysis = normalized.materialAnalysis;

  const socraticQuestions = firstValue(review, ['socraticQuestions', 'socratic_questions', 'thinkingCoach.questions', 'thinking_coach.questions', 'thinkingImprovement.nextQuestions', 'thinking_improvement.next_questions', 'nextQuestions', 'next_questions']);
  if (!asArray(normalized.socraticQuestions).length && socraticQuestions !== undefined) normalized.socraticQuestions = socraticQuestions;

  const sentenceIssues = firstValue(review, ['sentenceIssues', 'editableSentences', 'editable_sentences', 'sentenceCorrections', 'paragraph_comments', 'paragraphComments', 'paragraphComments', 'paragraphAnalysis']);
  if (!asArray(normalized.sentenceIssues).length && sentenceIssues !== undefined) normalized.sentenceIssues = sentenceIssues;
  if (!asArray(normalized.editableSentences).length && normalized.sentenceIssues !== undefined) normalized.editableSentences = normalized.sentenceIssues;
  if (!asArray(normalized.editable_sentences).length && normalized.sentenceIssues !== undefined) normalized.editable_sentences = normalized.sentenceIssues;
  if (!asArray(normalized.sentenceCorrections).length && normalized.sentenceIssues !== undefined) normalized.sentenceCorrections = normalized.sentenceIssues;

  const typoAnalysis = firstValue(review, ['typoAnalysis', 'typos', 'spellingIssues', 'wrongWords', 'wrong_words', '错别字', '病句分析']);
  if (!asArray(normalized.typoAnalysis).length && typoAnalysis !== undefined) normalized.typoAnalysis = typoAnalysis;
  if (!asArray(normalized.typos).length && normalized.typoAnalysis !== undefined) normalized.typos = normalized.typoAnalysis;

  const reportMetadata = firstValue(review, ['reportMetadata', 'metadata', 'ai_meta']);
  if ((!normalized.reportMetadata || !Object.keys(normalized.reportMetadata).length) && reportMetadata && typeof reportMetadata === 'object') normalized.reportMetadata = reportMetadata;
  if (!normalized.metadata && normalized.reportMetadata) normalized.metadata = { ...(normalized.metadata || {}), ...normalized.reportMetadata };
  if (!normalized.teacherComment && normalized.summary !== undefined) normalized.teacherComment = normalized.summary;
  if (!normalized.teacher_comment && normalized.teacherComment !== undefined) normalized.teacher_comment = normalized.teacherComment;
  if (!normalized.teacherComment && normalized.analysis?.teacherComment !== undefined) normalized.teacherComment = normalized.analysis.teacherComment;
  if (!normalized.teacher_comment && normalized.analysis?.teacherComment !== undefined) normalized.teacher_comment = normalized.analysis.teacherComment;
  normalized.strengths = defaultRecommendedList(normalized.strengths);
  normalized.problems = defaultRecommendedList(normalized.problems);
  normalized.weakSpots = defaultRecommendedList(normalized.weakSpots);
  normalized.revisionSuggestions = defaultRecommendedList(normalized.revisionSuggestions);
  normalized.suggestions = defaultRecommendedList(normalized.suggestions);
  normalized.improvements = defaultRecommendedList(normalized.improvements);
  normalized.dimensionScores = defaultRecommendedList(normalized.dimensionScores);
  normalized.dimension_scores = defaultRecommendedList(normalized.dimension_scores);
  normalized.dimensions = defaultRecommendedList(normalized.dimensions);
  normalized.socraticQuestions = defaultRecommendedList(normalized.socraticQuestions);
  normalized.sentenceIssues = defaultRecommendedList(normalized.sentenceIssues);
  normalized.typoAnalysis = defaultRecommendedList(normalized.typoAnalysis);
  normalized.teacherComment = defaultRecommendedText(normalized.teacherComment);
  normalized.teacher_comment = defaultRecommendedText(normalized.teacher_comment);
  normalized.revisedEssay = defaultRecommendedText(normalized.revisedEssay || normalized.upgradedEssay);
  normalized.revised_essay = defaultRecommendedText(normalized.revised_essay || normalized.revisedEssay);
  normalized.upgradedEssay = defaultRecommendedText(normalized.upgradedEssay || normalized.revisedEssay);
  normalized.score = normalized.score ?? normalized.totalScore ?? normalized.total_score ?? null;
  if (normalized.analysis && typeof normalized.analysis === 'object' && !Array.isArray(normalized.analysis)) {
    normalized.analysis = {
      ...normalized.analysis,
      strengths: defaultRecommendedList(normalized.analysis.strengths),
      weaknesses: defaultRecommendedList(normalized.analysis.weaknesses),
      problems: defaultRecommendedList(normalized.analysis.problems),
      revisionSuggestions: defaultRecommendedList(normalized.analysis.revisionSuggestions),
      suggestions: defaultRecommendedList(normalized.analysis.suggestions),
      dimensions: defaultRecommendedList(normalized.analysis.dimensions),
      dimensionScores: defaultRecommendedList(normalized.analysis.dimensionScores),
      teacherComment: defaultRecommendedText(normalized.analysis.teacherComment || normalized.teacherComment),
      revisedEssay: defaultRecommendedText(normalized.analysis.revisedEssay || normalized.revisedEssay),
      totalScore: normalized.analysis.totalScore ?? normalized.totalScore ?? null,
      score: normalized.analysis.score ?? normalized.score ?? null
    };
  }

  return normalized;
}

function valueType(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  return typeof value;
}

function valueState(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length ? 'array' : 'empty_array';
  if (typeof value === 'string') return value.trim() ? 'string' : 'empty_string';
  if (typeof value === 'object') return Object.keys(value).length ? 'object' : 'empty_object';
  return 'value';
}

function fieldSnapshot(source, keys) {
  for (const key of keys) {
    const value = key.includes('.') ? key.split('.').reduce((acc, part) => acc && acc[part], source) : source?.[key];
    if (value !== undefined) {
      return {
        key,
        state: valueState(value),
        type: valueType(value),
        valuePreview: typeof value === 'string' ? value.slice(0, 120) : Array.isArray(value) ? value.slice(0, 3) : value
      };
    }
  }
  return { key: keys[0], state: 'missing', type: 'undefined' };
}

export function buildGradingDiagnostics(rawReview = {}, normalizedReview = null) {
  const normalized = normalizedReview ? normalizeGradingResultAliases(normalizedReview) : normalizeGradingResultAliases(rawReview);
  const fields = {
    score: fieldSnapshot(normalized, ['score', 'totalScore', 'total_score', 'score.total']),
    revisedEssay: fieldSnapshot(normalized, ['revisedEssay', 'upgradedEssay', 'revised_essay', 'upgraded_paragraph', 'polishedFullText', 'polished_full_text']),
    totalScore: fieldSnapshot(normalized, ['totalScore', 'total_score', 'score.total', 'score']),
    grade: fieldSnapshot(normalized, ['grade', 'level', 'score.level']),
    strengths: fieldSnapshot(normalized, ['strengths', 'coreAdvantages', 'core_advantages', 'advantages', '优点']),
    weakSpots: fieldSnapshot(normalized, ['weakSpots', 'weaknesses', 'problems', 'mainProblems', 'main_problems', 'issues', '弱项']),
    problems: fieldSnapshot(normalized, ['problems', 'weaknesses', 'weakSpots', 'issues', '弱项']),
    revisionSuggestions: fieldSnapshot(normalized, ['revisionSuggestions', 'improvementSuggestions', 'suggestions', 'advice', 'recommendations', '修改建议']),
    upgradedEssay: fieldSnapshot(normalized, ['upgradedEssay', 'revisedEssay', 'revised_essay', 'excellentVersion', 'polishedFullText', 'upgraded_paragraph', '升格作文']),
    dimensionScores: fieldSnapshot(normalized, ['dimensionScores', 'dimension_scores', 'dimensions', 'score.dimensions']),
    thesisAnalysis: fieldSnapshot(normalized, ['thesisAnalysis', 'topicIntentAnalysis', 'topic_intent_analysis', 'topicAnalysis', '审题立意']),
    contentAnalysis: fieldSnapshot(normalized, ['contentAnalysis', 'content_analysis', 'materialAnalysis', 'material_analysis', '内容分析', '素材分析']),
    structureAnalysis: fieldSnapshot(normalized, ['structureAnalysis', 'structure_analysis', '结构分析']),
    languageAnalysis: fieldSnapshot(normalized, ['languageAnalysis', 'language_analysis', '语言分析']),
    materialAnalysis: fieldSnapshot(normalized, ['materialAnalysis', 'material_analysis', '素材分析']),
    summary: fieldSnapshot(normalized, ['summary', 'overallEvaluation', 'overall_evaluation', 'teacherComment', '综合评价', '总体评价']),
    teacherComment: fieldSnapshot(normalized, ['teacherComment', 'teacher_comment', 'summary', 'overallEvaluation', 'overall_evaluation']),
    socraticQuestions: fieldSnapshot(normalized, ['socraticQuestions', 'socratic_questions', 'thinkingCoach.questions', 'thinking_coach.questions']),
    sentenceIssues: fieldSnapshot(normalized, ['sentenceIssues', 'editableSentences', 'editable_sentences', 'sentenceCorrections', 'paragraphComments']),
    typoAnalysis: fieldSnapshot(normalized, ['typoAnalysis', 'typos', 'spellingIssues', 'wrongWords', 'wrong_words'])
  };
  const missing = Object.fromEntries(Object.entries(fields).filter(([, entry]) => entry.state === 'missing' || entry.state === 'empty_array' || entry.state === 'empty_string').map(([name, entry]) => [name, entry.state]));
  return {
    fields,
    missing,
    keys: Object.keys(normalized || {}),
    rawType: valueType(rawReview),
    normalizedType: valueType(normalized)
  };
}
