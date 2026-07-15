import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Readable } from 'node:stream';

import { createApp } from '../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');

async function request(app, { method = 'GET', url = '/', body = null } = {}) {
  return await new Promise((resolve, reject) => {
    const req = new Readable({ read() {} });
    req.method = method;
    req.url = url;
    req.headers = body ? { 'content-type': 'application/json' } : {};
    req.socket = { remoteAddress: '127.0.0.1', encrypted: false, destroy() {} };
    req.connection = req.socket;
    process.nextTick(() => {
      if (body) req.push(JSON.stringify(body));
      req.push(null);
    });
    const res = {
      statusCode: 200,
      headers: {},
      chunks: [],
      setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
      getHeader(name) { return this.headers[String(name).toLowerCase()]; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.setHeader('content-type', 'application/json; charset=utf-8'); this.end(JSON.stringify(payload)); return this; },
      send(payload) { this.end(typeof payload === 'string' ? payload : JSON.stringify(payload)); return this; },
      write(chunk) { this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); },
      end(chunk) {
        if (chunk) this.write(chunk);
        resolve({ statusCode: this.statusCode, body: Buffer.concat(this.chunks).toString('utf8') });
      }
    };
    try {
      app.handle(req, res, (err) => err ? reject(err) : null);
    } catch (error) {
      reject(error);
    }
  });
}

test('production app exposes the V11.1 system and Feishu endpoints', async () => {
  const app = createApp({
    appDir,
    env: {
      ...process.env,
      FEISHU_ADMIN_OPEN_IDS: 'open-1',
      FEISHU_RESTART_CONFIRM_TOKEN: 'confirm-token'
    }
  });
  const feishuHealth = await request(app, { url: '/api/feishu/health' });
  const status = JSON.parse(feishuHealth.body);
  assert.equal(feishuHealth.statusCode, 200);
  assert.equal(status.ok, true);
  assert.ok('appConfigured' in status);
  assert.ok('webhookConfigured' in status);

  const systemStatus = await request(app, { url: '/api/system/status' });
  const systemJson = JSON.parse(systemStatus.body);
  for (const key of ['server', 'cloudflaredStatus', 'watchdogStatus', 'backup', 'resourceMonitor', 'dailyReport', 'localHealth', 'publicHealth', 'latestBackup', 'latestDailyReport', 'diskUsage', 'timestamp']) {
    assert.ok(key in systemJson, `${key} should exist`);
  }

  const logs = await request(app, { url: '/api/system/logs' });
  const logsJson = JSON.parse(logs.body);
  assert.equal(logs.statusCode, 200);
  assert.ok('summary' in logsJson);

  const report = await request(app, { url: '/api/system/daily-report' });
  const reportJson = JSON.parse(report.body);
  assert.equal(report.statusCode, 200);
  assert.ok('summary' in reportJson);

  const backup = await request(app, { method: 'POST', url: '/api/system/backup', body: {} });
  const backupJson = JSON.parse(backup.body);
  assert.ok('ok' in backupJson);

  const restart = await request(app, { method: 'POST', url: '/api/system/restart/confirm', body: { token: 'wrong-token' } });
  const restartJson = JSON.parse(restart.body);
  assert.ok('ok' in restartJson);
  assert.equal(restartJson.ok, false);

  const challenge = await request(app, {
    method: 'POST',
    url: '/api/feishu/events',
    body: { type: 'url_verification', challenge: 'abc123', token: 'verify-token' }
  });
  const challengeJson = JSON.parse(challenge.body);
  assert.equal(challenge.statusCode, 200);
  assert.ok('ok' in challengeJson || 'challenge' in challengeJson);
});
