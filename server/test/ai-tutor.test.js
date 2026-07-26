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

test('tutorChat frames the conversation as a teacher-led writing exchange', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_PRIMARY_PROVIDER: process.env.AI_PRIMARY_PROVIDER,
    AI_FALLBACK_ENABLED: process.env.AI_FALLBACK_ENABLED,
    AI_ROUTE_GENERAL: process.env.AI_ROUTE_GENERAL,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL
  };
  const bodies = [];

  process.env.NODE_ENV = 'production';
  process.env.AI_PROVIDER = 'deepseek';
  process.env.AI_PRIMARY_PROVIDER = 'deepseek';
  process.env.AI_FALLBACK_ENABLED = 'false';
  process.env.AI_ROUTE_GENERAL = 'deepseek';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  process.env.DEEPSEEK_MODEL = 'deepseek-chat';
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/chat/completions';

  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return createResponse({
      jsonData: {
        choices: [{
          message: {
            content: '{"answer":"陈老师会继续引导你修改。"}'
          }
        }]
      }
    });
  };

  try {
    const mod = await import(`../src/services/ai-tutor.js?tutorPrompt=${Date.now()}`);
    const answer = await mod.tutorChat({
      essay: {
        assignment_title: '青春与时代同行',
        essay_type: '周练',
        original_text: '青年应把个人理想融入时代洪流。'
      },
      review: {
        total_score: 52,
        overallComment: '中心明确但论证略显单薄。',
        problems: ['论证链条偏弱'],
        suggestions: ['补充具体事例'],
        upgraded_text: '青年应把个人理想融入时代洪流，并在行动中回应时代召唤。'
      },
      studentQuestion: '我的中心思想应该如何深化？',
      history: [{ role: 'student', message: '我该怎么改？' }]
    });

    assert.match(answer, /陈老师会继续引导/);
    assert.ok(bodies[0].messages[0].content.includes('高中语文作文指导教师'));
    assert.ok(bodies[0].messages[0].content.includes('正在与学生进行作文修改后的互动交流'));
    assert.ok(bodies[0].messages[0].content.includes('避免直接代写整篇作文'));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tutorChat surfaces AI failures instead of fabricating a success reply', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_PRIMARY_PROVIDER: process.env.AI_PRIMARY_PROVIDER,
    AI_FALLBACK_ENABLED: process.env.AI_FALLBACK_ENABLED,
    AI_ROUTE_GENERAL: process.env.AI_ROUTE_GENERAL,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL
  };

  process.env.NODE_ENV = 'production';
  process.env.AI_PROVIDER = 'deepseek';
  process.env.AI_PRIMARY_PROVIDER = 'deepseek';
  process.env.AI_FALLBACK_ENABLED = 'false';
  process.env.AI_ROUTE_GENERAL = 'deepseek';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  process.env.DEEPSEEK_MODEL = 'deepseek-chat';
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/chat/completions';

  globalThis.fetch = async () => {
    throw new TypeError('Load failed');
  };

  try {
    const mod = await import(`../src/services/ai-tutor.js?fallbackTutor=${Date.now()}`);
    await assert.rejects(mod.tutorChat({
      essay: {
        assignment_title: '青春与时代同行',
        essay_type: '周练',
        original_text: '青年应把个人理想融入时代洪流。'
      },
      review: {
        total_score: 52,
        overallComment: '中心明确但论证略显单薄。',
        problems: ['论证链条偏弱'],
        suggestions: ['补充具体事例'],
        upgraded_text: '青年应把个人理想融入时代洪流，并在行动中回应时代召唤。'
      },
      studentQuestion: '我的中心思想应该如何深化？',
      history: []
    }), /Load failed|AI|超时|不可用/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tutorChat does not fall back to OpenAI when DeepSeek fails for student interaction', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_PRIMARY_PROVIDER: process.env.AI_PRIMARY_PROVIDER,
    AI_FALLBACK_ENABLED: process.env.AI_FALLBACK_ENABLED,
    AI_ROUTE_GENERAL: process.env.AI_ROUTE_GENERAL,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL
  };
  const calls = [];

  process.env.NODE_ENV = 'production';
  process.env.AI_PROVIDER = 'deepseek';
  process.env.AI_PRIMARY_PROVIDER = 'deepseek';
  process.env.AI_FALLBACK_ENABLED = 'true';
  process.env.AI_ROUTE_GENERAL = 'deepseek';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  process.env.DEEPSEEK_MODEL = 'deepseek-chat';
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/chat/completions';
  process.env.OPENAI_API_KEY = 'openai-test-key';
  process.env.OPENAI_MODEL = 'gpt-5.5';
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1/responses';

  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes('deepseek')) {
      throw new TypeError('fetch failed');
    }
    return createResponse({
      jsonData: {
        output_text: 'unexpected openai fallback'
      }
    });
  };

  try {
    const mod = await import(`../src/services/ai-tutor.js?noOpenaiFallback=${Date.now()}`);
    await assert.rejects(mod.tutorChat({
      essay: {
        assignment_title: '青春与时代同行',
        essay_type: '周练',
        original_text: '青年应把个人理想融入时代洪流。'
      },
      review: {
        total_score: 52,
        overallComment: '中心明确但论证略显单薄。',
        problems: ['论证链条偏弱'],
        suggestions: ['补充具体事例'],
        upgraded_text: '青年应把个人理想融入时代洪流，并在行动中回应时代召唤。'
      },
      studentQuestion: '高中生如何培养逻辑分析能力？',
      history: []
    }), /AI|超时|不可用|失败/);

    assert.equal(calls.length, 1);
    assert.match(calls[0], /deepseek/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tutorChat keeps different questions distinct in the AI prompt and response', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_PRIMARY_PROVIDER: process.env.AI_PRIMARY_PROVIDER,
    AI_FALLBACK_ENABLED: process.env.AI_FALLBACK_ENABLED,
    AI_ROUTE_GENERAL: process.env.AI_ROUTE_GENERAL,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL
  };
  const bodies = [];

  process.env.NODE_ENV = 'production';
  process.env.AI_PROVIDER = 'deepseek';
  process.env.AI_PRIMARY_PROVIDER = 'deepseek';
  process.env.AI_FALLBACK_ENABLED = 'false';
  process.env.AI_ROUTE_GENERAL = 'deepseek';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  process.env.DEEPSEEK_MODEL = 'deepseek-chat';
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/chat/completions';

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const promptText = JSON.stringify(body);
    const content = promptText.includes('论点、论据和逻辑链')
      ? '先梳理论点，再追问论据如何支撑它。'
      : promptText.includes('第二段存在的语言问题')
        ? '第二段的语言问题主要在概念重复、句式单薄、分析句不足。'
        : '你可以先设计三个由浅入深的苏格拉底追问。';
    return createResponse({
      jsonData: {
        choices: [{
          message: { content }
        }]
      }
    });
  };

  try {
    const mod = await import(`../src/services/ai-tutor.js?promptDistinct=${Date.now()}`);
    const essay = {
      assignment_title: '青春与时代同行',
      essay_type: '周练',
      original_text: '青年应把个人理想融入时代洪流。'
    };
    const review = {
      total_score: 52,
      overallComment: '中心明确但论证略显单薄。',
      problems: ['论证链条偏弱'],
      suggestions: ['补充具体事例'],
      upgraded_text: '青年应把个人理想融入时代洪流，并在行动中回应时代召唤。'
    };
    const a1 = await mod.tutorChat({ essay, review, studentQuestion: '帮我梳理这篇文章的论点、论据和逻辑链。', history: [], interactionRequestId: 'req-1' });
    const a2 = await mod.tutorChat({ essay, review, studentQuestion: '请只分析本文第二段存在的语言问题，并给出三条修改建议。', history: [], interactionRequestId: 'req-2' });
    const a3 = await mod.tutorChat({ essay, review, studentQuestion: '请根据这篇作文设计三个由浅入深的苏格拉底追问，不要直接替我重写。', history: [], interactionRequestId: 'req-3' });

    assert.notEqual(a1, a2);
    assert.notEqual(a2, a3);
    assert.notEqual(a1, a3);
    assert.equal(bodies.length, 3);
    assert.ok(bodies[0].messages[0].content.includes('帮我梳理这篇文章的论点、论据和逻辑链'));
    assert.ok(bodies[1].messages[0].content.includes('第二段存在的语言问题'));
    assert.ok(bodies[2].messages[0].content.includes('苏格拉底追问'));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tutorChat uses the supported DeepSeek flash model for quick feedback when only the legacy model is configured', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_PRIMARY_PROVIDER: process.env.AI_PRIMARY_PROVIDER,
    AI_FALLBACK_ENABLED: process.env.AI_FALLBACK_ENABLED,
    AI_ROUTE_GENERAL: process.env.AI_ROUTE_GENERAL,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    DEEPSEEK_FAST_MODEL: process.env.DEEPSEEK_FAST_MODEL,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL
  };
  const bodies = [];

  process.env.NODE_ENV = 'production';
  process.env.AI_PROVIDER = 'deepseek';
  process.env.AI_PRIMARY_PROVIDER = 'deepseek';
  process.env.AI_FALLBACK_ENABLED = 'false';
  process.env.AI_ROUTE_GENERAL = 'deepseek';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  process.env.DEEPSEEK_MODEL = 'deepseek-chat';
  delete process.env.DEEPSEEK_FAST_MODEL;
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/chat/completions';

  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return createResponse({
      jsonData: {
        choices: [{
          message: {
            content: '{"answer":"陈老师会继续引导你修改。"}'
          }
        }]
      }
    });
  };

  try {
    const mod = await import(`../src/services/ai-tutor.js?legacyDeepSeekFlash=${Date.now()}`);
    const answer = await mod.tutorChat({
      essay: {
        assignment_title: '青春与时代同行',
        essay_type: '周练',
        original_text: '青年应把个人理想融入时代洪流。'
      },
      review: {
        total_score: 52,
        overallComment: '中心明确但论证略显单薄。',
        problems: ['论证链条偏弱'],
        suggestions: ['补充具体事例'],
        upgraded_text: '青年应把个人理想融入时代洪流，并在行动中回应时代召唤。'
      },
      studentQuestion: '高中生如何培养逻辑分析能力？',
      history: [],
      interactionRequestId: 'req-legacy'
    });

    assert.match(answer, /陈老师会继续引导你修改/);
    assert.equal(bodies[0].model, 'deepseek-v4-flash');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('tutorChat rotates the response angle across repeated student turns', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    NODE_ENV: process.env.NODE_ENV,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_PRIMARY_PROVIDER: process.env.AI_PRIMARY_PROVIDER,
    AI_FALLBACK_ENABLED: process.env.AI_FALLBACK_ENABLED,
    AI_ROUTE_GENERAL: process.env.AI_ROUTE_GENERAL,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL
  };
  const prompts = [];

  process.env.NODE_ENV = 'production';
  process.env.AI_PROVIDER = 'deepseek';
  process.env.AI_PRIMARY_PROVIDER = 'deepseek';
  process.env.AI_FALLBACK_ENABLED = 'false';
  process.env.AI_ROUTE_GENERAL = 'deepseek';
  process.env.DEEPSEEK_API_KEY = 'deepseek-test-key';
  process.env.DEEPSEEK_MODEL = 'deepseek-chat';
  process.env.DEEPSEEK_BASE_URL = 'https://api.deepseek.com/chat/completions';

  globalThis.fetch = async (_url, init) => {
    prompts.push(JSON.parse(init.body).messages[0].content);
    return createResponse({
      jsonData: {
        choices: [{
          message: {
            content: '{"answer":"陈老师会继续引导你修改。"}'
          }
        }]
      }
    });
  };

  try {
    const mod = await import(`../src/services/ai-tutor.js?angleRotate=${Date.now()}`);
    const essay = {
      assignment_title: '青春与时代同行',
      essay_type: '周练',
      original_text: '青年应把个人理想融入时代洪流。'
    };
    const review = {
      total_score: 52,
      overallComment: '中心明确但论证略显单薄。',
      problems: ['论证链条偏弱'],
      suggestions: ['补充具体事例'],
      upgraded_text: '青年应把个人理想融入时代洪流，并在行动中回应时代召唤。'
    };

    await mod.tutorChat({ essay, review, studentQuestion: '我应该如何提高苏格拉底追问能力？', history: [], interactionRequestId: 'req-1' });
    await mod.tutorChat({
      essay,
      review,
      studentQuestion: '我应该如何提高苏格拉底追问能力？',
      history: [{ role: 'student', message: '我应该如何提高苏格拉底追问能力？' }, { role: 'ai', message: '陈老师会继续引导你修改。' }],
      interactionRequestId: 'req-2'
    });
    await mod.tutorChat({
      essay,
      review,
      studentQuestion: '我应该如何提高苏格拉底追问能力？',
      history: [
        { role: 'student', message: '我应该如何提高苏格拉底追问能力？' },
        { role: 'ai', message: '陈老师会继续引导你修改。' },
        { role: 'student', message: '我应该如何提高苏格拉底追问能力？' },
        { role: 'ai', message: '陈老师会继续引导你修改。' }
      ],
      interactionRequestId: 'req-3'
    });

    assert.match(prompts[0], /本轮回答切入角度】从概念拆解角度/);
    assert.match(prompts[1], /本轮回答切入角度】从提问步骤角度/);
    assert.match(prompts[2], /本轮回答切入角度】从常见误区角度/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('student interaction entry reads question via FormData and sends a request id', async () => {
  const fs = await import('node:fs');
  const publicEntry = fs.readFileSync('/Users/chenxiansheng/Desktop/workspace/Chinese-Teacher-AI-Workspace/Studio/public/entry.js', 'utf8');
  const sourceEntry = fs.readFileSync('/Users/chenxiansheng/Desktop/workspace/Chinese-Teacher-AI-Workspace/Studio/entry.js', 'utf8');

  for (const code of [publicEntry, sourceEntry]) {
    assert.match(code, /new FormData\(chatForm\)/);
    assert.match(code, /interactionRequestId/);
    assert.match(code, /elements\?\.namedItem\?\.\('question'\)/);
  }
});
