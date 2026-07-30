import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { canonicalizeGradingResult, validateCompleteGradingResult } from '../src/services/essay-grading/review-history.js';
import { fileURLToPath } from 'node:url';
import gradingNormalizer from '../../../Chinese-Teacher-AI-Workspace/shared/essay-grading/normalize-grading-result.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const essayRoute = fs.readFileSync(path.join(root, 'server/src/routes/essays.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'client/src/main.jsx'), 'utf8');
const { normalizeGradingResult } = gradingNormalizer;

test('legacy React and essay API consume the canonical shared grading result', () => {
  assert.match(essayRoute, /normalizeGradingResult/);
  assert.match(essayRoute, /normalizedGradingResult/);
  assert.match(client, /function EssayGradingDetail/);
  assert.match(client, /renderGradingResult/);
  assert.match(client, /normalizedGradingResult/);
});

test('only a structurally complete review may be persisted as graded', () => {
  assert.throws(() => validateCompleteGradingResult({ total_score: 50, overall_evaluation: '只有摘要' }), /不完整/);
  assert.doesNotThrow(() => validateCompleteGradingResult({
    totalScore: 50,
    grade: '二类文',
    dimensionScores: [{ name: '审题', score: 8 }],
    thesisAnalysis: '审题',
    contentAnalysis: '内容',
    structureAnalysis: '结构',
    languageAnalysis: '语言',
    materialAnalysis: '素材',
    strengths: ['立意准确'],
    typoAnalysis: ['无'],
    sentenceIssues: ['无'],
    revisionSuggestions: ['修改'],
    socraticQuestions: ['为什么这样写？'],
    upgradedEssay: '完整升格作文',
    summary: '完整总评',
    reportMetadata: { model: 'deepseek-chat', gradingVersion: 'p1.5' }
  }));
});

test('grading normalization exposes canonical aliases for weak spots and socratic questions', () => {
  const normalized = normalizeGradingResult({
    total_score: 52,
    level: '二类文',
    dimension_scores: [{ name: '审题', score: 9 }],
    topic_intent_analysis: '审题立意清晰',
    content_analysis: '内容分析扎实',
    structure_analysis: '结构层次清楚',
    language_analysis: '语言表达自然',
    material_analysis: '素材运用具体',
    strengths: ['立意准确'],
    problems: ['论证链还可再紧一点'],
    thinking_coach: {
      diagnosis: '论证链偏弱',
      questions: ['为什么这个材料能证明观点？', '材料后面还缺哪一句分析？']
    },
    suggestions: [{ focus: '补足分析', action_steps: '材料后补解释' }],
    editable_sentences: [{ original: '青年要奋斗。', problem: '口号化', revised: '青年之奋斗应落到时代坐标中' }],
    typos: [{ original: '错字', corrected: '正字' }],
    polished_full_text: '完整升格作文',
    teacher_overall: '总评',
    metadata: { model: 'deepseek-chat', gradingVersion: 'p1.5', generatedAt: '2026-07-23T09:00:00.000Z' }
  });

  assert.equal(normalized.weakSpots.includes('论证链还可再紧一点'), true);
  assert.deepEqual(normalized.socraticQuestions, ['为什么这个材料能证明观点？', '材料后面还缺哪一句分析？']);
  assert.equal(normalized.revisionSuggestions.length > 0, true);
  assert.equal(normalized.typoAnalysis.length > 0, true);
  assert.equal(normalized.sentenceIssues.length > 0, true);
  assert.equal(normalized.reportMetadata.model, 'deepseek-chat');
});

test('grading normalization extracts readable summary text from object-like payloads', () => {
  const normalized = canonicalizeGradingResult({
    totalScore: 52,
    grade: '二类文',
    dimensionScores: [{ name: '审题', score: 9 }],
    thesisAnalysis: '审题立意清晰',
    contentAnalysis: '内容分析扎实',
    structureAnalysis: '结构层次清楚',
    languageAnalysis: '语言表达自然',
    materialAnalysis: '素材运用具体',
    strengths: ['立意准确'],
    weakSpots: ['论证链还可再紧一点'],
    sentenceIssues: ['病句'],
    revisionSuggestions: ['补足分析'],
    socraticQuestions: ['为什么这样写？'],
    upgradedEssay: '完整升格作文',
    summary: { overallComment: '总评：条理清楚，仍需加强论证。' },
    reportMetadata: { model: 'deepseek-chat', gradingVersion: 'p1.5' }
  });

  assert.equal(normalized.summary.includes('[object Object]'), false);
  assert.match(normalized.summary, /总评/);
});

test('analysis block aliases are normalized into canonical grading fields', () => {
  const normalized = canonicalizeGradingResult({
    analysis: {
      totalScore: 53,
      grade: '二类文',
      summary: '总体评价：方向正确，仍需加强论证。',
      topicAnalysis: '审题立意清晰',
      contentAnalysis: '内容分析扎实',
      structureAnalysis: '结构层次清楚',
      languageAnalysis: '语言表达自然',
      materialAnalysis: '素材运用具体',
      strengths: ['立意准确'],
      weaknesses: ['论证链还可再紧一点'],
      revisionSuggestions: ['补足分析'],
      upgradedEssay: '完整升格作文',
      reportMetadata: { model: 'deepseek-chat', gradingVersion: 'p1.5' }
    }
  });

  assert.equal(normalized.totalScore, 53);
  assert.equal(normalized.grade, '二类文');
  assert.equal(normalized.summary.includes('总体评价'), true);
  assert.equal(normalized.topicAnalysis, '审题立意清晰');
  assert.equal(normalized.contentAnalysis, '内容分析扎实');
  assert.equal(normalized.structureAnalysis, '结构层次清楚');
  assert.equal(normalized.languageAnalysis, '语言表达自然');
  assert.equal(normalized.materialAnalysis, '素材运用具体');
  assert.equal(normalized.analysis.summary.includes('总体评价'), true);
  assert.doesNotThrow(() => validateCompleteGradingResult(normalized));
});

test('repairable grading gaps do not become a hard 502 when core fields are present', () => {
  const review = {
    totalScore: 52,
    grade: '二类文',
    dimensionScores: [{ name: '审题', score: 9 }],
    thesisAnalysis: '审题立意清晰',
    contentAnalysis: '内容分析扎实',
    structureAnalysis: '结构层次清楚',
    languageAnalysis: '语言表达自然',
    materialAnalysis: '素材运用具体',
    strengths: ['立意准确'],
    typoAnalysis: ['错字'],
    sentenceIssues: ['病句'],
    revisionSuggestions: ['补足分析'],
    upgradedEssay: '完整升格作文',
    summary: '总评',
    reportMetadata: { model: 'deepseek-chat', gradingVersion: 'p1.5' }
  };

  assert.doesNotThrow(() => validateCompleteGradingResult(review));
});

test('alias-only grading payloads map into canonical core fields before validation', () => {
  const normalized = canonicalizeGradingResult({
    score: 52,
    dimensions: [{ name: '审题', score: 9 }],
    advantages: ['立意准确'],
    issues: ['论证链还可再紧一点'],
    advice: ['补足分析'],
    revisedEssay: '完整升格作文'
  });

  assert.equal(normalized.score, 52);
  assert.equal(normalized.totalScore, 52);
  assert.deepEqual(normalized.strengths, ['立意准确']);
  assert.deepEqual(normalized.weakSpots, ['论证链还可再紧一点']);
  assert.deepEqual(normalized.revisionSuggestions, ['补足分析']);
  assert.equal(normalized.upgradedEssay, '完整升格作文');
  assert.doesNotThrow(() => validateCompleteGradingResult(normalized));
});

test('recommended grading fields default cleanly when only required fields are present', () => {
  const normalized = canonicalizeGradingResult({
    score: { total: 51, level: '二类文' },
    revisedEssay: '重写后的作文'
  });

  assert.equal(normalized.totalScore, 51);
  assert.equal(normalized.score.total, 51);
  assert.equal(normalized.revisedEssay, '重写后的作文');
  assert.deepEqual(normalized.strengths, []);
  assert.deepEqual(normalized.problems, []);
  assert.deepEqual(normalized.revisionSuggestions, []);
  assert.deepEqual(normalized.dimensions, []);
  assert.equal(normalized.teacherComment, '');
  assert.doesNotThrow(() => validateCompleteGradingResult(normalized));
});

test('sentence-level revisions can synthesize revisedEssay when the full rewrite is missing', () => {
  const normalized = canonicalizeGradingResult({
    score: 48,
    grade: '三类文',
    essay: {
      text: '第一句需要改。第二句也需要改。'
    },
    sentenceIssues: [
      {
        original: '第一句需要改。',
        revision: '第一句已经修正。'
      },
      {
        original: '第二句也需要改。',
        revision: '第二句已经修正。'
      }
    ],
    strengths: ['结构清晰'],
    problems: ['主题偏离'],
    revisionSuggestions: ['补足责任分析']
  });

  assert.match(normalized.revisedEssay, /第一句已经修正。/);
  assert.match(normalized.revisedEssay, /第二句已经修正。/);
  assert.doesNotThrow(() => validateCompleteGradingResult(normalized));
});

test('summary-text-only grading payloads still fail when revisedEssay is missing', () => {
  const normalized = canonicalizeGradingResult({
    total_score: 40,
    level: '三类文',
    overall_evaluation: '本文整体方向正确。最大优点在于结构意识清晰，尝试用三步走逻辑推进。最大短板在于论证深度不足，材料分析流于浅层。修改建议：补足分析和结尾，重构中心论点。'
  });

  assert.ok(normalized.strengths.length > 0, 'expected strengths to be inferred');
  assert.ok(normalized.weakSpots.length > 0, 'expected weak spots to be inferred');
  assert.ok(normalized.revisionSuggestions.length > 0, 'expected revision suggestions to be inferred');
  assert.throws(() => validateCompleteGradingResult(normalized), /缺少revisedEssay/);
});
