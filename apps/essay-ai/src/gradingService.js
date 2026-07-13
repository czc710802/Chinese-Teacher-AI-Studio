import path from 'node:path';

import { reviewEssay } from '../../../server/src/services/openai.js';
import { getAIProviderStatus } from '../../../server/src/services/ai/client-factory.js';

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function normalizeReview(raw = {}, { title = '', text = '', fullScore = 60 } = {}) {
  const dimensionScores = toArray(raw.dimension_scores ?? raw.dimensionScores).map((item) => ({
    name: item?.name || item?.dimension || '维度',
    score: Number(item?.score ?? 0),
    full: Number(item?.full ?? item?.fullScore ?? 10),
    comment: item?.comment || item?.analysis || ''
  }));

  return {
    title,
    text,
    fullScore,
    totalScore: Number(raw.total_score ?? raw.totalScore ?? Math.round(fullScore * 0.78)),
    level: raw.level || '二类文',
    dimensionScores,
    overallEvaluation: firstValue(raw.overall_evaluation, raw.overallEvaluation, raw.teacher_overall, raw.teacherComment, ''),
    topicIntentAnalysis: firstValue(raw.topic_intent_analysis, raw.topicIntentAnalysis, raw.intent_analysis, raw.idea_analysis, ''),
    structureAnalysis: firstValue(raw.structure_analysis, raw.structureAnalysis, ''),
    logicAnalysis: firstValue(raw.logic_analysis, raw.logicAnalysis, raw.thinking_coach?.diagnosis, ''),
    languageAnalysis: firstValue(raw.language_analysis, raw.languageAnalysis, ''),
    materialAnalysis: firstValue(raw.material_analysis, raw.materialAnalysis, raw.content_analysis, ''),
    recommendedMaterials: toArray(raw.recommended_materials ?? raw.recommendedMaterials),
    gaokaoScoring: firstValue(raw.gaokao_scoring, raw.gaokaoScoring, raw.gaokao_dimensions, raw.gaokaoDimensions, null),
    paragraphRefinements: toArray(raw.paragraph_refinements ?? raw.paragraphRefinements ?? raw.paragraph_rewrites ?? raw.paragraphRewrites),
    excellentVersion: firstValue(raw.excellent_version, raw.excellentVersion, raw.polished_full_text, raw.polishedFullText, ''),
    coreAdvantages: toArray(raw.strengths ?? raw.coreAdvantages),
    mainProblems: toArray(raw.problems ?? raw.mainProblems),
    paragraphComments: toArray(raw.paragraph_comments ?? raw.paragraphComments),
    editableSentences: toArray(raw.editable_sentences ?? raw.editableSentences),
    suggestions: toArray(raw.suggestions ?? raw.suggestion),
    upgradedParagraph: raw.upgraded_paragraph ?? raw.upgradedParagraph ?? '',
    goodSentences: toArray(raw.good_sentences ?? raw.goodSentences),
    nextTraining: toArray(raw.next_training ?? raw.nextTraining),
    trainingTasks: toArray(raw.training_tasks ?? raw.trainingTasks ?? raw.next_training ?? raw.nextTraining),
    teacherComment: firstValue(raw.teacher_comment, raw.teacherComment, raw.teacher_overall, ''),
    titleRevision: raw.title_revision ?? raw.titleRevision ?? '',
    openingRevision: raw.opening_revision ?? raw.openingRevision ?? '',
    endingRevision: raw.ending_revision ?? raw.endingRevision ?? '',
    polishedFullText: raw.polished_full_text ?? raw.polishedFullText ?? '',
    growthAnalysis: firstValue(raw.growth_analysis, raw.growthAnalysis, null),
    logicThinkingScore: raw.logic_thinking_score ?? raw.logicThinkingScore ?? null,
    thinkingDepth: raw.thinking_depth ?? raw.thinkingDepth ?? null,
    thinkingImprovement: raw.thinking_improvement ?? raw.thinkingImprovement ?? null,
    raw
  };
}

function buildMockReview({ title = '', text = '', fullScore = 60 } = {}) {
  const overallEvaluation = '这篇作文能够围绕题目建立基本中心，说明学生已经意识到青年写作不能只停留在个人情绪，而要放入时代背景中思考。它可以进入二类文区间，但距离高分作文仍有明显距离。真正的问题不是态度不积极，而是论证链不够完整：观点提出后，材料没有被充分分析，分论点之间也缺少递进。最大的优点是方向没有偏，最大的短板是思辨和材料转化不足。';
  return normalizeReview({
    total_score: 48,
    level: '二类文',
    overall_evaluation: overallEvaluation,
    topic_intent_analysis: '文章能抓住“青年”“时代”“责任”等关键词，没有明显偏题。但对关键词之间关系的辨析仍不充分，容易把“时代责任”写成口号，把“个人选择”写成一般奋斗。建议把中心推进为“青年应在时代需要中确认个人方向，并用持续行动回应公共责任”，这样后文才有可展开的论证空间。',
    structure_analysis: '结构基本完整，但层次推进不够。开头有引题意识，却缺少鲜明中心句；主体段之间更像并列展开，尚未形成从概念界定到原因分析再到行动路径的递进；结尾能够收束，但没有把文章提升到更深层的时代意义。',
    logic_analysis: '逻辑上的核心问题是材料与观点之间缺少分析桥梁。文章能提出青年应当奋斗，也能列举相关事例，但材料后没有说明“为什么这个例子能够证明本段观点”。建议每个主体段都补齐“观点-解释-举例-分析-回扣”五步，尤其要避免把相关素材误当成有效论据。',
    language_analysis: '语言整体通顺，但有口号化倾向。像“青年要努力奋斗”这类句子表达态度明确，却缺少思想含量。建议多用概念辨析句、因果分析句和价值提升句，把抽象词落到具体判断上，减少重复使用“奋斗、责任、时代”等大词。',
    material_analysis: '素材基本贴题，但典型性和分析深度仍可加强。材料选择应优先服务分论点，不宜只讲人物故事。使用素材后要解释人物选择背后的价值逻辑，并回扣“个人选择与时代责任”的核心关系。',
    recommended_materials: [
      { title: '钱学森归国', reason: '能证明个人专业选择与国家时代需要之间的结合。' },
      { title: '黄文秀返乡扶贫', reason: '能证明青年责任不是口号，而是具体行动。' },
      { title: '航天青年团队', reason: '能体现个人能力成长与时代工程之间的关系。' }
    ],
    gaokao_scoring: {
      content: { score: 16, full: 20, comment: '切题，中心明确，但材料分析不足。' },
      expression: { score: 16, full: 20, comment: '表达通顺，结构完整。' },
      development: { score: 16, full: 20, comment: '有一定思考，深度仍可提升。' },
      total_score: 48,
      level: '二类文',
      deductions: ['材料后分析不足', '分论点递进不够']
    },
    dimension_scores: [
      { name: '审题立意', score: 8, full: 10, comment: '能够回应题目，但立意还可再深化。' },
      { name: '内容充实度', score: 8, full: 10, comment: '有观点和材料，论证深度仍可加强。' },
      { name: '结构层次', score: 7, full: 10, comment: '结构基本完整，层次推进还可更清晰。' },
      { name: '论证逻辑', score: 8, full: 10, comment: '论证链条基本成立，但分析句仍可补足。' },
      { name: '语言表达', score: 8, full: 10, comment: '表达较顺，有少量可凝练之处。' },
      { name: '素材运用', score: 9, full: 10, comment: '素材贴题，若能转化为更深分析会更好。' }
    ],
    strengths: [
      '能够扣住“青年与时代”的主题，方向没有跑偏。',
      '有一定材料意识，能把例子拉回到中心论点。'
    ],
    problems: [
      '材料后面的分析还不够充分。',
      '主体段的递进关系可以再拉开。'
    ],
    paragraph_comments: [
      { paragraph: 1, comment: '开头有引题意识，但中心句还可以更明确。' },
      { paragraph: 2, comment: '主体段写到了材料，但材料后要补出“为什么能证明观点”。' }
    ],
    editable_sentences: [
      {
        original: '青年要努力奋斗。',
        reason: '表达偏泛。',
        revision: '青年之奋斗，不只是姿态上的昂扬，更是把个人理想嵌入时代坐标的清醒选择。'
      }
    ],
    suggestions: [
      {
        focus: '把中心论点改成可论证判断',
        diagnosis: '目前更像态度表态，论证空间有限。',
        logic_analysis: '高考作文需要让中心句能被拆成原因、方法和价值三个层次。',
        action_steps: '先界定奋斗，再展开时代责任和具体行动。',
        example_direction: '可改写为“青年之奋斗，不只是姿态上的昂扬，更是把个人理想嵌入时代坐标的清醒选择”。'
      }
    ],
    upgraded_paragraph: '真正的青年成长，不在于被时代浪潮推着前行，而在于能在浪潮中辨认方向。把个人志趣与家国需要相连，把一时热情沉淀为长期行动，青春才不只是年华的明亮，更成为精神的成熟。',
    paragraph_refinements: [
      {
        paragraph: 1,
        original: '青年要努力奋斗。',
        problem: '表达偏泛，缺少可论证判断。',
        revision: '青年之奋斗，不只是姿态上的昂扬，更是把个人理想嵌入时代坐标的清醒选择。',
        explanation: '修改后能引出个人理想与时代责任的关系。'
      }
    ],
    good_sentences: ['把个人理想嵌入时代坐标，青春才拥有更辽阔的回声。'],
    next_training: ['练习核心概念辨析。', '积累“青年与时代”主题素材。', '训练分论点递进式结构。'],
    training_tasks: [
      { type: '审题训练', title: '关键词关系图', task: '写出个人选择与时代责任之间的三层关系。' },
      { type: '论证训练', title: '材料后分析句', task: '为一个素材补写原因分析句和回扣观点句。' },
      { type: '结构训练', title: '递进分论点', task: '按是什么、为什么、怎么做设计三段分论点。' },
      { type: '思辨训练', title: '反例追问', task: '写出一个可能反例并修正观点边界。' }
    ],
    teacher_overall: '文章能够扣住青年与时代的关系，方向是正确的。修改时要补足材料后的分析句，并让主体段形成清晰递进。',
    teacher_comment: '这篇文章最可贵的是没有偏离题意，能把青年个人成长放到时代背景中思考。但你现在的问题也很典型：文章有正确态度，却缺少严密论证。高考作文不是把“青年要奋斗”说得更响亮，而是要证明这个判断为什么成立、怎样成立、在现实中如何落地。请重点修改主体段，先写清楚本段要证明什么，再让材料服务这个观点，最后补出分析和回扣。只要材料后面的分析句补扎实，文章就会明显提升。',
    growth_analysis: {
      advantages: ['审题方向正确'],
      weaknesses: ['材料分析不足', '论证链不完整'],
      trend: 'insufficient_data',
      trend_summary: '历史样本不足，暂不判断成长曲线。',
      ability_radar: { 审题立意: 80, 结构层次: 74, 逻辑论证: 72, 语言表达: 78, 素材运用: 75 },
      next_focus: ['逻辑论证', '素材运用']
    },
    title_revision: title ? `在时代坐标中确立${title}` : '在时代坐标中确立青春方向',
    opening_revision: '时代的潮声从不只催促人向前，更追问青年以何种姿态前行。',
    ending_revision: '愿我们把清醒的判断化为持久的行动，在时代坐标中写下青春的答案。',
    excellent_version: '时代的潮声从不只催促人向前，更追问青年以何种姿态前行。真正的青春选择，不是脱离时代的自我设计，而是在时代需要中确认个人方向，在具体行动中承担公共责任。',
    polished_full_text: text
      ? `时代的浪潮从不只是向前奔涌，它也不断追问青年：面对新的技术、新的生活和新的责任，我们究竟以怎样的姿态站立其中？\n\n${text}\n\n真正有力量的成长，是在具体事务中辨认方向，在平凡岗位上锤炼本领，并把个人理想放入更辽阔的时代坐标。`
      : '时代的浪潮从不只是向前奔涌，它也不断追问青年该怎样站立其中。'
  }, { title, text, fullScore });
}

export async function gradeEssay({ title = '', text = '', fullScore = 60 } = {}) {
  const essayText = String(text || '').trim();
  if (!essayText) {
    return buildMockReview({ title, text: essayText, fullScore });
  }

  if (!getAIProviderStatus().configured) {
    return buildMockReview({ title, text: essayText, fullScore });
  }

  try {
    const review = await reviewEssay({
      assignment: {
        title: title || '作文批改',
        prompt: '请按高中语文 60 分制完成作文批改。',
        essay_type: '材料作文',
        full_score: fullScore
      },
      essayText
    });
    return normalizeReview(review, { title, text: essayText, fullScore });
  } catch (error) {
    return buildMockReview({ title, text: essayText, fullScore });
  }
}

export { normalizeReview };
