import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createApp } from '../src/app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');

async function startServer(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function request(baseUrl, { method = 'GET', url = '/', body = null } = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  return {
    statusCode: response.status,
    body: await response.text()
  };
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
  const { server, baseUrl } = await startServer(app);
  try {
    const feishuHealth = await request(baseUrl, { url: '/api/feishu/health' });
    const status = JSON.parse(feishuHealth.body);
    assert.equal(feishuHealth.statusCode, 200);
    assert.equal(status.ok, true);
    assert.ok('appConfigured' in status);
    assert.ok('webhookConfigured' in status);

    const systemStatus = await request(baseUrl, { url: '/api/system/status' });
    const systemJson = JSON.parse(systemStatus.body);
    for (const key of ['server', 'cloudflaredStatus', 'watchdogStatus', 'backup', 'resourceMonitor', 'dailyReport', 'localHealth', 'publicHealth', 'latestBackup', 'latestDailyReport', 'diskUsage', 'timestamp']) {
      assert.ok(key in systemJson, `${key} should exist`);
    }

    const logs = await request(baseUrl, { url: '/api/system/logs' });
    const logsJson = JSON.parse(logs.body);
    assert.equal(logs.statusCode, 200);
    assert.ok('summary' in logsJson);

    const report = await request(baseUrl, { url: '/api/system/daily-report' });
    const reportJson = JSON.parse(report.body);
    assert.equal(report.statusCode, 200);
    assert.ok('summary' in reportJson);

    const backup = await request(baseUrl, { method: 'POST', url: '/api/system/backup', body: {} });
    const backupJson = JSON.parse(backup.body);
    assert.ok('ok' in backupJson);

    const restart = await request(baseUrl, { method: 'POST', url: '/api/system/restart/confirm', body: { token: 'wrong-token' } });
    const restartJson = JSON.parse(restart.body);
    assert.ok('ok' in restartJson);
    assert.equal(restartJson.ok, false);

    const challenge = await request(baseUrl, {
      method: 'POST',
      url: '/api/feishu/events',
      body: { type: 'url_verification', challenge: 'abc123', token: 'verify-token' }
    });
    assert.deepEqual(JSON.parse(challenge.body), { challenge: 'abc123' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
