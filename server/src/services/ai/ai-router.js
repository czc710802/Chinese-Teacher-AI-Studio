import {
  getAIConfig,
  getProviderSecret,
  PROVIDERS,
  routeForTask,
  validateProviderConfig
} from '../../config/ai-config.js';
import { AIServiceError, classifyAIError, safeChineseMessage } from './client-factory.js';
import { createDeepSeekProvider } from './providers/deepseek-provider.js';
import { createOpenAIProvider } from './providers/openai-provider.js';
import { statusForAIError } from './providers/base-provider.js';

const FALLBACKABLE_CODES = new Set([
  'AI_KEY_INVALID',
  'AI_MODEL_NOT_FOUND',
  'AI_QUOTA_EXCEEDED',
  'AI_RATE_LIMITED',
  'AI_NETWORK_ERROR',
  'AI_TIMEOUT',
  'AI_UPSTREAM_ERROR'
]);

function otherProvider(provider) {
  return provider === 'openai' ? 'deepseek' : 'openai';
}

function createProvider(provider, { env, config, fetchImpl, timeoutMs, logger }) {
  const common = {
    env,
    config: config.providers[provider],
    apiKey: getProviderSecret(env, provider),
    fetchImpl,
    timeoutMs,
    logger
  };
  return provider === 'deepseek' ? createDeepSeekProvider(common) : createOpenAIProvider(common);
}

function compactAttempt({ provider, result, error, latencyMs }) {
  if (result) {
    return {
      provider,
      model: result.model || '',
      ok: true,
      latencyMs,
      requestId: result.requestId || undefined
    };
  }
  const classified = classifyAIError(error);
  return {
    provider,
    model: classified.model || '',
    ok: false,
    latencyMs,
    errorCode: classified.code,
    requestId: classified.requestId || undefined
  };
}

export class AIRouter {
  constructor({ env = process.env, fetchImpl = fetch, logger = console } = {}) {
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.logger = logger;
    this.config = getAIConfig(env);
    this.unavailableProviders = new Map();
    this.recentResults = [];
  }

  refreshConfig() {
    this.config = getAIConfig(this.env);
    return this.config;
  }

  selectPrimaryProvider(taskType = 'general', options = {}) {
    const allowed = Array.isArray(options.allowedProviders) && options.allowedProviders.length
      ? options.allowedProviders.filter((provider) => PROVIDERS.includes(provider))
      : PROVIDERS;
    const routed = routeForTask(taskType, this.config);
    if (allowed.includes(routed)) return routed;
    if (allowed.includes(this.config.primaryProvider)) return this.config.primaryProvider;
    return allowed[0] || this.config.primaryProvider;
  }

  selectFallbackProvider(taskType = 'general', options = {}) {
    if (!this.config.fallbackEnabled || options.fallbackEnabled === false) return null;
    const primary = this.selectPrimaryProvider(taskType, options);
    const allowed = Array.isArray(options.allowedProviders) && options.allowedProviders.length
      ? options.allowedProviders.filter((provider) => PROVIDERS.includes(provider))
      : PROVIDERS;
    const configuredFallback = this.config.fallbackProvider && this.config.fallbackProvider !== primary
      ? this.config.fallbackProvider
      : otherProvider(primary);
    if (allowed.includes(configuredFallback)) return configuredFallback;
    const candidate = allowed.find((provider) => provider !== primary);
    return candidate || null;
  }

  providerIsUnavailable(provider) {
    const record = this.unavailableProviders.get(provider);
    if (!record) return false;
    return Date.now() - record.at < 5 * 60 * 1000;
  }

  markProviderUnavailable(provider, error) {
    const classified = classifyAIError(error);
    if (classified.code === 'AI_KEY_INVALID') {
      this.unavailableProviders.set(provider, { at: Date.now(), errorCode: classified.code });
    }
  }

  buildProvider(provider) {
    const validation = validateProviderConfig(provider, this.config);
    if (!validation.ok) {
      const code = validation.errors[0]?.code || 'AI_PROVIDER_MISCONFIGURED';
      throw new AIServiceError(safeChineseMessage(code), {
        code,
        provider,
        model: validation.status?.model || '',
        status: statusForAIError(code)
      });
    }
    return createProvider(provider, {
      env: this.env,
      config: this.config,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.config.timeoutMs,
      logger: this.logger
    });
  }

  async tryProvider(provider, taskType, payload) {
    if (this.providerIsUnavailable(provider)) {
      throw new AIServiceError('AI Provider 暂不可用', {
        code: 'AI_KEY_INVALID',
        provider,
        model: this.config.providers[provider]?.model || '',
        status: 502
      });
    }
    const service = this.buildProvider(provider);
    if (taskType === 'essay_grading') {
      return service.gradeEssay({ ...payload, taskType });
    }
    return service.generateText({ ...payload, taskType });
  }

  shouldFallback(error) {
    const classified = classifyAIError(error);
    return FALLBACKABLE_CODES.has(classified.code);
  }

  recordProviderResult(result) {
    this.recentResults.push({
      provider: result.provider,
      ok: Boolean(result.success || result.ok),
      errorCode: result.errorCode || null,
      at: Date.now()
    });
    if (this.recentResults.length > 50) this.recentResults.shift();
  }

  async executeWithFallback(taskType = 'general', payload = {}) {
    this.refreshConfig();
    if (!this.config.routerEnabled) {
      throw new AIServiceError('AI Router 未启用', {
        code: 'AI_PROVIDER_MISCONFIGURED',
        status: 503
      });
    }
    const startedAt = Date.now();
    const primaryProvider = this.selectPrimaryProvider(taskType, payload);
    const fallbackProvider = this.selectFallbackProvider(taskType, payload);
    const attempts = [];
    let primaryError = null;

    try {
      const attemptStartedAt = Date.now();
      const result = await this.tryProvider(primaryProvider, taskType, payload);
      attempts.push(compactAttempt({ provider: primaryProvider, result, latencyMs: Date.now() - attemptStartedAt }));
      const finalResult = {
        success: true,
        provider: result.provider,
        model: result.model,
        fallbackUsed: false,
        primaryProvider,
        taskType,
        latencyMs: Date.now() - startedAt,
        text: result.text,
        requestId: result.requestId || undefined,
        attempts
      };
      this.recordProviderResult(finalResult);
      return finalResult;
    } catch (error) {
      primaryError = error;
      this.markProviderUnavailable(primaryProvider, error);
      attempts.push(compactAttempt({ provider: primaryProvider, error, latencyMs: Date.now() - startedAt }));
    }

    if (!fallbackProvider || fallbackProvider === primaryProvider || !this.shouldFallback(primaryError)) {
      this.recordProviderResult({ provider: primaryProvider, ok: false, errorCode: classifyAIError(primaryError).code });
      throw primaryError;
    }

    try {
      const attemptStartedAt = Date.now();
      const result = await this.tryProvider(fallbackProvider, taskType, payload);
      attempts.push(compactAttempt({ provider: fallbackProvider, result, latencyMs: Date.now() - attemptStartedAt }));
      const finalResult = {
        success: true,
        provider: result.provider,
        model: result.model,
        fallbackUsed: true,
        primaryProvider,
        taskType,
        latencyMs: Date.now() - startedAt,
        text: result.text,
        requestId: result.requestId || undefined,
        attempts
      };
      this.recordProviderResult(finalResult);
      return finalResult;
    } catch (error) {
      this.markProviderUnavailable(fallbackProvider, error);
      attempts.push(compactAttempt({ provider: fallbackProvider, error, latencyMs: Date.now() - startedAt }));
      const classified = classifyAIError(error);
      const finalError = new AIServiceError(classified.message, {
        code: classified.code,
        provider: classified.provider || fallbackProvider,
        model: classified.model || this.config.providers[fallbackProvider]?.model || '',
        requestId: classified.requestId || '',
        status: classified.status || statusForAIError(classified.code)
      });
      finalError.attempts = attempts;
      this.recordProviderResult({ provider: fallbackProvider, ok: false, errorCode: classified.code });
      throw finalError;
    }
  }

  async routeTask(taskType = 'general', options = {}) {
    return this.executeWithFallback(taskType, options);
  }

  async getProviderHealth(provider, { checkConnections = false } = {}) {
    const validation = validateProviderConfig(provider, this.config);
    const providerConfig = this.config.providers[provider] || {};
    if (!providerConfig.enabled) {
      return {
        enabled: false,
        status: 'DISABLED',
        configured: validation.ok,
        connected: false,
        model: validation.status?.model || '',
        keyStatus: validation.status?.keyStatus || 'MISSING',
        baseUrlConfigured: Boolean(validation.status?.baseUrlConfigured),
        latencyMs: 0,
        errorCode: null,
        message: 'AI Provider 已禁用'
      };
    }
    const base = {
      enabled: true,
      status: validation.ok ? 'ENABLED' : 'CONFIG_ERROR',
      configured: validation.ok,
      connected: false,
      model: validation.status?.model || '',
      keyStatus: validation.status?.keyStatus || 'MISSING',
      baseUrlConfigured: Boolean(validation.status?.baseUrlConfigured),
      latencyMs: 0,
      errorCode: validation.errors[0]?.code || null
    };
    if (!validation.ok || !checkConnections) return base;
    const health = await createProvider(provider, {
      env: this.env,
      config: this.config,
      fetchImpl: this.fetchImpl,
      timeoutMs: this.config.timeoutMs,
      logger: this.logger
    }).healthCheck();
    if (health.errorCode === 'AI_KEY_INVALID') {
      this.unavailableProviders.set(provider, { at: Date.now(), errorCode: health.errorCode });
    }
    return {
      enabled: true,
      status: health.connected ? 'CONNECTED' : 'ERROR',
      configured: health.configured,
      connected: health.connected,
      model: health.model || base.model,
      keyStatus: base.keyStatus,
      baseUrlConfigured: base.baseUrlConfigured,
      latencyMs: health.latencyMs,
      errorCode: health.errorCode,
      requestId: health.requestId,
      message: health.message
    };
  }

  async getRouterStatus({ checkConnections = false, provider = '' } = {}) {
    this.refreshConfig();
    const checkedAt = new Date().toISOString();
    const providerNames = provider ? [provider] : PROVIDERS;
    const providers = {};
    for (const name of providerNames) {
      providers[name] = await this.getProviderHealth(name, { checkConnections });
    }
    const values = Object.values(providers).filter((item) => item.enabled !== false);
    const ready = checkConnections
      ? values.some((item) => item.connected)
      : values.some((item) => item.configured);
    const degraded = ready && values.some((item) => !item.connected || item.errorCode);
    return {
      routerEnabled: this.config.routerEnabled,
      ready,
      degraded,
      primaryProvider: this.config.primaryProvider,
      fallbackProvider: this.config.fallbackProvider,
      fallbackEnabled: this.config.fallbackEnabled,
      providers,
      routes: this.config.routes,
      checkedAt
    };
  }
}

export function createAIRouter(options = {}) {
  return new AIRouter(options);
}
