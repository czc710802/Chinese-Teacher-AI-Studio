import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { createApp } from '../src/app.js';
import {
  createSignedDownloadUrl,
  createSignedReportUrl,
  verifySignedDownloadToken,
  buildArchiveDownloadLinks
} from '../src/services/file-access.js';
import { buildEssayResultCard } from '../src/integrations/feishu/cards.js';

function tempAppDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'feishu-file-access-'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function seedArchive(appDir) {
  writeJson(path.join(appDir, 'data/archive-records.json'), {
    version: 1,
    records: [{
      id: 'archive-中文-1',
      studentId: '20260301',
      studentName: '许伟航',
      className: '高二3班',
      essayTitle: '青年责任',
      createdAt: '2026-07-12T08:00:00.000Z',
      provider: 'deepseek',
      model: 'deepseek-chat',
      score: 48,
      grade: '二类文',
      archiveStatus: 'archived',
      nasPath: 'Archive/高二3班/20260301_许伟航/2026/2026-07/青年责任',
      files: [
        { name: 'report.md', remotePath: 'Archive/高二3班/20260301_许伟航/2026/2026-07/青年责任/report.md', contentType: 'text/markdown; charset=utf-8' },
        { name: 'report.json', remotePath: 'Archive/高二3班/20260301_许伟航/2026/2026-07/青年责任/report.json', contentType: 'application/json; charset=utf-8' },
        { name: 'report.docx', remotePath: 'Archive/高二3班/20260301_许伟航/2026/2026-07/青年责任/report.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
        { name: 'report.pdf', remotePath: 'Archive/高二3班/20260301_许伟航/2026/2026-07/青年责任/report.pdf', contentType: 'application/pdf' },
        { name: 'original.md', remotePath: 'Archive/高二3班/20260301_许伟航/2026/2026-07/青年责任/original.md', contentType: 'text/markdown; charset=utf-8' }
      ]
    }]
  });
}

function seedProfileArchive(appDir) {
  writeJson(path.join(appDir, 'data/student-profiles/510/2_林毅超/archive-index.json'), {
    items: [{
      archiveId: 'essay-56',
      essayId: '56',
      essayTitle: '飞书真实验证作文-0714',
      className: '510',
      studentId: '2',
      studentName: '林毅超',
      grade: '三类文',
      createdAt: '2026-07-14 05:47:30',
      nasPath: 'Archive/510/2_林毅超/2026/2026-07/飞书真实验证作文-0714',
      score: 42,
      level: '三类文',
      report: {
        score: 42,
        grade: '三类文',
        level: '三类文',
        overallEvaluation: '本文属于三类文。',
        strengths: ['观点明确'],
        problems: ['结构缺失'],
        suggestions: ['补充事例']
      }
    }]
  });
}

function createMockZspaceClient() {
  const files = new Map([
    ['report.md', Buffer.from('# 青年责任 教师可读批改报告\n\n## 核心优点\n- 观点明确\n\n## 主要问题\n- 论证展开不足\n\n## 下一步训练\n- 因果分析训练', 'utf8')],
    ['report.json', Buffer.from(JSON.stringify({
      score: 48,
      grade: '二类文',
      strengths: ['观点明确'],
      problems: ['论证展开不足'],
      logicAnalysis: '逻辑基本清楚',
      languageAnalysis: '表达较准确',
      intentAnalysis: '立意清楚',
      materialAnalysis: '素材可再充实',
      suggestions: ['补充时代材料'],
      trainingTasks: ['因果分析训练']
    }), 'utf8')],
    ['report.docx', Buffer.from('PK\u0003\u0004docx-content')],
    ['report.pdf', Buffer.from('%PDF-1.4\npdf-content')],
    ['original.md', Buffer.from('# 青年责任\n\n青年应当承担时代责任。', 'utf8')]
  ]);
  return {
    config: { enabled: true },
    async downloadFile(remotePath) {
      const name = path.posix.basename(remotePath);
      const file = files.get(name);
      if (!file) throw new Error('WebDAV 下载失败：HTTP 404');
      return file;
    },
    async fileExists(remotePath) {
      return files.has(path.posix.basename(remotePath));
    }
  };
}

async function invoke(app, { method = 'GET', url = '/', headers = {} } = {}) {
  return await new Promise((resolve, reject) => {
    const req = new Readable({ read() {} });
    req.method = method;
    req.url = url;
    req.headers = headers;
    req.socket = { encrypted: false };
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
      removeHeader(name) {
        delete this.headers[String(name).toLowerCase()];
      },
      writeHead(statusCode, nextHeaders = {}) {
        this.statusCode = statusCode;
        for (const [key, value] of Object.entries(nextHeaders)) this.setHeader(key, value);
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      type(value) {
        this.setHeader('content-type', value);
        return this;
      },
      json(payload) {
        this.setHeader('content-type', 'application/json; charset=utf-8');
        this.end(JSON.stringify(payload));
      },
      send(payload) {
        if (Buffer.isBuffer(payload)) {
          this.end(payload);
          return;
        }
        this.end(String(payload));
      },
      write(chunk) {
        this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      },
      end(chunk) {
        if (chunk) this.write(chunk);
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: Buffer.concat(this.chunks)
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

const env = {
  NODE_ENV: 'test',
  PUBLIC_APP_ORIGIN: 'https://pi.zhenwanyue.icu',
  FEISHU_FILE_LINK_SECRET: 'test-link-secret',
  FEISHU_FILE_LINK_TTL_SECONDS: '86400'
};

test('signed Feishu file URLs use public origin and reject bad tokens', () => {
  const url = createSignedDownloadUrl({ archiveId: 'archive-中文-1', fileType: 'pdf', userId: 'ou_test', env });
  assert.match(url, /^https:\/\/pi\.zhenwanyue\.icu\/api\/files\/archive-%E4%B8%AD%E6%96%87-1\/pdf\?token=/);
  assert.doesNotMatch(url, /localhost|127\.0\.0\.1|192\.168|webdav|file:\/\//i);

  const parsed = new URL(url);
  const valid = verifySignedDownloadToken({
    archiveId: 'archive-中文-1',
    fileType: 'pdf',
    token: parsed.searchParams.get('token'),
    env
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.userId, 'ou_test');

  const invalid = verifySignedDownloadToken({
    archiveId: 'archive-中文-1',
    fileType: 'docx',
    token: parsed.searchParams.get('token'),
    env
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.statusCode, 403);

  const expiredUrl = createSignedDownloadUrl({
    archiveId: 'archive-中文-1',
    fileType: 'pdf',
    userId: 'ou_test',
    expiresInSeconds: -1,
    env
  });
  const expired = verifySignedDownloadToken({
    archiveId: 'archive-中文-1',
    fileType: 'pdf',
    token: new URL(expiredUrl).searchParams.get('token'),
    env
  });
  assert.equal(expired.ok, false);
  assert.equal(expired.statusCode, 410);
});

test('file routes serve signed report, PDF and DOCX with MIME, filename and range support', async () => {
  const appDir = tempAppDir();
  seedArchive(appDir);
  const app = createApp({ env, appDir, zspaceClient: createMockZspaceClient(), logger: { error() {}, warn() {}, info() {} } });
  const pdfUrl = new URL(createSignedDownloadUrl({ archiveId: 'archive-中文-1', fileType: 'pdf', userId: 'ou_test', env }));
  const docxUrl = new URL(createSignedDownloadUrl({ archiveId: 'archive-中文-1', fileType: 'docx', userId: 'ou_test', env }));
  const reportUrl = new URL(createSignedReportUrl({ archiveId: 'archive-中文-1', userId: 'ou_test', env }));

  const pdf = await invoke(app, { url: `${pdfUrl.pathname}${pdfUrl.search}` });
  assert.equal(pdf.statusCode, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');
  assert.match(pdf.headers['content-disposition'], /filename\*=UTF-8''/);
  assert.match(pdf.headers['content-disposition'], /%E9%9D%92%E5%B9%B4%E8%B4%A3%E4%BB%BB/);
  assert.equal(pdf.body.toString('utf8', 0, 8), '%PDF-1.4');

  const docx = await invoke(app, { url: `${docxUrl.pathname}${docxUrl.search}` });
  assert.equal(docx.statusCode, 200);
  assert.equal(docx.headers['content-type'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

  const ranged = await invoke(app, { url: `${pdfUrl.pathname}${pdfUrl.search}`, headers: { range: 'bytes=0-3' } });
  assert.equal(ranged.statusCode, 206);
  assert.equal(ranged.headers['content-range'], `bytes 0-3/${pdf.body.length}`);
  assert.equal(ranged.body.toString(), '%PDF');

  const page = await invoke(app, { url: `${reportUrl.pathname}${reportUrl.search}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.body.toString('utf8'), /作文 AI 批改报告/);
  assert.match(page.body.toString('utf8'), /下载 Word/);

  const bad = await invoke(app, { url: `/api/files/archive-%E4%B8%AD%E6%96%87-1/pdf?token=bad-token` });
  assert.equal(bad.statusCode, 403);

  const missingTypeUrl = new URL(createSignedDownloadUrl({ archiveId: 'archive-中文-1', fileType: 'pdf', userId: 'ou_test', env }));
  const traversal = await invoke(app, { url: `${missingTypeUrl.pathname.replace('/pdf', '/..%2Fpdf')}${missingTypeUrl.search}` });
  assert.equal(traversal.statusCode, 400);
});

test('Feishu result card uses signed public URLs and omits unavailable files', async () => {
  const appDir = tempAppDir();
  seedArchive(appDir);
  const links = await buildArchiveDownloadLinks({
    appDir,
    archiveId: 'archive-中文-1',
    userId: 'ou_test',
    env,
    client: createMockZspaceClient()
  });
  const card = buildEssayResultCard({
    totalScore: 48,
    fullScore: 60,
    level: '二类文',
    coreAdvantages: ['观点明确'],
    mainProblems: ['论证展开不足'],
    nextTraining: ['因果分析训练']
  }, { links });
  const serialized = JSON.stringify(card);

  assert.match(serialized, /https:\/\/pi\.zhenwanyue\.icu\/report\//);
  assert.match(serialized, /https:\/\/pi\.zhenwanyue\.icu\/api\/files\//);
  assert.doesNotMatch(serialized, /localhost|127\.0\.0\.1|192\.168|webdav|file:\/\//i);
  assert.doesNotMatch(serialized, /essay-download-word/);
  assert.doesNotMatch(serialized, /essay-result/);
});

test('file routes resolve report links from student profile archive index when archive-records is missing', async () => {
  const appDir = tempAppDir();
  seedProfileArchive(appDir);
  const app = createApp({ env, appDir, zspaceClient: createMockZspaceClient(), logger: { error() {}, warn() {}, info() {} } });
  const pdfUrl = new URL(createSignedDownloadUrl({ archiveId: 'essay-56', fileType: 'pdf', userId: 'ou_test', env }));
  const reportUrl = new URL(createSignedReportUrl({ archiveId: 'essay-56', userId: 'ou_test', env }));

  const pdf = await invoke(app, { url: `${pdfUrl.pathname}${pdfUrl.search}` });
  assert.equal(pdf.statusCode, 200);
  assert.equal(pdf.headers['content-type'], 'application/pdf');

  const report = await invoke(app, { url: `${reportUrl.pathname}${reportUrl.search}` });
  assert.equal(report.statusCode, 200);
  assert.match(report.body.toString('utf8'), /飞书真实验证作文-0714/);
  assert.match(report.body.toString('utf8'), /42/);
});
