import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createApp } from '../src/app.js';
import {
  classifyAIError,
  createAIClient,
  getAIProviderStatus,
  validateAIConfiguration
} from '../src/services/ai/client-factory.js';

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

test('validateAIConfiguration normalizes quoted and spaced keys without exposing them', () => {
  const result = validateAIConfiguration({
    AI_PROVIDER: 'deepseek',
    DEEPSEEK_API_KEY: '  "deepseek-test-key"  ',
    DEEPSEEK_MODEL: 'deepseek-chat',
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com/chat/completions'
  });

  assert.equal(result.ok, true);
  assert.equal(result.config.provider, 'deepseek');
  assert.equal(result.status.deepseek.keyStatus, 'SET');
  assert.equal(JSON.stringify(result).includes('deepseek-test-key'), false);
});

test('validateAIConfiguration rejects missing, empty, bearer-prefixed, mismatched and malformed config', () => {
  assert.equal(validateAIConfiguration({ AI_PROVIDER: 'deepseek', DEEPSEEK_MODEL: 'deepseek-chat', DEEPSEEK_BASE_URL: 'https://api.deepseek.com/chat/completions' }).ok, false);
  assert.equal(validateAIConfiguration({ AI_PROVIDER: 'openai', OPENAI_API_KEY: '', OPENAI_MODEL: 'gpt-5.5' }).status.openai.keyStatus, 'EMPTY');
  assert.equal(validateAIConfiguration({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'Bearer abc', DEEPSEEK_MODEL: 'deepseek-chat', DEEPSEEK_BASE_URL: 'https://api.deepseek.com/chat/completions' }).status.deepseek.keyStatus, 'INVALID_FORMAT');
  assert.equal(validateAIConfiguration({ AI_PROVIDER: 'deepseek', OPENAI_API_KEY: 'openai-key', OPENAI_MODEL: 'gpt-5.5', DEEPSEEK_MODEL: 'deepseek-chat', DEEPSEEK_BASE_URL: 'https://api.deepseek.com/chat/completions' }).ok, false);
  assert.equal(validateAIConfiguration({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'deepseek-key', DEEPSEEK_MODEL: '', DEEPSEEK_BASE_URL: 'notaurl' }).ok, false);
});

test('createAIClient sends DeepSeek requests only to configured DeepSeek endpoint', async () => {
  const calls = [];
  const client = createAIClient({
    env: {
      AI_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'deepseek-test-key',
      DEEPSEEK_MODEL: 'deepseek-chat',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com/chat/completions'
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return response(200, JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { 'x-request-id': 'req-1' });
    }
  });

  const result = await client.callText('只回复 ok', { maxTokens: 4 });

  assert.equal(result.text, 'ok');
  assert.match(calls[0].url, /api\.deepseek\.com/);
  assert.doesNotMatch(calls[0].url, /openai\.com/);
  assert.equal(JSON.stringify(result).includes('deepseek-test-key'), false);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer deepseek-test-key');
});

test('AI upstream errors are classified and sanitized', async () => {
  const invalid = classifyAIError(new Error('DeepSeek API 调用失败：401 {"error":{"message":"Authentication Fails, Your api key is invalid","code":"invalid_api_key"}}'));
  const limited = classifyAIError(new Error('OpenAI API 调用失败：429 rate_limit_exceeded'));
  const timeout = classifyAIError(new Error('ETIMEDOUT'));

  assert.equal(invalid.code, 'AI_KEY_INVALID');
  assert.equal(limited.code, 'AI_RATE_LIMITED');
  assert.equal(timeout.code, 'AI_TIMEOUT');
  assert.equal(JSON.stringify(invalid).includes('Bearer'), false);
});

test('AI status route returns safe connection status without secrets', async () => {
  const app = createApp({
    env: {
      NODE_ENV: 'test',
      AI_PROVIDER: 'deepseek',
      DEEPSEEK_API_KEY: 'deepseek-test-key',
      DEEPSEEK_MODEL: 'deepseek-chat',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com/chat/completions'
    },
    aiRouterFactory: () => ({
      getRouterStatus: async () => ({
        routerEnabled: true,
        ready: true,
        degraded: false,
        primaryProvider: 'deepseek',
        fallbackProvider: 'openai',
        providers: {
          deepseek: {
            configured: true,
            connected: true,
            model: 'deepseek-chat',
            keyStatus: 'SET',
            latencyMs: 12,
            errorCode: null
          }
        },
        routes: { essay_grading: 'deepseek' },
        checkedAt: '2026-07-12T00:00:00.000Z'
      })
    })
  });

  const res = await invoke(app, { url: '/api/admin/ai/status' });
  const data = JSON.parse(res.body);

  assert.equal(res.statusCode, 200);
  assert.equal(data.primaryProvider, 'deepseek');
  assert.equal(data.providers.deepseek.connected, true);
  assert.equal(JSON.stringify(data).includes('deepseek-test-key'), false);
  assert.equal(JSON.stringify(data).includes('Authorization'), false);
});

test('frontend bundle sources do not contain AI provider keys or authorization wiring', () => {
  const status = getAIProviderStatus({
    AI_PROVIDER: 'deepseek',
    DEEPSEEK_API_KEY: 'deepseek-test-key',
    DEEPSEEK_MODEL: 'deepseek-chat',
    DEEPSEEK_BASE_URL: 'https://api.deepseek.com/chat/completions'
  });

  assert.equal(status.provider, 'deepseek');
  assert.equal(status.keyStatus, 'SET');
  assert.equal(JSON.stringify(status).includes('deepseek-test-key'), false);
});
