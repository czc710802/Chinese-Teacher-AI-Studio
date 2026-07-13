import test from 'node:test';
import assert from 'node:assert/strict';

function createResponse({ ok, status, jsonData = {}, textData = '' }) {
  return {
    ok,
    status,
    async json() {
      return jsonData;
    },
    async text() {
      return textData;
    }
  };
}

test('DeepSeek authentication failure falls back to OpenAI once', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
    AI_ROUTE_GENERAL: process.env.AI_ROUTE_GENERAL
  };
  const calls = [];

  process.env.AI_PROVIDER = 'deepseek';
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  process.env.OPENAI_MODEL = 'openai-test-model';
  process.env.DEEPSEEK_MODEL = 'deepseek-chat';
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/chat/completions';
  process.env.AI_ROUTE_GENERAL = 'deepseek';

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('deepseek')) {
      return createResponse({
        ok: false,
        status: 401,
        textData: JSON.stringify({ error: { message: 'Authentication Fails, Your api key is invalid', type: 'authentication_error' } })
      });
    }
    return createResponse({
      ok: true,
      status: 200,
      jsonData: { output_text: 'openai ok' }
    });
  };

  try {
    const mod = await import(`../src/services/openai.js?fallback=${Date.now()}`);
    const text = await mod.callTextModel('你好，世界');
    assert.equal(text, 'openai ok');
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /deepseek/);
    assert.match(calls[1].url, /openai/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('reviewEssay does not mark production grading successful when provider authentication fails', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
    AI_ROUTE_ESSAY_GRADING: process.env.AI_ROUTE_ESSAY_GRADING,
    NODE_ENV: process.env.NODE_ENV
  };
  const calls = [];

  process.env.AI_PROVIDER = 'deepseek';
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  process.env.OPENAI_MODEL = 'openai-test-model';
  process.env.DEEPSEEK_MODEL = 'deepseek-chat';
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/chat/completions';
  process.env.AI_ROUTE_ESSAY_GRADING = 'deepseek';
  process.env.NODE_ENV = 'production';

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('deepseek')) {
      return createResponse({
        ok: false,
        status: 401,
        textData: JSON.stringify({ error: { message: 'Authentication Fails, Your api key is invalid', type: 'authentication_error' } })
      });
    }
    return createResponse({
      ok: false,
      status: 401,
      textData: JSON.stringify({ error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } })
    });
  };

  try {
    const mod = await import(`../src/services/openai.js?fallbackAll=${Date.now()}`);
    await assert.rejects(() => mod.reviewEssay({
      assignment: { title: '出发与到达', full_score: 60 },
      essayText: '青年应在时代中寻找自己的位置。'
    }), /鉴权失败|Authentication|invalid/i);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('parseAIJsonObject repairs literal newlines inside JSON strings', async () => {
  const mod = await import(`../src/services/openai.js?parseRepair=${Date.now()}`);
  const parsed = mod.parseAIJsonObject(`\`\`\`json
{
  "total_score": 42,
  "level": "三类文",
  "problems": ["全文仅两句话，字数严重不足，未达到
完整议论文要求"],
  "strengths": ["能回应题目"],
  "suggestions": ["扩展论证"],
  "next_training": ["补充材料"]
}
\`\`\``);

  assert.equal(parsed.total_score, 42);
  assert.equal(parsed.problems[0].includes('完整议论文要求'), true);
});

test('reviewEssay uses enough output tokens for structured grading JSON', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_PRIMARY_PROVIDER: process.env.AI_PRIMARY_PROVIDER,
    AI_FALLBACK_ENABLED: process.env.AI_FALLBACK_ENABLED,
    AI_ROUTE_ESSAY_GRADING: process.env.AI_ROUTE_ESSAY_GRADING,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
    NODE_ENV: process.env.NODE_ENV
  };
  const bodies = [];

  process.env.NODE_ENV = 'production';
  process.env.AI_PROVIDER = 'deepseek';
  process.env.AI_PRIMARY_PROVIDER = 'deepseek';
  process.env.AI_FALLBACK_ENABLED = 'false';
  process.env.AI_ROUTE_ESSAY_GRADING = 'deepseek';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  process.env.DEEPSEEK_MODEL = 'deepseek-chat';
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/chat/completions';

  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return createResponse({
      ok: true,
      status: 200,
      jsonData: {
        choices: [{
          message: {
            content: JSON.stringify({
              total_score: 42,
              level: '三类文',
              dimension_scores: [],
              strengths: ['能回应题目'],
              problems: ['论证不足'],
              paragraph_comments: [],
              editable_sentences: [],
              suggestions: ['补充材料'],
              upgraded_paragraph: '',
              good_sentences: [],
              next_training: ['扩展论证']
            })
          }
        }]
      }
    });
  };

  try {
    const mod = await import(`../src/services/openai.js?maxTokens=${Date.now()}`);
    const review = await mod.reviewEssay({
      assignment: { title: '测试', full_score: 60 },
      essayText: '青年应承担时代责任。'
    });
    assert.equal(review.ai_meta.provider, 'deepseek');
    assert.ok(bodies[0].max_tokens >= 4000);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
