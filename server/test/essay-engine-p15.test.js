import test from 'node:test';
import assert from 'node:assert/strict';

import { buildReviewPrompt } from '../src/services/prompt.js';
import { generateArchiveMarkdown } from '../src/services/archive-pipeline.js';
import { renderReportHtml } from '../src/services/file-access.js';
import { completeLegacyReviewFields } from '../src/services/openai.js';
import { normalizeReview } from '../../apps/essay-ai/src/gradingService.js';
import { buildEssayReportMarkdown } from '../../apps/essay-ai/src/reportService.js';

function p15RawReview() {
  return {
    total_score: 50,
    level: '二类文上',
    overall_evaluation: '总体评价'.repeat(80),
    topic_intent_analysis: '审题立意分析'.repeat(90),
    structure_analysis: '结构分析'.repeat(110),
    logic_analysis: '逻辑分析'.repeat(130),
    language_analysis: '语言分析'.repeat(110),
    material_analysis: '素材分析'.repeat(80),
    recommended_materials: [
      { title: '钱学森归国', reason: '能证明个人选择与时代需要之间的双向成就。' },
      { title: '黄文秀返乡', reason: '能证明青年选择不是口号，而是具体责任。' },
      { title: '航天青年团队', reason: '能证明群体奋斗与时代工程之间的关系。' }
    ],
    gaokao_scoring: {
      content: { score: 17, full: 20, comment: '内容切题。' },
      expression: { score: 16, full: 20, comment: '表达较稳。' },
      development: { score: 17, full: 20, comment: '发展等级较好。' },
      total_score: 50,
      level: '二类文上',
      deductions: ['材料分析不足']
    },
    paragraph_refinements: [
      {
        paragraph: 1,
        original: '青年要奋斗。',
        problem: '观点偏口号。',
        revision: '青年之奋斗，应是在时代坐标中辨认个人选择的责任方向。',
        explanation: '修改后把态度表述推进为可论证判断。',
        sentence_edits: [{ original: '青年要奋斗。', revision: '青年应在时代坐标中选择。', reason: '更具体。' }]
      }
    ],
    excellent_version: '可以直接誊写的优秀版本',
    teacher_comment: '教师评语'.repeat(120),
    training_tasks: [
      { type: '审题训练', title: '关键词圈画', task: '圈出材料关键词并写出关系。' },
      { type: '论证训练', title: '观点论据链', task: '补齐观点、材料、分析、回扣。' },
      { type: '素材训练', title: '素材替换', task: '用新素材替换旧素材。' },
      { type: '语言训练', title: '句式改写', task: '改写口号化句子。' }
    ],
    growth_analysis: {
      advantages: ['立意方向较准'],
      weaknesses: ['论证链不够完整'],
      trend: 'stable',
      trend_summary: '本次保持稳定，逻辑分析仍是主要增长点。',
      ability_radar: { 审题立意: 82, 结构层次: 76, 逻辑论证: 72, 语言表达: 78, 素材运用: 75 },
      next_focus: ['逻辑论证', '素材运用']
    },
    strengths: ['观点明确'],
    problems: ['论证展开不足'],
    suggestions: [{ focus: '补足论证链', diagnosis: '材料后缺分析。' }],
    next_training: ['因果分析训练']
  };
}

test('P1.5 prompt requires expert teacher identities, deep sections and JSON contract', () => {
  const prompt = buildReviewPrompt({
    assignment: { title: '青年责任', prompt: '请谈个人选择与时代责任。', essay_type: '材料作文', full_score: 60 },
    essayText: '青年应当承担时代责任。',
    fullScore: 60
  });

  assert.match(prompt, /高中重点中学语文教师/);
  assert.match(prompt, /真实阅卷专家/);
  assert.match(prompt, /真实作文指导老师/);
  assert.match(prompt, /总体评价[\s\S]*不少于300字/);
  assert.match(prompt, /审题立意[\s\S]*不少于500字/);
  assert.match(prompt, /结构分析[\s\S]*不少于500字/);
  assert.match(prompt, /逻辑分析[\s\S]*不少于600字/);
  assert.match(prompt, /语言分析[\s\S]*不少于500字/);
  for (const field of [
    'overall_evaluation',
    'topic_intent_analysis',
    'structure_analysis',
    'logic_analysis',
    'language_analysis',
    'material_analysis',
    'recommended_materials',
    'gaokao_scoring',
    'paragraph_refinements',
    'excellent_version',
    'teacher_comment',
    'training_tasks',
    'growth_analysis'
  ]) {
    assert.match(prompt, new RegExp(`"${field}"`), `${field} must be in prompt contract`);
  }
});

test('P1.5 normalization keeps deep analysis fields while preserving legacy names', () => {
  const normalized = normalizeReview(p15RawReview(), { title: '青年责任', text: '青年应当承担时代责任。', fullScore: 60 });

  assert.equal(normalized.overallEvaluation.startsWith('总体评价'), true);
  assert.equal(normalized.topicIntentAnalysis.startsWith('审题立意分析'), true);
  assert.equal(normalized.structureAnalysis.startsWith('结构分析'), true);
  assert.equal(normalized.logicAnalysis.startsWith('逻辑分析'), true);
  assert.equal(normalized.languageAnalysis.startsWith('语言分析'), true);
  assert.equal(normalized.materialAnalysis.startsWith('素材分析'), true);
  assert.equal(normalized.recommendedMaterials.length, 3);
  assert.equal(normalized.gaokaoScoring.total_score, 50);
  assert.equal(normalized.paragraphRefinements.length, 1);
  assert.equal(normalized.excellentVersion, '可以直接誊写的优秀版本');
  assert.equal(normalized.teacherComment.startsWith('教师评语'), true);
  assert.equal(normalized.trainingTasks.length, 4);
  assert.equal(normalized.growthAnalysis.trend, 'stable');
  assert.deepEqual(normalized.coreAdvantages, ['观点明确']);
  assert.deepEqual(normalized.mainProblems, ['论证展开不足']);
});

test('P1.5 Markdown and archive reports render all deep grading sections', () => {
  const result = normalizeReview(p15RawReview(), { title: '青年责任', text: '青年应当承担时代责任。', fullScore: 60 });
  const markdown = buildEssayReportMarkdown({ id: 'essay-1', title: '青年责任', source: 'test', status: 'completed', createdAt: '2026-07-13T00:00:00.000Z', result });
  for (const heading of ['总体评价', '审题立意', '结构分析', '逻辑分析', '语言分析', '素材分析', '高考评分', '逐段精修', '整篇升格文章', '教师评语', '训练任务', '成长分析']) {
    assert.match(markdown, new RegExp(`## ${heading}`));
  }

  const archiveMarkdown = generateArchiveMarkdown({
    essay: { original_text: '青年应当承担时代责任。' },
    metadata: { essayTitle: '青年责任', studentName: '许伟航', studentId: '20260301', className: '高二3班', score: 50, grade: '二类文上', provider: 'deepseek', model: 'deepseek-chat' },
    reportJson: p15RawReview(),
    ocrText: '青年应当承担时代责任。'
  });
  assert.match(archiveMarkdown, /## 总体评价/);
  assert.match(archiveMarkdown, /## 高考评分/);
  assert.match(archiveMarkdown, /## 逐段精修/);
  assert.match(archiveMarkdown, /## 成长分析/);
});

test('P1.5 signed public HTML report exposes deep sections without losing download actions', () => {
  const html = renderReportHtml({
    record: { essayTitle: '青年责任', studentName: '许伟航', className: '高二3班', score: 50, grade: '二类文上', provider: 'deepseek', model: 'deepseek-chat' },
    reportJson: p15RawReview(),
    links: { docxUrl: 'https://pi.zhenwanyue.icu/api/files/essay-1/docx?token=test', pdfUrl: 'https://pi.zhenwanyue.icu/api/files/essay-1/pdf?token=test', markdownUrl: 'https://pi.zhenwanyue.icu/api/files/essay-1/markdown?token=test' }
  });

  for (const heading of ['总体评价', '审题立意', '结构分析', '逻辑论证', '语言表达', '素材分析', '高考评分', '逐段精修', '整篇升格文章', '教师点评', '训练任务', '成长分析']) {
    assert.match(html, new RegExp(`<h2>${heading}</h2>`));
  }
  assert.match(html, /下载 Word/);
  assert.match(html, /下载 PDF/);
  assert.doesNotMatch(html, /webdav|192\.168|file:\/\//i);
});

test('P1.5 completion fills legacy strengths and next_training fields for old Feishu and database flows', () => {
  const completed = completeLegacyReviewFields({
    total_score: 50,
    level: '二类文上',
    overall_evaluation: '最大优点是审题方向较准，最大短板是论证链不够完整。',
    growth_analysis: {
      advantages: ['审题方向较准'],
      weaknesses: ['论证链不完整']
    },
    training_tasks: [
      { type: '论证训练', title: '补齐论证链', task: '为材料补写分析句。' }
    ]
  });

  assert.deepEqual(completed.strengths, ['审题方向较准']);
  assert.deepEqual(completed.problems, ['论证链不完整']);
  assert.equal(completed.next_training.length, 1);
  assert.equal(completed.next_training[0], '【论证训练】补齐论证链：为材料补写分析句。');
});
