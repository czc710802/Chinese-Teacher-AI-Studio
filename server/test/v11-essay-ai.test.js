import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createApp } from '../src/app.js';
import { parseFeishuCommand } from '../src/integrations/feishu/commands.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function invoke(app, { method = 'GET', url = '/', body = null, headers = {} } = {}) {
  return await new Promise((resolve, reject) => {
    const req = new Readable({ read() {} });
    req.method = method;
    req.url = url;
    const requestHeaders = { ...headers };
    let bodyBuffer = null;
    if (body != null) {
      if (Buffer.isBuffer(body)) {
        bodyBuffer = body;
      } else if (typeof body === 'string') {
        bodyBuffer = Buffer.from(body);
      } else {
        bodyBuffer = Buffer.from(JSON.stringify(body));
        if (!requestHeaders['content-type']) {
          requestHeaders['content-type'] = 'application/json';
        }
      }
      requestHeaders['content-length'] = String(bodyBuffer.length);
    }
    req.headers = requestHeaders;
    req.socket = new Readable({ read() {} });
    req.socket.encrypted = false;
    req.socket.destroy = () => {};
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

    const pushBody = () => {
      if (bodyBuffer == null) {
        req.push(null);
        return;
      }
      req.push(bodyBuffer);
      req.push(null);
    };

    process.nextTick(pushBody);

    try {
      app.handle(req, res, (err) => {
        if (err) reject(err);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function buildMultipart({ fields = {}, files = [] } = {}) {
  const boundary = `----CodexBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(`--${boundary}\r\n`);
    chunks.push(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
    chunks.push(`${value}\r\n`);
  }
  for (const file of files) {
    chunks.push(`--${boundary}\r\n`);
    chunks.push(`Content-Disposition: form-data; name="${file.fieldName || 'files'}"; filename="${file.filename}"\r\n`);
    chunks.push(`Content-Type: ${file.contentType || 'application/octet-stream'}\r\n\r\n`);
    chunks.push(file.content);
    chunks.push('\r\n');
  }
  chunks.push(`--${boundary}--\r\n`);
  return {
    body: Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))),
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`
    }
  };
}

test('feishu command parser recognizes essay text that starts with 作文', () => {
  const command = parseFeishuCommand('作文：青年应在时代中寻找自己的位置。');
  assert.equal(command.key, 'essay');
  assert.equal(command.text, '青年应在时代中寻找自己的位置。');
});

test('essay analyze endpoint returns a completed task and structured result', async () => {
  const app = createApp({ env: {} });
  const response = await invoke(app, {
    method: 'POST',
    url: '/api/essay/analyze',
    headers: { 'content-type': 'application/json' },
    body: {
      title: '出发与到达',
      text: '青年应在时代中寻找自己的位置。有人说出发比到达更重要，也有人说结果才是努力的证明。对此你怎么看？'
    }
  });

  assert.equal(response.statusCode, 200);
  const data = JSON.parse(response.body);
  assert.match(String(data.id || ''), /./);
  assert.equal(data.status, 'completed');
  assert.equal(data.source, 'api');
  assert.ok(data.result);
  assert.equal(data.result.fullScore, 60);
  assert.ok(data.result.totalScore > 0);
  assert.equal(data.result.level, '二类文');
  assert.ok(Array.isArray(data.result.dimensionScores));
  assert.ok(data.result.teacherComment);

  const resultResponse = await invoke(app, {
    method: 'GET',
    url: `/api/essay/result/${data.id}`
  });
  assert.equal(resultResponse.statusCode, 200);
  const resultData = JSON.parse(resultResponse.body);
  assert.equal(resultData.id, data.id);
  assert.equal(resultData.status, 'completed');
});

test('essay upload endpoint accepts a text file and saves a record', async () => {
  const app = createApp({ env: {} });
  const multipart = buildMultipart({
    fields: {
      title: '上传作文',
      source: 'upload'
    },
    files: [
      {
        fieldName: 'files',
        filename: 'essay.txt',
        contentType: 'text/plain',
        content: '青年应在时代中寻找自己的位置。'
      }
    ]
  });

  const response = await invoke(app, {
    method: 'POST',
    url: '/api/essay/upload',
    headers: multipart.headers,
    body: multipart.body
  });

  assert.equal(response.statusCode, 200);
  const data = JSON.parse(response.body);
  assert.match(String(data.id || ''), /./);
  assert.equal(data.status, 'completed');
  assert.ok(Array.isArray(data.files));
  assert.equal(data.files[0].filename, 'essay.txt');
  assert.match(data.files[0].path, /uploads\/essay-ai/);

  const historyResponse = await invoke(app, { method: 'GET', url: '/api/essay/history' });
  assert.equal(historyResponse.statusCode, 200);
  const history = JSON.parse(historyResponse.body);
  assert.ok(Array.isArray(history.items));
  assert.ok(history.items.length > 0);
  const latest = history.items[0];
  assert.equal(latest.status, 'completed');
  assert.match(String(latest.id || ''), /./);
});

test('feishu essay text message returns a result summary card payload', async () => {
  const app = createApp({
    env: {
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret',
      FEISHU_VERIFICATION_TOKEN: 'verify-token',
      FEISHU_WEBHOOK_URL: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc',
      FEISHU_SECRET: 'secret'
    }
  });

  const response = await invoke(app, {
    method: 'POST',
    url: '/api/feishu/events',
    headers: { 'content-type': 'application/json' },
    body: {
      type: 'event_callback',
      event: {
        message: {
          message_type: 'text',
          content: JSON.stringify({ text: '/essay 出发比到达更重要，还是到达更重要？' })
        }
      }
    }
  });

  assert.equal(response.statusCode, 200);
  const data = JSON.parse(response.body);
  assert.equal(data.ok, true);
  assert.equal(data.command, 'essay');
  assert.match(String(data.message || ''), /作文 AI 批改结果|completed|已收到/);
});
