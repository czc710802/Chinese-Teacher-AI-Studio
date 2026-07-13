import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadServerEnv, summarizeAIEnv } from './config/env.js';
import { publicAIConfigSummary } from './config/ai-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');
loadServerEnv({ appDir, nodeEnv: process.env.NODE_ENV || 'production' });
const aiEnvSummary = summarizeAIEnv(process.env);
const aiConfigSummary = publicAIConfigSummary(process.env);
console.log('[AI ENV]', JSON.stringify({
  envFile: process.env.__AI_ENV_FILES_LOADED || 'process',
  AI_ROUTER_ENABLED: aiEnvSummary.AI_ROUTER_ENABLED,
  AI_PRIMARY_PROVIDER: aiConfigSummary.primaryProvider,
  AI_FALLBACK_PROVIDER: aiConfigSummary.fallbackProvider,
  AI_FALLBACK_ENABLED: aiConfigSummary.fallbackEnabled,
  OPENAI_API_KEY: aiEnvSummary.OPENAI_API_KEY,
  OPENAI_MODEL: aiEnvSummary.OPENAI_MODEL,
  OPENAI_BASE_URL: aiEnvSummary.OPENAI_BASE_URL,
  DEEPSEEK_API_KEY: aiEnvSummary.DEEPSEEK_API_KEY,
  DEEPSEEK_MODEL: aiEnvSummary.DEEPSEEK_MODEL,
  DEEPSEEK_BASE_URL: aiEnvSummary.DEEPSEEK_BASE_URL
}));

const { initDatabase } = await import('./db/init.js');
const { createApp } = await import('./app.js');
initDatabase();

const app = createApp({ env: process.env, appDir, startTime: Date.now() });
// app.get('/api/health') is registered inside createApp().
// res.json({ ok: true, name: '高中作文 AI 批改 App' ... }) is also returned there.
const port = process.env.PORT || 4000;
const host = process.env.HOST || '0.0.0.0';
const feishuService = app.locals.feishuService;
const feishuPidFile = String(process.env.FEISHU_PID_FILE || '').trim();

function writePidFile() {
  if (!feishuPidFile) return;
  try {
    fs.mkdirSync(path.dirname(feishuPidFile), { recursive: true });
    fs.writeFileSync(feishuPidFile, `${process.pid}\n`, 'utf8');
  } catch (error) {
    console.error('[Feishu] write pid file failed:', error?.message || error);
  }
}

function removePidFile() {
  if (!feishuPidFile) return;
  try {
    if (fs.existsSync(feishuPidFile)) {
      const current = fs.readFileSync(feishuPidFile, 'utf8').trim();
      if (current === String(process.pid)) {
        fs.unlinkSync(feishuPidFile);
      }
    }
  } catch {
    // ignore cleanup failures
  }
}

app.listen(port, host, () => {
  console.log(`Essay review server running at http://${host}:${port}`);
  writePidFile();
  if (feishuService) {
    feishuService.connect().catch((error) => {
      console.error('[Feishu] connect failed:', error?.message || error);
    });
  }
});

process.on('SIGINT', async () => {
  try {
    await feishuService?.close?.({ force: true });
  } catch {
    // ignore shutdown errors
  }
  removePidFile();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  try {
    await feishuService?.close?.({ force: true });
  } catch {
    // ignore shutdown errors
  }
  removePidFile();
  process.exit(0);
});

process.on('exit', removePidFile);
