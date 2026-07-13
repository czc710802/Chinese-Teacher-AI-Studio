import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';

import { createApp } from '../src/app.js';
import { schemaSql } from '../src/db/schema.js';
import {
  archiveEssayToZSpace,
  buildFormalEssayArtifacts,
  createZSpaceClient,
  requiredZSpaceDirectories,
  retryPendingUploads,
  sanitizePathSegment,
  uploadFormalArtifact
} from '../src/services/zspace-storage.js';

function tempAppDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zspace-storage-'));
}

function response(status, body = '') {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return body;
    },
    async arrayBuffer() {
      const buffer = Buffer.from(body);
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    },
    async json() {
      return JSON.parse(body || '{}');
    }
  };
}

async function invoke(app, { method = 'GET', url = '/', headers = {} } = {}) {
  return await new Promise((resolve, reject) => {
    const req = new Readable({ read() {} });
    req.method = method;
    req.url = url;
    req.headers = headers;
    req.socket = { remoteAddress: '127.0.0.1', encrypted: false, destroy() {} };
    req.connection = req.socket;
    process.nextTick(() => req.push(null));

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
        this.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
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

    try {
      app.handle(req, res, (err) => {
        if (err) reject(err);
      });
    } catch (error) {
      reject(error);
    }
  });
}

test('sanitizePathSegment preserves Chinese and blocks path traversal characters', () => {
  assert.equal(sanitizePathSegment('高二/510\\张三:作文?*'), '高二510张三作文');
  assert.equal(sanitizePathSegment('../..'), '未填写');
  assert.equal(sanitizePathSegment('  '), '未填写');
});

test('createZSpaceClient validates required env without exposing credentials', () => {
  assert.throws(
    () => createZSpaceClient({ env: { ZSPACE_ENABLED: 'true', ZSPACE_WEBDAV_URL: 'ftp://192.168.100.164' } }),
    /ZSPACE_WEBDAV_URL/
  );
  assert.throws(
    () => createZSpaceClient({ env: { ZSPACE_ENABLED: 'true', ZSPACE_WEBDAV_URL: 'http://192.168.100.164:5005', ZSPACE_USERNAME: 'u' } }),
    /ZSPACE_WEBDAV_USERNAME|ZSPACE_WEBDAV_PASSWORD/
  );
});

test('testConnection performs write read delete before marking writable', async () => {
  const calls = [];
  const client = createZSpaceClient({
    env: {
      ZSPACE_ENABLED: 'true',
      ZSPACE_WEBDAV_URL: 'http://192.168.100.164:5005',
      ZSPACE_WEBDAV_USERNAME: 'teacher',
      ZSPACE_WEBDAV_PASSWORD: 'dummy-password',
      ZSPACE_ROOT_DIR: 'Chinese Teacher AI Studio',
      ZSPACE_TIMEOUT_MS: '1000'
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method, body: options.body ? String(options.body) : '' });
      if (options.method === 'PROPFIND') return response(207, '<d:multistatus />');
      if (options.method === 'MKCOL') return response(201);
      if (options.method === 'PUT') return response(201);
      if (options.method === 'GET') return response(200, calls.filter((call) => call.method === 'PUT').at(-1)?.body || '');
      if (options.method === 'DELETE') return response(204);
      return response(500);
    }
  });

  const status = await client.testConnection();

  assert.equal(status.connected, true);
  assert.equal(status.writable, true);
  assert.equal(JSON.stringify(status).includes('secret'), false);
  const methods = calls.map((call) => call.method).filter(Boolean);
  assert.ok(methods.indexOf('PUT') > methods.indexOf('PROPFIND'));
  assert.ok(methods.indexOf('GET') > methods.indexOf('PUT'));
  assert.ok(methods.indexOf('DELETE') > methods.indexOf('GET'));
});

test('ensureBaseDirectories creates the required ZSpace folders idempotently', async () => {
  const created = [];
  const client = createZSpaceClient({
    env: {
      ZSPACE_ENABLED: 'true',
      ZSPACE_WEBDAV_URL: 'http://192.168.100.164:5005',
      ZSPACE_WEBDAV_USERNAME: 'teacher',
      ZSPACE_WEBDAV_PASSWORD: 'dummy-password'
    },
    fetchImpl: async (_url, options = {}) => {
      if (options.method === 'PROPFIND') return response(404);
      if (options.method === 'MKCOL') {
        created.push(String(_url));
        return response(created.length % 2 === 0 ? 405 : 201);
      }
      return response(200);
    }
  });

  const result = await client.ensureBaseDirectories();

  assert.equal(result.total, requiredZSpaceDirectories().length);
  assert.equal(result.failed, 0);
  assert.equal(result.created + result.existed, requiredZSpaceDirectories().length);
});

test('archiveEssayToZSpace queues uploads when WebDAV is unreachable and does not throw', async () => {
  const appDir = tempAppDir();
  const database = new (await import('node:sqlite')).DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(schemaSql);
  const teacherUserId = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run('t', 'p', 'teacher', '陈老师').lastInsertRowid;
  const studentUserId = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run('s', 'p', 'student', '张三').lastInsertRowid;
  const teacherId = database.prepare('INSERT INTO teachers (user_id) VALUES (?)').run(teacherUserId).lastInsertRowid;
  const studentId = database.prepare('INSERT INTO students (user_id, student_no, grade) VALUES (?, ?, ?)').run(studentUserId, '1', '高二').lastInsertRowid;
  const classId = database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)').run('510班', '高二', teacherId).lastInsertRowid;
  const assignmentId = database.prepare('INSERT INTO assignments (class_id, title, prompt, essay_type) VALUES (?, ?, ?, ?)').run(classId, '出发与到达', '写作', '材料作文').lastInsertRowid;
  const essayId = database.prepare('INSERT INTO essays (assignment_id, student_id, title, original_text) VALUES (?, ?, ?, ?)').run(assignmentId, studentId, '青年/责任', '原文').lastInsertRowid;
  database.prepare('INSERT INTO ai_reviews (essay_id, total_score, level, dimension_scores, strengths, problems, paragraph_comments, editable_sentences, suggestions, upgraded_paragraph, good_sentences, next_training, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(essayId, 52, '一类文', '[]', '[]', '[]', '[]', '[]', '[]', '', '[]', '[]', JSON.stringify({ total_score: 52, level: '一类文' }));

  const result = await archiveEssayToZSpace({
    appDir,
    database,
    essayId,
    client: {
      config: { enabled: true },
      uploadBuffer: async () => {
        throw new Error('ECONNREFUSED 192.168.100.164');
      }
    }
  });

  const queuePath = path.join(appDir, 'data', 'storage-queue', 'zspace-pending.json');
  assert.equal(result.ok, false);
  assert.equal(result.queued, true);
  assert.equal(fs.existsSync(queuePath), true);
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
  assert.equal(queue.tasks.length > 0, true);
  assert.equal(JSON.stringify(queue).includes('secret'), false);
});

test('formal ZSpace essay archive uses the studio data-center directories', async () => {
  const appDir = tempAppDir();
  const database = new (await import('node:sqlite')).DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(schemaSql);
  const teacherUserId = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run('t2', 'p', 'teacher', '陈老师').lastInsertRowid;
  const studentUserId = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run('s2', 'p', 'student', '张三').lastInsertRowid;
  const teacherId = database.prepare('INSERT INTO teachers (user_id) VALUES (?)').run(teacherUserId).lastInsertRowid;
  const studentId = database.prepare('INSERT INTO students (user_id, student_no, grade) VALUES (?, ?, ?)').run(studentUserId, '001', '高二').lastInsertRowid;
  const classId = database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)').run('510班', '高二', teacherId).lastInsertRowid;
  const assignmentId = database.prepare('INSERT INTO assignments (class_id, title, prompt, essay_type) VALUES (?, ?, ?, ?)').run(classId, '出发与到达', '写作', '材料作文').lastInsertRowid;
  const essayId = database.prepare('INSERT INTO essays (assignment_id, student_id, title, original_text) VALUES (?, ?, ?, ?)').run(assignmentId, studentId, '青年责任', '原文').lastInsertRowid;
  database.prepare('INSERT INTO essay_images (essay_id, file_path, ocr_text, sort_order) VALUES (?, ?, ?, ?)').run(essayId, '/uploads/a.jpg', 'OCR文本', 0);
  database.prepare('INSERT INTO ai_reviews (essay_id, total_score, level, dimension_scores, strengths, problems, paragraph_comments, editable_sentences, suggestions, upgraded_paragraph, good_sentences, next_training, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(essayId, 52, '一类文', '[]', '[]', '[]', '[]', '[]', '[]', '', '[]', '[]', JSON.stringify({ total_score: 52, level: '一类文' }));
  database.prepare('INSERT INTO teacher_comments (essay_id, teacher_id, comment) VALUES (?, ?, ?)').run(essayId, teacherId, '教师点评');

  const { artifacts, context } = await buildFormalEssayArtifacts({ appDir, database, essayId });
  const paths = artifacts.map((artifact) => artifact.remotePath);

  assert.equal(context.studentFolder, '001_张三');
  assert.ok(paths.some((remotePath) => remotePath.startsWith('01_作文中心/原文/')));
  assert.ok(paths.some((remotePath) => remotePath.startsWith('01_作文中心/OCR文本/')));
  assert.ok(paths.some((remotePath) => remotePath.startsWith('01_作文中心/批改报告/')));
  assert.ok(paths.some((remotePath) => remotePath.startsWith('01_作文中心/PDF/')));
  assert.ok(paths.some((remotePath) => remotePath.startsWith('01_作文中心/Word/')));
  assert.ok(paths.some((remotePath) => remotePath.startsWith('08_OCR识别/')));
  assert.ok(paths.some((remotePath) => remotePath.startsWith('02_学生档案/001_张三/历次作文/')));
  assert.ok(paths.some((remotePath) => remotePath.startsWith('02_学生档案/001_张三/AI批改记录/')));
  assert.ok(paths.some((remotePath) => remotePath.startsWith('02_学生档案/001_张三/分数变化/')));
  assert.ok(paths.some((remotePath) => remotePath.startsWith('02_学生档案/001_张三/教师点评/')));
  assert.ok(artifacts.every((artifact) => Buffer.isBuffer(artifact.buffer)));
});

test('retryPendingUploads syncs queued formal storage payloads when NAS is back', async () => {
  const appDir = tempAppDir();
  const payloadDir = path.join(appDir, 'data', 'storage-queue', 'payloads');
  fs.mkdirSync(payloadDir, { recursive: true });
  const payloadPath = path.join(payloadDir, 'payload.txt');
  fs.writeFileSync(payloadPath, 'queued');
  fs.writeFileSync(path.join(appDir, 'data', 'storage-queue', 'zspace-pending.json'), JSON.stringify({
    version: 1,
    tasks: [{
      task_id: 'task-1',
      provider: 'zspace-webdav',
      remote_path: '11_系统日志/queued.txt',
      local_path: payloadPath,
      content_type: 'text/plain',
      status: 'pending',
      retry_count: 0,
      last_error: '',
      created_at: '2026-07-11T00:00:00.000Z',
      updated_at: '2026-07-11T00:00:00.000Z'
    }]
  }), 'utf8');
  const uploaded = [];
  const client = {
    config: { enabled: true },
    uploadBuffer: async (remotePath, buffer, contentType) => {
      uploaded.push({ remotePath, buffer: buffer.toString('utf8'), contentType });
      return { ok: true };
    }
  };

  const result = await retryPendingUploads({ appDir, client });

  assert.equal(result.synced, 1);
  assert.equal(uploaded[0].remotePath, '11_系统日志/queued.txt');
  const queue = JSON.parse(fs.readFileSync(path.join(appDir, 'data', 'storage-queue', 'zspace-pending.json'), 'utf8'));
  assert.equal(queue.tasks[0].status, 'synced');
});

test('uploadFormalArtifact queues teacher prep artifacts when NAS is offline', async () => {
  const appDir = tempAppDir();
  const result = await uploadFormalArtifact({
    appDir,
    client: {
      config: { enabled: true },
      uploadBuffer: async () => {
        throw new Error('ETIMEDOUT');
      }
    },
    category: 'teacherPrep',
    filename: '周报.json',
    data: { reportType: 'weekly' }
  });

  const queue = JSON.parse(fs.readFileSync(path.join(appDir, 'data', 'storage-queue', 'zspace-pending.json'), 'utf8'));
  assert.equal(result.queued, true);
  assert.equal(queue.tasks[0].remote_path, '03_教师备课/周报.json');
});

test('admin zspace status route returns safe writable status without secrets', async () => {
  const app = createApp({
    env: {
      NODE_ENV: 'test',
      ZSPACE_ENABLED: 'true',
      ZSPACE_WEBDAV_URL: 'http://192.168.100.164:5005',
      ZSPACE_WEBDAV_USERNAME: 'teacher',
      ZSPACE_WEBDAV_PASSWORD: 'dummy-password',
      ZSPACE_ROOT_DIR: 'Chinese Teacher AI Studio'
    },
    zspaceClient: {
      testConnection: async () => ({
        enabled: true,
        connected: true,
        writable: true,
        baseUrl: 'http://192.168.100.164:5005',
        rootDirectory: 'Chinese Teacher AI Studio',
        latencyMs: 12,
        checkedAt: '2026-07-11T00:00:00.000Z',
        error: null
      })
    }
  });

  const response = await invoke(app, { url: '/api/admin/storage/zspace/status' });
  const data = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(data.connected, true);
  assert.equal(data.writable, true);
  assert.equal(JSON.stringify(data).includes('dummy-password'), false);
  assert.equal(JSON.stringify(data).includes('Authorization'), false);
});
