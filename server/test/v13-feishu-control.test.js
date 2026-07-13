import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  classifyFeishuHealth,
  detectMissingFeishuEnv,
  getFeishuControlPaths
} from '../../ops/scripts/feishu-control.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('feishu control detects missing app env vars without exposing secrets', () => {
  assert.deepEqual(
    detectMissingFeishuEnv({
      FEISHU_APP_ID: '',
      FEISHU_APP_SECRET: 'secret-value',
      FEISHU_WEBHOOK_URL: ''
    }),
    ['FEISHU_APP_ID']
  );
});

test('feishu control builds pid and log paths inside workspace logs directory', () => {
  const paths = getFeishuControlPaths({ appDir: rootDir });
  assert.match(paths.logPath, /logs\/feishu-connect\.log$/);
  assert.match(paths.pidPath, /logs\/feishu-connect\.pid$/);
});

test('feishu control classifies missing env and websocket failures', () => {
  const missing = classifyFeishuHealth({
    healthUrl: 'http://127.0.0.1:4000/api/feishu/health',
    response: {
      status: 200,
      bodyText: JSON.stringify({
        appConfigured: false,
        connected: false,
        connectionMode: 'websocket',
        connectionState: 'idle',
        lastError: ''
      })
    },
    env: {
      FEISHU_APP_ID: '',
      FEISHU_APP_SECRET: '',
      FEISHU_WEBHOOK_URL: ''
    }
  });
  assert.equal(missing.kind, 'environment_missing');
  assert.deepEqual(missing.missingEnv, ['FEISHU_APP_ID', 'FEISHU_APP_SECRET']);

  const websocket = classifyFeishuHealth({
    healthUrl: 'http://127.0.0.1:4000/api/feishu/health',
    response: {
      status: 200,
      bodyText: JSON.stringify({
        appConfigured: true,
        connected: false,
        connectionMode: 'websocket',
        connectionState: 'failed',
        lastError: 'WebSocket handshake timeout'
      })
    },
    env: {
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret'
    }
  });
  assert.equal(websocket.kind, 'websocket_failed');
  assert.match(websocket.reason, /WebSocket/);
});

test('feishu connect wrapper no longer depends on launchctl', () => {
  const source = fs.readFileSync(path.join(rootDir, 'ops/scripts/feishu-connect.sh'), 'utf8');
  assert.doesNotMatch(source, /launchctl/);
  assert.match(source, /feishu-control\.mjs/);
});
