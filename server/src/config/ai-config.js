import { getLoadedEnvFile, keyStatus, normalizeEnvValue } from './env.js';

export const PROVIDERS = ['openai', 'deepseek'];

export const TASK_TYPES = [
  'essay_grading',
  'logic_analysis',
  'deep_revision',
  'quick_feedback',
  'ocr_cleanup',
  'summary',
  'feishu_reply',
  'teacher_report',
  'general'
];

export const DEFAULT_ROUTES = {
  essay_grading: 'openai',
  logic_analysis: 'openai',
  deep_revision: 'openai',
  teacher_report: 'openai',
  quick_feedback: 'deepseek',
  ocr_cleanup: 'deepseek',
  summary: 'deepseek',
  feishu_reply: 'deepseek',
  general: 'openai'
};

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_TIMEOUT_MS = 60000;

function boolEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function intEnv(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeProvider(value, fallback = '') {
  const provider = normalizeEnvValue(value || '').toLowerCase();
  return PROVIDERS.includes(provider) ? provider : fallback;
}

function safeUrl(value, fallback = '') {
  const raw = normalizeEnvValue(value || fallback);
  if (!raw) return { ok: true, value: '', configured: false };
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
      return { ok: false, value: raw, configured: true };
    }
    return { ok: true, value: url.toString(), configured: Boolean(value) };
  } catch {
    return { ok: false, value: raw, configured: true };
  }
}

export function sanitizeSecretValue(value) {
  const original = String(value ?? '');
  const normalized = normalizeEnvValue(original);
  let issue = null;
  if (value === undefined) issue = 'MISSING';
  else if (!normalized) issue = 'EMPTY';
  else if (/\r|\n|\\n/.test(original)) issue = 'NEWLINE';
  else if (/^Bearer\s+/i.test(normalized)) issue = 'BEARER_PREFIX';
  else if (/^your-|your-.*-key/i.test(normalized)) issue = 'PLACEHOLDER';
  return {
    value: normalized,
    status: keyStatus(value),
    issue,
    hasNewline: /\r|\n|\\n/.test(original),
    hasBearerPrefix: /^Bearer\s+/i.test(normalized)
  };
}

function providerConfig(env, provider) {
  const upper = provider.toUpperCase();
  const defaultBaseUrl = provider === 'deepseek' ? DEFAULT_DEEPSEEK_BASE_URL : DEFAULT_OPENAI_BASE_URL;
  const baseUrl = safeUrl(env[`${upper}_BASE_URL`], defaultBaseUrl);
  const secret = sanitizeSecretValue(env[`${upper}_API_KEY`]);
  const model = normalizeEnvValue(env[`${upper}_MODEL`] || '');
  const fastModel = normalizeEnvValue(env[`${upper}_FAST_MODEL`] || model);
  const reasoningModel = normalizeEnvValue(env[`${upper}_REASONING_MODEL`] || model);
  return {
    name: provider,
    model,
    fastModel,
    reasoningModel,
    baseUrl: baseUrl.value || defaultBaseUrl,
    baseUrlConfigured: Boolean(env[`${upper}_BASE_URL`]),
    baseUrlValid: baseUrl.ok,
    keyStatus: secret.status,
    keyIssue: secret.issue,
    enabled: false,
    status: 'DISABLED'
  };
}

function routeEnvKey(taskType) {
  return `AI_ROUTE_${String(taskType || '').toUpperCase()}`;
}

export function getAIConfig(env = process.env) {
  const primaryProvider = normalizeProvider(env.AI_PRIMARY_PROVIDER, 'openai');
  const fallbackProvider = normalizeProvider(env.AI_FALLBACK_PROVIDER, primaryProvider === 'openai' ? 'deepseek' : 'openai');
  const defaultProvider = normalizeEnvValue(env.AI_DEFAULT_PROVIDER || 'auto').toLowerCase();
  const routes = {};
  for (const taskType of TASK_TYPES) {
    const configured = normalizeProvider(env[routeEnvKey(taskType)], DEFAULT_ROUTES[taskType]);
    routes[taskType] = configured || DEFAULT_ROUTES[taskType] || primaryProvider;
  }
  const activeProviders = new Set(Object.values(routes));
  activeProviders.add(primaryProvider);
  if (boolEnv(env.AI_FALLBACK_ENABLED, true)) activeProviders.add(fallbackProvider);
  const providers = {
    openai: providerConfig(env, 'openai'),
    deepseek: providerConfig(env, 'deepseek')
  };
  for (const provider of PROVIDERS) {
    providers[provider].enabled = activeProviders.has(provider);
    providers[provider].status = providers[provider].enabled ? 'ENABLED' : 'DISABLED';
  }
  return {
    routerEnabled: boolEnv(env.AI_ROUTER_ENABLED, true),
    defaultProvider: defaultProvider || 'auto',
    primaryProvider,
    fallbackProvider,
    fallbackEnabled: boolEnv(env.AI_FALLBACK_ENABLED, true),
    timeoutMs: intEnv(env.AI_REQUEST_TIMEOUT_MS, intEnv(env.AI_TIMEOUT_MS, DEFAULT_TIMEOUT_MS)),
    maxRetries: Math.min(intEnv(env.AI_MAX_RETRIES, 1), 1),
    reviewMode: normalizeEnvValue(env.AI_REVIEW_MODE || 'single').toLowerCase() || 'single',
    envFile: getLoadedEnvFile(env),
    providers,
    routes
  };
}

export function getProviderSecret(env = process.env, provider = 'openai') {
  const keyName = provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENAI_API_KEY';
  return sanitizeSecretValue(env[keyName]).value;
}

export function validateProviderConfig(provider, configOrEnv = process.env) {
  const config = configOrEnv?.providers ? configOrEnv : getAIConfig(configOrEnv);
  const normalizedProvider = normalizeProvider(provider);
  const status = config.providers[normalizedProvider] || null;
  const errors = [];
  if (!status) {
    errors.push({ code: 'AI_PROVIDER_MISCONFIGURED', message: 'AI Provider 不受支持' });
    return { ok: false, configured: false, provider: normalizedProvider || '', status: {}, errors };
  }
  if (status.keyStatus !== 'SET') {
    const code = status.keyStatus === 'INVALID_FORMAT' && status.keyIssue === 'PLACEHOLDER'
      ? 'AI_KEY_INVALID'
      : (status.keyStatus === 'INVALID_FORMAT' ? 'AI_PROVIDER_MISCONFIGURED' : 'AI_KEY_MISSING');
    errors.push({
      code,
      message: `${normalizedProvider} API Key 未正确配置`
    });
  }
  if (!status.model) {
    errors.push({ code: 'AI_PROVIDER_MISCONFIGURED', message: `${normalizedProvider} 模型未配置` });
  }
  if (!status.baseUrlValid) {
    errors.push({ code: 'AI_PROVIDER_MISCONFIGURED', message: `${normalizedProvider} Base URL 格式无效` });
  }
  return {
    ok: errors.length === 0,
    configured: errors.length === 0,
    provider: normalizedProvider,
    status,
    errors
  };
}

export function getProviderStatus(provider, env = process.env) {
  const config = getAIConfig(env);
  const validation = validateProviderConfig(provider, config);
  return {
    provider: validation.provider,
    configured: validation.ok,
    keyStatus: validation.status.keyStatus || 'MISSING',
    model: validation.status.model || '',
    baseUrlConfigured: Boolean(validation.status.baseUrlConfigured),
    baseUrlValid: Boolean(validation.status.baseUrlValid),
    errors: validation.errors.map((error) => error.code)
  };
}

export function getConfiguredProviders(env = process.env) {
  const config = getAIConfig(env);
  return PROVIDERS.filter((provider) => validateProviderConfig(provider, config).ok);
}

export function routeForTask(taskType, configOrEnv = process.env) {
  const config = configOrEnv?.routes ? configOrEnv : getAIConfig(configOrEnv);
  return config.routes[taskType] || config.routes.general || config.primaryProvider;
}

export function publicAIConfigSummary(env = process.env) {
  const config = getAIConfig(env);
  return {
    routerEnabled: config.routerEnabled,
    defaultProvider: config.defaultProvider,
    primaryProvider: config.primaryProvider,
    fallbackProvider: config.fallbackProvider,
    fallbackEnabled: config.fallbackEnabled,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    reviewMode: config.reviewMode,
    envFile: config.envFile,
    providers: config.providers,
    routes: config.routes
  };
}
