import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = fs.readFileSync(path.join(root, '../Chinese-Teacher-AI-Workspace/shared/essay-grading/grading-result-renderer.js'), 'utf8');

test('shared grading result renderer boots in a browser-like sandbox without require', () => {
  const sandbox = {
    console,
    module: undefined,
    require: undefined,
    globalThis: null,
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(source, sandbox, { filename: 'grading-result-renderer.js' });

  assert.equal(typeof sandbox.EssayGrading?.renderGradingResult, 'function');
  const html = sandbox.EssayGrading.renderGradingResult({
    totalScore: 48,
    fullScore: 60,
    level: '二类文',
    summary: '综合评价',
    dimensionScores: [{ name: '审题立意', score: 8, full: 10, comment: '准确' }],
    socraticQuestions: ['这部分为什么这样写？'],
    upgradedEssay: '升格作文',
  }, {
    essay: { title: '周练', assignmentTitle: '周练', gradingStatus: 'graded', submittedAt: '2026-07-24', originalText: '原文' },
    images: [],
    interactions: [],
    role: 'student',
    submissionId: 86,
  });

  assert.match(html, /作文基本信息/);
  assert.match(html, /批改状态：批改完成/);
  assert.match(html, /48\/60/);
});
