import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EventDispatcher,
  LoggerLevel,
  WSClient
} from '@larksuiteoapi/node-sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');
const envPath = path.join(appDir, '.env.production');

function parseEnvFile(filePath) {
  const result = {};
  if (!fs.existsSync(filePath)) return result;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex < 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

const fileEnv = parseEnvFile(envPath);
const appId = String(process.env.FEISHU_APP_ID || fileEnv.FEISHU_APP_ID || fileEnv.APP_ID || '').trim();
const appSecret = String(process.env.FEISHU_APP_SECRET || fileEnv.FEISHU_APP_SECRET || fileEnv.APP_SECRET || '').trim();

if (!appId || !appSecret) {
  console.error('[MINIMAL] missing FEISHU_APP_ID / FEISHU_APP_SECRET from .env.production');
  process.exit(1);
}

const dispatcher = new EventDispatcher({
  loggerLevel: LoggerLevel.info
});

dispatcher.register({
  'im.message.receive_v1': async (event) => {
    console.log('[MINIMAL MESSAGE RECEIVED]');
    console.log(JSON.stringify(event?.header || {}, null, 2));
    console.log(JSON.stringify(event?.event?.sender || {}, null, 2));
    console.log(JSON.stringify(event?.event?.message || {}, null, 2));
  }
});

const wsClient = new WSClient({
  appId,
  appSecret,
  loggerLevel: LoggerLevel.info,
  autoReconnect: true,
  source: 'feishu-minimal-listener',
  handshakeTimeoutMs: 15000,
  onReady: () => {
    console.log('[MINIMAL] ws ready');
  },
  onError: (error) => {
    console.error('[MINIMAL] ws error', error?.message || error);
  },
  onReconnecting: () => {
    console.log('[MINIMAL] reconnecting');
  },
  onReconnected: () => {
    console.log('[MINIMAL] reconnected');
  }
});

wsClient.start({ eventDispatcher: dispatcher });

process.on('SIGINT', () => {
  try {
    wsClient.close({ force: true });
  } catch {
    // ignore
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  try {
    wsClient.close({ force: true });
  } catch {
    // ignore
  }
  process.exit(0);
});

