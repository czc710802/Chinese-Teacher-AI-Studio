#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadServerEnv } from '../../server/src/config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
loadServerEnv({ appDir, nodeEnv: 'production' });
const { reviewEssay } = await import('../../server/src/services/openai.js');

const originalFetch = globalThis.fetch;
const calls = { openai: 0, deepseek: 0, other: 0 };
globalThis.fetch = async (url, init) => {
  const text = String(url);
  if (text.includes('api.openai.com')) calls.openai += 1;
  else if (text.includes('api.deepseek.com')) calls.deepseek += 1;
  else calls.other += 1;
  return originalFetch(url, init);
};

const review = await reviewEssay({
  assignment: {
    title: 'P0 DeepSeek 真实作文批改验收',
    prompt: '青年应当如何处理个人选择与时代责任之间的关系？请简要分析。',
    essay_type: '议论文',
    full_score: 60
  },
  essayText: '青年应当如何处理个人选择与时代责任之间的关系？请简要分析。'
});

const summary = {
  success: true,
  provider: review.ai_meta?.provider || '',
  model: review.ai_meta?.model || '',
  fallbackUsed: Boolean(review.ai_meta?.fallbackUsed),
  openaiCalls: calls.openai,
  deepseekCalls: calls.deepseek,
  hasScore: typeof review.total_score === 'number',
  hasLevel: Boolean(review.level),
  hasStrengths: Array.isArray(review.strengths) && review.strengths.length > 0,
  hasProblems: Array.isArray(review.problems) && review.problems.length > 0,
  hasSuggestions: Array.isArray(review.suggestions) && review.suggestions.length > 0,
  hasNextTraining: Array.isArray(review.next_training) && review.next_training.length > 0,
  mockDetected: !review.ai_meta?.provider
};

console.log(JSON.stringify(summary, null, 2));

if (summary.provider !== 'deepseek') process.exit(1);
if (summary.openaiCalls !== 0) process.exit(1);
if (!summary.deepseekCalls) process.exit(1);
if (!summary.hasScore || !summary.hasLevel || !summary.hasStrengths || !summary.hasProblems || !summary.hasSuggestions || !summary.hasNextTraining) process.exit(1);
if (summary.mockDetected) process.exit(1);
