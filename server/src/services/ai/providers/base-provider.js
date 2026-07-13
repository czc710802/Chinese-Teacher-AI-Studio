import { AIServiceError, classifyAIError, redactAIText, safeChineseMessage } from '../client-factory.js';

export function statusForAIError(code) {
  if (['AI_KEY_MISSING', 'AI_PROVIDER_MISCONFIGURED'].includes(code)) return 503;
  if (code === 'AI_KEY_INVALID') return 502;
  if (code === 'AI_RATE_LIMITED') return 429;
  if (code === 'AI_TIMEOUT') return 504;
  return 502;
}

function extractRequestId(response) {
  return response?.headers?.get?.('x-request-id')
    || response?.headers?.get?.('x-ratelimit-request-id')
    || response?.headers?.get?.('x-requestid')
    || '';
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

function classifyFailure(status, detail) {
  const text = `${detail.message || ''} ${detail.code || ''} ${detail.type || ''}`;
  if ([401, 403].includes(status) || /invalid[_ ]api[_ ]key|incorrect api key|authentication fails|authentication_error/i.test(text)) {
    return 'AI_KEY_INVALID';
  }
  if (status === 404 || /model.*not.*found|model_not_found|无权访问/i.test(text)) return 'AI_MODEL_NOT_FOUND';
  if (/quota|insufficient_quota/i.test(text)) return 'AI_QUOTA_EXCEEDED';
  if (status === 429 || /rate_limit|rate limit/i.test(text)) return 'AI_RATE_LIMITED';
  if (status >= 500) return 'AI_UPSTREAM_ERROR';
  return 'AI_UPSTREAM_ERROR';
}

export class BaseAIProvider {
  constructor({ env = process.env, config, apiKey = '', fetchImpl = fetch, timeoutMs = 60000, logger = console } = {}) {
    this.env = env;
    this.config = config;
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
  }

  getProviderName() {
    return this.config?.name || 'unknown';
  }

  isConfigured() {
    return this.config?.keyStatus === 'SET' && Boolean(this.config?.model) && this.config?.baseUrlValid !== false;
  }

  getModelName(taskType = 'general') {
    if (['quick_feedback', 'ocr_cleanup', 'summary', 'feishu_reply'].includes(taskType) && this.config.fastModel) {
      return this.config.fastModel;
    }
    if (['logic_analysis', 'deep_revision', 'teacher_report'].includes(taskType) && this.config.reasoningModel) {
      return this.config.reasoningModel;
    }
    return this.config?.model || '';
  }

  normalizeError(error) {
    const classified = classifyAIError(error);
    return new AIServiceError(safeChineseMessage(classified.code), {
      code: classified.code,
      provider: classified.provider || this.getProviderName(),
      model: classified.model || this.getModelName(),
      requestId: classified.requestId || '',
      status: classified.status || statusForAIError(classified.code)
    });
  }

  async requestJson(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, { ...options, signal: controller.signal });
      if (!response.ok) {
        const detail = compactErrorDetail(await response.text());
        const code = classifyFailure(response.status, detail);
        throw new AIServiceError(`${this.getProviderName()} API 调用失败：${response.status} ${detail.message}`, {
          code,
          provider: this.getProviderName(),
          model: this.getModelName(),
          requestId: extractRequestId(response),
          status: statusForAIError(code)
        });
      }
      return { data: await response.json(), requestId: extractRequestId(response) };
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new AIServiceError('AI 请求超时', {
          code: 'AI_TIMEOUT',
          provider: this.getProviderName(),
          model: this.getModelName(),
          status: 504
        });
      }
      if (error instanceof AIServiceError) throw error;
      throw this.normalizeError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck() {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    if (!this.isConfigured()) {
      const keyStatus = this.config?.keyStatus || 'MISSING';
      return {
        configured: false,
        connected: false,
        model: this.config?.model || '',
        latencyMs: 0,
        checkedAt,
        errorCode: keyStatus === 'INVALID_FORMAT' ? 'AI_PROVIDER_MISCONFIGURED' : 'AI_KEY_MISSING',
        message: keyStatus === 'INVALID_FORMAT' ? 'AI 服务配置格式错误' : 'AI 服务密钥未配置，请联系管理员。'
      };
    }
    try {
      await this.generateText({
        prompt: '只回复 OK',
        taskType: 'summary',
        maxTokens: 16
      });
      return {
        configured: true,
        connected: true,
        model: this.config.model,
        latencyMs: Date.now() - startedAt,
        checkedAt,
        errorCode: null,
        message: 'AI 服务连接正常'
      };
    } catch (error) {
      const classified = classifyAIError(error);
      return {
        configured: true,
        connected: false,
        model: this.config.model,
        latencyMs: Date.now() - startedAt,
        checkedAt,
        errorCode: classified.code,
        message: classified.message,
        requestId: classified.requestId || undefined
      };
    }
  }

  async generateText() {
    throw new AIServiceError('Provider 尚未实现 generateText', {
      code: 'AI_PROVIDER_MISCONFIGURED',
      provider: this.getProviderName(),
      status: 503
    });
  }

  async gradeEssay(options = {}) {
    return this.generateText({ ...options, taskType: options.taskType || 'essay_grading' });
  }
}
