#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadServerEnv, summarizeAIEnv } from '../../server/src/config/env.js';
import { publicAIConfigSummary } from '../../server/src/config/ai-config.js';
import { createAIRouter } from '../../server/src/services/ai/ai-router.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');
const providerArgIndex = process.argv.findIndex((arg) => arg === '--provider');
const provider = providerArgIndex >= 0 ? String(process.argv[providerArgIndex + 1] || '').trim().toLowerCase() : '';

loadServerEnv({ appDir, nodeEnv: 'production' });

const envSummary = summarizeAIEnv(process.env);
const config = publicAIConfigSummary(process.env);
const router = createAIRouter({ env: process.env, timeoutMs: config.timeoutMs });
const status = await router.getRouterStatus({
  checkConnections: true,
  provider: ['openai', 'deepseek'].includes(provider) ? provider : ''
});

console.log('AI Router:', status.routerEnabled ? 'ENABLED' : 'DISABLED');
console.log('Default mode:', config.defaultProvider);
console.log('ENV_FILE:', process.env.__AI_ENV_FILES_LOADED || 'none');
console.log('');

console.log(JSON.stringify({
  envFile: process.env.__AI_ENV_FILES_LOADED || 'none',
  AI_ROUTER_ENABLED: config.routerEnabled,
  AI_PRIMARY_PROVIDER: config.primaryProvider,
  AI_FALLBACK_PROVIDER: config.fallbackProvider,
  AI_FALLBACK_ENABLED: config.fallbackEnabled,
  OPENAI_API_KEY: envSummary.OPENAI_API_KEY,
  OPENAI_MODEL: envSummary.OPENAI_MODEL,
  OPENAI_BASE_URL: envSummary.OPENAI_BASE_URL,
  DEEPSEEK_API_KEY: envSummary.DEEPSEEK_API_KEY,
  DEEPSEEK_MODEL: envSummary.DEEPSEEK_MODEL,
  DEEPSEEK_BASE_URL: envSummary.DEEPSEEK_BASE_URL
}, null, 2));
console.log('');

for (const [name, providerStatus] of Object.entries(status.providers)) {
  console.log(`${name === 'openai' ? 'OpenAI' : 'DeepSeek'}:`);
  console.log(`enabled=${providerStatus.enabled !== false}`);
  if (providerStatus.status) console.log(`status=${providerStatus.status}`);
  console.log(`configured=${providerStatus.configured}`);
  console.log(`connected=${providerStatus.connected}`);
  console.log(`model=${providerStatus.model || ''}`);
  if (providerStatus.latencyMs != null) console.log(`latencyMs=${providerStatus.latencyMs}`);
  if (providerStatus.errorCode) console.log(`errorCode=${providerStatus.errorCode}`);
  console.log('');
}

if (!provider) {
  console.log('Routing:');
  for (const [taskType, routeProvider] of Object.entries(status.routes)) {
    console.log(`${taskType}=${routeProvider}`);
  }
  console.log(`fallback=${config.fallbackEnabled}`);
  console.log('');
}

console.log('Overall:');
console.log(`ready=${status.ready}`);
console.log(`degraded=${status.degraded}`);
console.log(`primaryProvider=${status.primaryProvider}`);
console.log(`fallbackEnabled=${status.fallbackEnabled}`);

if (!status.ready) process.exit(1);
if (provider && !status.providers[provider]?.connected) process.exit(1);
