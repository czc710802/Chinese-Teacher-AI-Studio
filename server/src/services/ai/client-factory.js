import { getLoadedEnvFile, keyStatus, normalizeEnvValue } from '../../config/env.js';

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_TIMEOUT_MS = 15000;

export class AIServiceError extends Error {
  constructor(message, { code = 'AI_UPSTREAM_ERROR', provider = '', model = '', requestId = '', status = 500 } = {}) {
    super(message);
    this.name = 'AIServiceError';
    this.code = code;
    this.provider = provider;
    this.model = model;
    this.requestId = requestId;
    this.status = status;
  }
}

export function redactAIText(value) {
  return String(value ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
    .replace(/your-[A-Za-z0-9_*.-]+-key/gi, '***key')
    .slice(0, 500);
}

function parseProvider(env = process.env) {
  return normalizeEnvValue(env.AI_PROVIDER || '').toLowerCase() || (keyStatus(env.DEEPSEEK_API_KEY) === 'SET' ? 'deepseek' : 'openai');
}

function safeUrl(value, fallback = '') {
  const raw = normalizeEnvValue(value || fallback);
  if (!raw) return { ok: true, value: '', configured: false };
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return { ok: false, value: raw, configured: true };
    return { ok: true, value: url.toString(), configured: true };
  } catch {
    return { ok: false, value: raw, configured: true };
  }
}

function baseStatus(env, provider) {
  const openaiBase = safeUrl(env.OPENAI_BASE_URL, DEFAULT_OPENAI_BASE_URL);
  const deepseekBase = safeUrl(env.DEEPSEEK_BASE_URL, DEFAULT_DEEPSEEK_BASE_URL);
  return {
    provider,
    envFile: getLoadedEnvFile(env),
    openai: {
      keyStatus: keyStatus(env.OPENAI_API_KEY),
      model: normalizeEnvValue(env.OPENAI_MODEL || ''),
      baseUrlConfigured: Boolean(env.OPENAI_BASE_URL),
      baseUrlValid: openaiBase.ok
    },
    deepseek: {
      keyStatus: keyStatus(env.DEEPSEEK_API_KEY),
      model: normalizeEnvValue(env.DEEPSEEK_MODEL || ''),
      baseUrlConfigured: Boolean(env.DEEPSEEK_BASE_URL),
      baseUrlValid: deepseekBase.ok
    }
  };
}

export function validateAIConfiguration(env = process.env) {
  const provider = parseProvider(env);
  const errors = [];
  const status = baseStatus(env, provider);

  if (!['openai', 'deepseek'].includes(provider)) {
    errors.push({ code: 'AI_PROVIDER_MISCONFIGURED', message: 'AI_PROVIDER 只支持 openai 或 deepseek' });
  }

  const openaiBase = safeUrl(env.OPENAI_BASE_URL, DEFAULT_OPENAI_BASE_URL);
  const deepseekBase = safeUrl(env.DEEPSEEK_BASE_URL, DEFAULT_DEEPSEEK_BASE_URL);

  if (provider === 'openai') {
    if (status.openai.keyStatus !== 'SET') errors.push({ code: status.openai.keyStatus === 'INVALID_FORMAT' ? 'AI_PROVIDER_MISCONFIGURED' : 'AI_KEY_MISSING', message: 'OPENAI_API_KEY 未正确配置' });
    if (!status.openai.model) errors.push({ code: 'AI_PROVIDER_MISCONFIGURED', message: 'OPENAI_MODEL 未配置' });
    if (!openaiBase.ok) errors.push({ code: 'AI_PROVIDER_MISCONFIGURED', message: 'OPENAI_BASE_URL 格式无效' });
  }

  if (provider === 'deepseek') {
    if (status.deepseek.keyStatus !== 'SET') errors.push({ code: status.deepseek.keyStatus === 'INVALID_FORMAT' ? 'AI_PROVIDER_MISCONFIGURED' : 'AI_KEY_MISSING', message: 'DEEPSEEK_API_KEY 未正确配置' });
    if (!status.deepseek.model) errors.push({ code: 'AI_PROVIDER_MISCONFIGURED', message: 'DEEPSEEK_MODEL 未配置' });
    if (!deepseekBase.ok) errors.push({ code: 'AI_PROVIDER_MISCONFIGURED', message: 'DEEPSEEK_BASE_URL 格式无效' });
  }

  const config = provider === 'deepseek'
    ? {
        provider,
        model: normalizeEnvValue(env.DEEPSEEK_MODEL || ''),
        baseUrl: deepseekBase.value || DEFAULT_DEEPSEEK_BASE_URL
      }
    : {
        provider,
        model: normalizeEnvValue(env.OPENAI_MODEL || ''),
        baseUrl: openaiBase.value || DEFAULT_OPENAI_BASE_URL
      };

  return {
    ok: errors.length === 0,
    configured: errors.length === 0,
    config: errors.length === 0 ? config : { provider, model: config.model, baseUrl: config.baseUrl },
    status,
    errors
  };
}

export function getAIProviderStatus(env = process.env) {
  const validation = validateAIConfiguration(env);
  const provider = validation.status.provider;
  const providerStatus = provider === 'deepseek' ? validation.status.deepseek : validation.status.openai;
  return {
    configured: validation.ok,
    provider,
    model: providerStatus.model || '',
    baseUrlConfigured: providerStatus.baseUrlConfigured,
    keyStatus: providerStatus.keyStatus,
    envFile: validation.status.envFile,
    errors: validation.errors.map((error) => error.code)
  };
}

export function getProviderApiKey(env = process.env, provider = parseProvider(env)) {
  return provider === 'deepseek'
    ? normalizeEnvValue(env.DEEPSEEK_API_KEY || '')
    : normalizeEnvValue(env.OPENAI_API_KEY || '');
}

function extractRequestId(response) {
  return response?.headers?.get?.('x-request-id') || response?.headers?.get?.('x-ratelimit-request-id') || '';
}

function compactErrorDetail(raw) {
  const text = String(raw || '');
  try {
    const parsed = JSON.parse(text);
    const error = parsed.error || parsed;
    return {
      message: redactAIText(error.message || text),
      type: error.type || '',
      code: error.code || ''
    };
  } catch {
    return { message: redactAIText(text), type: '', code: '' };
  }
}

export function classifyAIError(error) {
  if (error instanceof AIServiceError) {
    return {
      code: error.code,
      message: safeChineseMessage(error.code),
      provider: error.provider || '',
      model: error.model || '',
      requestId: error.requestId || '',
      status: error.status || 500
    };
  }
  const message = String(error?.message || error || '');
  let code = 'AI_UPSTREAM_ERROR';
  if (/MISSING|未配置|missing/i.test(message)) code = 'AI_KEY_MISSING';
  else if (/401|403|invalid[_ ]api[_ ]key|Incorrect API key|Authentication Fails|authentication_error/i.test(message)) code = 'AI_KEY_INVALID';
  else if (/model_not_found|model.*not.*found|无权访问|404/i.test(message)) code = 'AI_MODEL_NOT_FOUND';
  else if (/insufficient_quota|quota/i.test(message)) code = 'AI_QUOTA_EXCEEDED';
  else if (/429|rate_limit/i.test(message)) code = 'AI_RATE_LIMITED';
  else if (/timeout|ETIMEDOUT|AbortError/i.test(message)) code = 'AI_TIMEOUT';
  else if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(message)) code = 'AI_NETWORK_ERROR';
  return { code, message: safeChineseMessage(code), provider: '', model: '', requestId: '', status: statusForCode(code) };
}

export function safeChineseMessage(code) {
  const messages = {
    AI_KEY_MISSING: 'AI 服务密钥未配置，请联系管理员。',
    AI_KEY_INVALID: 'AI 服务鉴权失败，请检查密钥是否有效。',
    AI_PROVIDER_MISCONFIGURED: 'AI 服务配置错误，请联系管理员检查 Provider、模型和 Base URL。',
    AI_MODEL_NOT_FOUND: '当前模型不存在或无权访问。',
    AI_QUOTA_EXCEEDED: 'AI 服务额度不足。',
    AI_RATE_LIMITED: 'AI 服务暂时繁忙，请稍后重试。',
    AI_NETWORK_ERROR: 'AI 服务网络连接失败，请稍后重试。',
    AI_TIMEOUT: 'AI 服务响应超时，请稍后重试。',
    AI_UPSTREAM_ERROR: 'AI 服务暂时不可用，请稍后重试。'
  };
  return messages[code] || messages.AI_UPSTREAM_ERROR;
}

function statusForCode(code) {
  if (['AI_KEY_MISSING', 'AI_PROVIDER_MISCONFIGURED'].includes(code)) return 503;
  if (code === 'AI_KEY_INVALID') return 502;
  if (code === 'AI_RATE_LIMITED') return 429;
  if (code === 'AI_TIMEOUT') return 504;
  return 502;
}

async function withTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new AIServiceError('AI 请求超时', { code: 'AI_TIMEOUT', status: 504 });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function parseUpstreamFailure(response, config) {
  const detail = compactErrorDetail(await response.text());
  const requestId = extractRequestId(response);
  let code = 'AI_UPSTREAM_ERROR';
  if ([401, 403].includes(response.status) || /invalid[_ ]api[_ ]key|Authentication Fails|authentication_error|Incorrect API key/i.test(`${detail.message} ${detail.code} ${detail.type}`)) code = 'AI_KEY_INVALID';
  else if (response.status === 404 || /model/i.test(`${detail.message} ${detail.code}`)) code = 'AI_MODEL_NOT_FOUND';
  else if (/quota/i.test(`${detail.message} ${detail.code}`)) code = 'AI_QUOTA_EXCEEDED';
  else if (response.status === 429 || /rate_limit/i.test(`${detail.message} ${detail.code}`)) code = 'AI_RATE_LIMITED';
  throw new AIServiceError(`${config.provider} API 调用失败：${response.status} ${detail.message}`, {
    code,
    provider: config.provider,
    model: config.model,
    requestId,
    status: statusForCode(code)
  });
}

export function createAIClient({ env = process.env, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const validation = validateAIConfiguration(env);
  if (!validation.ok) {
    const code = validation.errors[0]?.code || 'AI_PROVIDER_MISCONFIGURED';
    throw new AIServiceError(safeChineseMessage(code), {
      code,
      provider: validation.status.provider,
      model: validation.config.model,
      status: statusForCode(code)
    });
  }
  const config = validation.config;

  async function callText(prompt, { jsonMode = false, maxTokens = 1200 } = {}) {
    const { createAIRouter } = await import('./ai-router.js');
    const router = createAIRouter({ env, fetchImpl, timeoutMs });
    const result = await router.executeWithFallback('general', {
      prompt,
      jsonMode,
      maxTokens,
      allowedProviders: [config.provider],
      fallbackEnabled: false
    });
    return {
      text: result.text,
      provider: result.provider,
      model: result.model,
      requestId: result.requestId
    };
  }

  async function testConnection() {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    try {
      await callText('只回复 OK', { maxTokens: 16 });
      return {
        configured: true,
        provider: config.provider,
        model: config.model,
        baseUrlConfigured: true,
        keyStatus: 'SET',
        connected: true,
        latencyMs: Date.now() - startedAt,
        checkedAt,
        errorCode: null,
        message: 'AI 服务连接正常'
      };
    } catch (error) {
      const classified = classifyAIError(error);
      return {
        configured: true,
        provider: config.provider,
        model: config.model,
        baseUrlConfigured: true,
        keyStatus: 'SET',
        connected: false,
        latencyMs: Date.now() - startedAt,
        checkedAt,
        errorCode: classified.code,
        message: classified.message,
        requestId: classified.requestId || undefined
      };
    }
  }

  return {
    config: { provider: config.provider, model: config.model, baseUrl: config.baseUrl },
    callText,
    testConnection
  };
}

export async function testAIConnection(options = {}) {
  return createAIClient(options).testConnection();
}
