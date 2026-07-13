import { BaseAIProvider } from './base-provider.js';

export class DeepSeekProvider extends BaseAIProvider {
  getProviderName() {
    return 'deepseek';
  }

  async generateText({
    prompt,
    messages,
    taskType = 'general',
    jsonMode = false,
    maxTokens = 1200,
    temperature = 0.2
  } = {}) {
    const model = this.getModelName(taskType);
    const body = {
      model,
      messages: messages || [{ role: 'user', content: String(prompt || '') }],
      temperature,
      max_tokens: maxTokens,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
    };
    const { data, requestId } = await this.requestJson(this.config.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    return {
      text: data.choices?.[0]?.message?.content || '',
      provider: this.getProviderName(),
      model,
      requestId
    };
  }
}

export function createDeepSeekProvider(options = {}) {
  return new DeepSeekProvider(options);
}
