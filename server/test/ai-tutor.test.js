import test from 'node:test';
import assert from 'node:assert/strict';

function createResponse({ ok = true, status = 200, jsonData = {}, textData = '' } = {}) {
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

test('upgradeEssay repairs literal newlines in JSON strings and requests enough output tokens', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_PRIMARY_PROVIDER: process.env.AI_PRIMARY_PROVIDER,
    AI_FALLBACK_ENABLED: process.env.AI_FALLBACK_ENABLED,
    AI_ROUTE_DEEP_REVISION: process.env.AI_ROUTE_DEEP_REVISION,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL
  };
  const bodies = [];

  process.env.NODE_ENV = 'production';
  process.env.AI_PROVIDER = 'deepseek';
  process.env.AI_PRIMARY_PROVIDER = 'deepseek';
  process.env.AI_FALLBACK_ENABLED = 'false';
  process.env.AI_ROUTE_DEEP_REVISION = 'deepseek';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  process.env.DEEPSEEK_MODEL = 'deepseek-chat';
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/chat/completions';

  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return createResponse({
      jsonData: {
        choices: [{
          message: {
            content: `{
  "original_score": 42,
  "upgraded_score": 55,
  "upgraded_text": "青年应在时代中定位自我。
唯有把个人选择放入时代责任，成长才有真实方向。",
  "change_summary": "强化时代责任与个人选择的关系",
  "paragraph_changes": [],
  "key_improvements": ["立意更集中"],
  "retained_strengths": ["观点明确"]
}`
          }
        }]
      }
    });
  };

  try {
    const mod = await import(`../src/services/ai-tutor.js?upgradeRepair=${Date.now()}`);
    const result = await mod.upgradeEssay({
      originalText: '青年应处理好个人选择与时代责任。',
      originalScore: 42
    });

    assert.equal(result.upgraded_score, 55);
    assert.match(result.upgraded_text, /时代责任/);
    assert.ok(bodies[0].max_tokens >= 4000);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
