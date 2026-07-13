import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const AI_KEYS = [
  'AI_PROVIDER',
  'AI_ROUTER_ENABLED',
  'AI_DEFAULT_PROVIDER',
  'AI_PRIMARY_PROVIDER',
  'AI_FALLBACK_PROVIDER',
  'AI_FALLBACK_ENABLED',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_FAST_MODEL',
  'OPENAI_REASONING_MODEL',
  'OPENAI_BASE_URL',
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_MODEL',
  'DEEPSEEK_FAST_MODEL',
  'DEEPSEEK_REASONING_MODEL',
  'DEEPSEEK_BASE_URL'
];

function stripOuterQuotes(value) {
  const text = String(value ?? '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).trim();
  }
  return text;
}

export function normalizeEnvValue(value) {
  return stripOuterQuotes(value);
}

export function keyStatus(value) {
  if (value === undefined) return 'MISSING';
  if (String(value) === '') return 'EMPTY';
  const normalized = normalizeEnvValue(value);
  if (!normalized) return 'EMPTY';
  if (/\r|\n|\\n/.test(String(value))) return 'INVALID_FORMAT';
  if (/^Bearer\s+/i.test(normalized)) return 'INVALID_FORMAT';
  if (/^your-|your-.*-key/i.test(normalized)) return 'INVALID_FORMAT';
  return 'SET';
}

export function summarizeAIEnv(env = process.env) {
  const summary = {};
  for (const key of AI_KEYS) {
    const value = env[key];
    summary[key] = /API_KEY/.test(key) ? keyStatus(value) : (value == null || value === '' ? 'MISSING' : normalizeEnvValue(value));
  }
  return summary;
}

function loadFileIntoEnv(filePath, targetEnv) {
  if (!fs.existsSync(filePath)) return { file: path.basename(filePath), loaded: false, path: filePath };
  const parsed = dotenv.parse(fs.readFileSync(filePath));
  for (const [key, value] of Object.entries(parsed)) {
    if (targetEnv[key] == null) targetEnv[key] = value;
  }
  return { file: path.basename(filePath), loaded: true, path: filePath };
}

export function plannedEnvFiles({ appDir = path.resolve(process.cwd()), nodeEnv = process.env.NODE_ENV } = {}) {
  if (nodeEnv === 'test') return [];
  if (nodeEnv === 'production') return ['.env.production'];
  return ['.env.local', '.env'];
}

export function loadServerEnv({
  appDir = path.resolve(process.cwd()),
  nodeEnv = process.env.NODE_ENV,
  env = process.env,
  files = plannedEnvFiles({ appDir, nodeEnv })
} = {}) {
  const loaded = files.map((file) => loadFileIntoEnv(path.join(appDir, file), env));
  env.__AI_ENV_FILES_LOADED = loaded.filter((item) => item.loaded).map((item) => item.file).join(',') || 'none';
  return { env, loaded };
}

export function getLoadedEnvFile(env = process.env) {
  return env.__AI_ENV_FILES_LOADED || 'process';
}
