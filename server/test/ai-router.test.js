import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createApp } from '../src/app.js';
import { getAIConfig, validateProviderConfig } from '../src/config/ai-config.js';
import { createAIRouter } from '../src/services/ai/ai-router.js';

function response(status, body = '{}', headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[String(name).toLowerCase()] || null },
    async text() {
      return body;
    },
    async json() {
      return JSON.parse(body || '{}');
    }
  };
}

function env(overrides = {}) {
  return {
    NODE_ENV: 'test',
    AI_ROUTER_ENABLED: 'true',
    AI_PRIMARY_PROVIDER: 'openai',
    AI_FALLBACK_PROVIDER: 'deepseek',
    AI_FALLBACK_ENABLED: 'true',
    OPENAI_API_KEY: 'openai-test-key',
    OPENAI_MODEL: 'openai-grade',
    DEEPSEEK_API_KEY: 'deepseek-test-key',
    DEEPSEEK_MODEL: 'deepseek-chat',
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com/chat/completions',
    ...overrides
  };
}

async function invoke(app, { method = 'GET', url = '/', headers = {} } = {}) {
  return await new Promise((resolve, reject) => {
    const req = new Readable({ read() {} });
    req.method = method;
    req.url = url;
    req.headers = headers;
    req.socket = { remoteAddress: '127.0.0.1', encrypted: false, destroy() {} };
    req.connection = req.socket;
    process.nextTick(() => req.push(null));

    const res = {
      statusCode: 200,
      headers: {},
      chunks: [],
      setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
      getHeader(name) { return this.headers[String(name).toLowerCase()]; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.setHeader('content-type', 'application/json; charset=utf-8'); this.end(JSON.stringify(payload)); return this; },
      send(payload) { this.end(typeof payload === 'string' ? payload : JSON.stringify(payload)); return this; },
      write(chunk) { this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); },
      end(chunk) {
        if (chunk) this.write(chunk);
        resolve({ statusCode: this.statusCode, headers: this.headers, body: Buffer.concat(this.chunks).toString('utf8') });
      }
    };

    try {
      app.handle(req, res, (err) => err ? reject(err) : null);
    } catch (error) {
      reject(error);
    }
  });
}

test('AI config exposes routes and rejects unsafe key formats without leaking secrets', () => {
  const config = getAIConfig(env({
    OPENAI_API_KEY: '  "openai-test-key"  ',
    DEEPSEEK_API_KEY: 'Bearer bad',
    AI_ROUTE_QUICK_FEEDBACK: 'deepseek'
  }));

  assert.equal(config.primaryProvider, 'openai');
  assert.equal(config.fallbackProvider, 'deepseek');
  assert.equal(config.routes.essay_grading, 'openai');
  assert.equal(config.routes.quick_feedback, 'deepseek');
  assert.equal(validateProviderConfig('openai', config).ok, true);
  assert.equal(validateProviderConfig('deepseek', config).status.keyStatus, 'INVALID_FORMAT');
  assert.equal(JSON.stringify(config).includes('openai-test-key'), false);
  assert.equal(JSON.stringify(config).includes('Bearer bad'), false);
});

test('router uses task route and returns unified provider metadata', async () => {
  const calls = [];
  const router = createAIRouter({
    env: env({ AI_ROUTE_QUICK_FEEDBACK: 'deepseek' }),
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return response(200, JSON.stringify({ choices: [{ message: { content: 'deepseek ok' } }] }), { 'x-request-id': 'req-ds' });
    }
  });

  const result = await router.executeWithFallback('quick_feedback', { prompt: '短评' });

  assert.equal(result.success, true);
  assert.equal(result.provider, 'deepseek');
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.taskType, 'quick_feedback');
  assert.equal(result.text, 'deepseek ok');
  assert.match(calls[0].url, /deepseek/);
  assert.equal(JSON.stringify(result).includes('deepseek-test-key'), false);
});

test('OpenAI 401 falls back to DeepSeek once without looping', async () => {
  const calls = [];
  const router = createAIRouter({
    env: env(),
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('openai')) {
        return response(401, JSON.stringify({ error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }));
      }
      return response(200, JSON.stringify({ choices: [{ message: { content: 'fallback ok' } }] }));
    }
  });

  const result = await router.executeWithFallback('essay_grading', { prompt: '作文', jsonMode: false });

  assert.equal(result.provider, 'deepseek');
  assert.equal(result.primaryProvider, 'openai');
  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(calls.map((url) => url.includes('openai') ? 'openai' : 'deepseek'), ['openai', 'deepseek']);
});

test('DeepSeek 401 falls back to OpenAI when the task route prefers DeepSeek', async () => {
  const calls = [];
  const router = createAIRouter({
    env: env({ AI_ROUTE_QUICK_FEEDBACK: 'deepseek' }),
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('deepseek')) {
        return response(401, JSON.stringify({ error: { message: 'Authentication Fails', type: 'authentication_error' } }));
      }
      return response(200, JSON.stringify({ output_text: 'openai fallback ok' }));
    }
  });

  const result = await router.executeWithFallback('quick_feedback', { prompt: '短评' });

  assert.equal(result.provider, 'openai');
  assert.equal(result.primaryProvider, 'deepseek');
  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(calls.map((url) => url.includes('deepseek') ? 'deepseek' : 'openai'), ['deepseek', 'openai']);
});

test('timeout and rate limit are fallbackable, while disabled fallback does not switch', async () => {
  const timeoutRouter = createAIRouter({
    env: env({ AI_ROUTE_ESSAY_GRADING: 'openai' }),
    fetchImpl: async (url) => {
      if (String(url).includes('openai')) {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      }
      return response(200, JSON.stringify({ choices: [{ message: { content: 'timeout fallback' } }] }));
    }
  });
  const timeoutResult = await timeoutRouter.executeWithFallback('essay_grading', { prompt: '作文' });
  assert.equal(timeoutResult.provider, 'deepseek');
  assert.equal(timeoutResult.fallbackUsed, true);

  const limitedRouter = createAIRouter({
    env: env({ AI_ROUTE_QUICK_FEEDBACK: 'deepseek', AI_FALLBACK_ENABLED: 'false' }),
    fetchImpl: async () => response(429, JSON.stringify({ error: { message: 'rate_limit_exceeded' } }))
  });
  await assert.rejects(
    () => limitedRouter.executeWithFallback('quick_feedback', { prompt: '短评' }),
    (error) => error.code === 'AI_RATE_LIMITED'
  );
});

test('OpenAI insufficient quota is classified before generic 429 rate limit', async () => {
  const router = createAIRouter({
    env: env({ AI_FALLBACK_ENABLED: 'false' }),
    fetchImpl: async () => response(429, JSON.stringify({
      error: {
        type: 'insufficient_quota',
        code: 'insufficient_quota',
        message: 'You exceeded your current quota.'
      }
    }))
  });

  const status = await router.getRouterStatus({ checkConnections: true, provider: 'openai' });

  assert.equal(status.providers.openai.connected, false);
  assert.equal(status.providers.openai.errorCode, 'AI_QUOTA_EXCEEDED');
});

test('router reports ready and degraded when only one provider is connected', async () => {
  const router = createAIRouter({
    env: env(),
    fetchImpl: async (url) => {
      if (String(url).includes('openai')) return response(200, JSON.stringify({ output_text: 'OK' }));
      return response(401, JSON.stringify({ error: { message: 'Authentication Fails' } }));
    }
  });

  const status = await router.getRouterStatus({ checkConnections: true });

  assert.equal(status.routerEnabled, true);
  assert.equal(status.ready, true);
  assert.equal(status.degraded, true);
  assert.equal(status.providers.openai.connected, true);
  assert.equal(status.providers.deepseek.connected, false);
  assert.equal(status.providers.deepseek.errorCode, 'AI_KEY_INVALID');
  assert.equal(JSON.stringify(status).includes('openai-test-key'), false);
  assert.equal(JSON.stringify(status).includes('deepseek-test-key'), false);
});

test('DeepSeek-only production mode disables OpenAI without degraded status', async () => {
  const calls = [];
  const router = createAIRouter({
    env: env({
      AI_DEFAULT_PROVIDER: 'deepseek',
      AI_PRIMARY_PROVIDER: 'deepseek',
      AI_FALLBACK_ENABLED: 'false',
      AI_ROUTE_ESSAY_GRADING: 'deepseek',
      AI_ROUTE_LOGIC_ANALYSIS: 'deepseek',
      AI_ROUTE_DEEP_REVISION: 'deepseek',
      AI_ROUTE_QUICK_FEEDBACK: 'deepseek',
      AI_ROUTE_OCR_CLEANUP: 'deepseek',
      AI_ROUTE_SUMMARY: 'deepseek',
      AI_ROUTE_FEISHU_REPLY: 'deepseek',
      AI_ROUTE_TEACHER_REPORT: 'deepseek',
      AI_ROUTE_GENERAL: 'deepseek'
    }),
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('openai')) {
        throw new Error('OpenAI should not be called in DeepSeek-only mode');
      }
      return response(200, JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
    }
  });

  const status = await router.getRouterStatus({ checkConnections: true });

  assert.equal(status.ready, true);
  assert.equal(status.degraded, false);
  assert.equal(status.primaryProvider, 'deepseek');
  assert.equal(status.fallbackEnabled, false);
  assert.equal(status.providers.deepseek.enabled, true);
  assert.equal(status.providers.deepseek.connected, true);
  assert.equal(status.providers.openai.enabled, false);
  assert.equal(status.providers.openai.status, 'DISABLED');
  assert.equal(status.providers.openai.errorCode, null);
  assert.equal(status.routes.essay_grading, 'deepseek');
  assert.equal(status.routes.teacher_report, 'deepseek');
  assert.ok(calls.every((url) => url.includes('deepseek')));
});

test('OpenAI health check uses a valid minimum max_output_tokens', async () => {
  const bodies = [];
  const router = createAIRouter({
    env: env(),
    fetchImpl: async (url, init) => {
      if (String(url).includes('openai')) {
        bodies.push(JSON.parse(init.body));
        return response(200, JSON.stringify({ output_text: 'OK' }));
      }
      return response(200, JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
    }
  });

  const status = await router.getRouterStatus({ checkConnections: true, provider: 'openai' });

  assert.equal(status.providers.openai.connected, true);
  assert.ok(bodies[0].max_output_tokens >= 16);
  assert.equal('temperature' in bodies[0], false);
});

test('AI admin status returns router map without secrets', async () => {
  const app = createApp({
    env: env(),
    aiRouterFactory: () => ({
      getRouterStatus: async () => ({
        routerEnabled: true,
        ready: true,
        degraded: true,
        primaryProvider: 'openai',
        fallbackProvider: 'deepseek',
        providers: {
          openai: { configured: true, connected: true, model: 'openai-grade', latencyMs: 10, errorCode: null },
          deepseek: { configured: true, connected: false, model: 'deepseek-chat', latencyMs: 10, errorCode: 'AI_KEY_INVALID' }
        },
        routes: { essay_grading: 'openai', quick_feedback: 'deepseek' },
        checkedAt: '2026-07-12T00:00:00.000Z'
      })
    })
  });

  const res = await invoke(app, { url: '/api/admin/ai/status' });
  const data = JSON.parse(res.body);

  assert.equal(res.statusCode, 200);
  assert.equal(data.ready, true);
  assert.equal(data.degraded, true);
  assert.equal(data.providers.openai.connected, true);
  assert.equal(data.routes.essay_grading, 'openai');
  assert.equal(JSON.stringify(data).includes('Authorization'), false);
  assert.equal(JSON.stringify(data).includes('openai-test-key'), false);
});
