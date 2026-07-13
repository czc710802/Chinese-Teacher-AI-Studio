import { BaseAIProvider } from './base-provider.js';

function extractOutputText(data) {
  if (data.output_text) return data.output_text;
  const parts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.text) parts.push(content.text);
    }
  }
  return parts.join('\n');
}

export class OpenAIProvider extends BaseAIProvider {
  getProviderName() {
    return 'openai';
  }

  async generateText({
    prompt,
    messages,
    taskType = 'general',
    jsonMode = false,
    maxTokens = 1200,
    temperature
  } = {}) {
    const model = this.getModelName(taskType);
    const input = messages || [{ role: 'user', content: [{ type: 'input_text', text: String(prompt || '') }] }];
    const body = {
      model,
      input,
      max_output_tokens: maxTokens
    };
    if (typeof temperature === 'number') body.temperature = temperature;
    if (jsonMode) {
      body.text = { format: { type: 'json_object' } };
    }
    const { data, requestId } = await this.requestJson(this.config.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    return {
      text: extractOutputText(data),
      provider: this.getProviderName(),
      model,
      requestId
    };
  }
}

export function createOpenAIProvider(options = {}) {
  return new OpenAIProvider(options);
}
