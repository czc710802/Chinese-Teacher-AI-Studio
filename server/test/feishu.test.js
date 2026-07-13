import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import test from 'node:test';

import { loadFeishuConfig } from '../src/integrations/feishu/config.js';
import { parseFeishuCommand } from '../src/integrations/feishu/commands.js';
import { buildHelpCard, buildStatusCard, buildDailyReportCard, buildLogsCard } from '../src/integrations/feishu/cards.js';
import { verifyFeishuEvent } from '../src/integrations/feishu/verify.js';
import { createApp } from '../src/app.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function invoke(app, { method = 'GET', url = '/', body = null } = {}) {
  return await new Promise((resolve, reject) => {
    const req = new Readable({ read() {} });
    req.method = method;
    req.url = url;
    req.headers = body ? { 'content-type': 'application/json' } : {};
    req.socket = { encrypted: false };
    req.connection = req.socket;

    const res = {
      statusCode: 200,
      headers: {},
      chunks: [],
      setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = value;
      },
      getHeader(name) {
        return this.headers[String(name).toLowerCase()];
      },
      removeHeader(name) {
        delete this.headers[String(name).toLowerCase()];
      },
      writeHead(statusCode, headers = {}) {
        this.statusCode = statusCode;
        for (const [key, value] of Object.entries(headers)) {
          this.setHeader(key, value);
        }
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.setHeader('content-type', 'application/json; charset=utf-8');
        this.end(JSON.stringify(payload));
        return this;
      },
      send(payload) {
        if (Buffer.isBuffer(payload)) {
          this.end(payload);
          return this;
        }
        if (typeof payload === 'object') {
          return this.json(payload);
        }
        this.end(String(payload));
        return this;
      },
      write(chunk) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      },
      end(chunk) {
        if (chunk) this.write(chunk);
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: Buffer.concat(this.chunks).toString('utf8')
        });
      }
    };

    if (body) {
      process.nextTick(() => {
        req.push(JSON.stringify(body));
        req.push(null);
      });
    } else {
      process.nextTick(() => req.push(null));
    }

    try {
      app.handle(req, res, (err) => {
        if (err) reject(err);
      });
    } catch (error) {
      reject(error);
    }
  });
}

test('feishu example env exposes all required keys', () => {
  const example = fs.readFileSync(path.join(rootDir, '.env.production.example'), 'utf8');
  for (const key of [
    'FEISHU_APP_ID=',
    'FEISHU_APP_SECRET=',
    'FEISHU_VERIFICATION_TOKEN=',
    'FEISHU_ENCRYPT_KEY=',
    'FEISHU_WEBHOOK_URL=',
    'FEISHU_SECRET=',
    'FEISHU_BOT_NAME=Chinese Teacher AI Studio',
    'FEISHU_REPLY_MODE=send',
    'FEISHU_TEST_CHAT_ID=',
  ]) {
    assert.match(example, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('feishu config reads app and webhook credentials from env', () => {
  const config = loadFeishuConfig({
    FEISHU_APP_ID: 'app-id',
    FEISHU_APP_SECRET: 'app-secret',
    FEISHU_VERIFICATION_TOKEN: 'verify-token',
    FEISHU_ENCRYPT_KEY: 'encrypt-key',
    FEISHU_WEBHOOK_URL: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc',
    FEISHU_SECRET: 'secret',
    FEISHU_BOT_NAME: 'Chinese Teacher AI Studio'
  });

  assert.equal(config.appId, 'app-id');
  assert.equal(config.appConfigured, true);
  assert.equal(config.webhookConfigured, true);
  assert.equal(config.botName, 'Chinese Teacher AI Studio');
  assert.equal(config.replyMode, 'send');
  assert.equal(loadFeishuConfig({ FEISHU_REPLY_MODE: 'reply' }).replyMode, 'reply');
  assert.equal(loadFeishuConfig({ FEISHU_REPLY_MODE: 'send' }).replyMode, 'send');
});

test('feishu send test script sends text markdown and card with response fields', () => {
  const script = fs.readFileSync(path.join(rootDir, 'ops/scripts/feishu-send-test.mjs'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

  assert.equal(pkg.scripts['feishu:send-test'], 'node ops/scripts/feishu-send-test.mjs');
  assert.match(script, /AI 已收到作文。/);
  assert.match(script, /sendTextProbe/);
  assert.match(script, /sendMarkdownProbe/);
  assert.match(script, /sendCardProbe/);
  assert.match(script, /FEISHU_TEST_CHAT_ID/);
  assert.match(script, /data_message_id/);
  assert.match(script, /request_id/);
});

test('feishu commands normalize help, status, report, backup, logs and prelaunch entries', () => {
  assert.equal(parseFeishuCommand('帮助').key, 'help');
  assert.equal(parseFeishuCommand('/status').key, 'status');
  assert.equal(parseFeishuCommand('日报').key, 'daily');
  assert.equal(parseFeishuCommand('/backup').key, 'backup');
  assert.equal(parseFeishuCommand('日志').key, 'logs');
  assert.equal(parseFeishuCommand('作文').key, 'essay');
  assert.equal(parseFeishuCommand('试卷').key, 'paper');
  assert.equal(parseFeishuCommand('PPT').key, 'ppt');
  assert.equal(parseFeishuCommand('晨报').key, 'morning');
  assert.equal(parseFeishuCommand('/restart').key, 'restart');

  const fallback = parseFeishuCommand('随机内容');
  assert.equal(fallback.key, 'unknown');
});

test('feishu cards expose the studio title and expected sections', () => {
  assert.match(JSON.stringify(buildHelpCard()), /Chinese Teacher AI Studio/);
  assert.match(JSON.stringify(buildStatusCard({ version: '11.0.0' })), /Chinese Teacher AI Studio/);
  assert.match(JSON.stringify(buildDailyReportCard({ reportPath: '/tmp/report.md' })), /Chinese Teacher AI Studio/);
  assert.match(JSON.stringify(buildLogsCard({ summary: 'error' })), /Chinese Teacher AI Studio/);
});

test('feishu verification echoes the challenge token', () => {
  const result = verifyFeishuEvent({
    body: {
      challenge: 'abc123',
      type: 'url_verification',
      token: 'verify-token'
    },
    config: { verificationToken: 'verify-token' }
  });

  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { challenge: 'abc123' });
});

test('feishu api exposes health and system status endpoints', async () => {
  const app = createApp({
    env: {
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret',
      FEISHU_VERIFICATION_TOKEN: 'verify-token',
      FEISHU_ENCRYPT_KEY: 'encrypt-key',
      FEISHU_WEBHOOK_URL: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc',
      FEISHU_SECRET: 'secret',
      FEISHU_BOT_NAME: 'Chinese Teacher AI Studio'
    }
  });

  const health = await invoke(app, { method: 'GET', url: '/api/feishu/health' });
  const healthJson = JSON.parse(health.body);
  assert.equal(health.statusCode, 200);
  assert.equal(healthJson.ok, true);
  assert.equal(healthJson.appConfigured, true);
  assert.equal(healthJson.webhookConfigured, true);

  const status = await invoke(app, { method: 'GET', url: '/api/system/status' });
  const statusJson = JSON.parse(status.body);
  assert.equal(status.statusCode, 200);
  for (const key of [
    'version',
    'uptime',
    'nodeStatus',
    'cloudflaredStatus',
    'watchdogStatus',
    'localHealth',
    'publicHealth',
    'latestBackup',
    'latestDailyReport',
    'diskUsage',
    'timestamp'
  ]) {
    assert.ok(key in statusJson, `${key} should exist`);
  }
});
