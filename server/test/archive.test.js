import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { schemaSql } from '../src/db/schema.js';
import {
  archiveEssayToNAS,
  buildArchiveFiles,
  buildArchiveRemoteBasePath,
  getArchiveRecord,
  listArchiveRecords,
  readArchiveRecords
} from '../src/services/archive-pipeline.js';

function createTempAppDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'archive-pipeline-'));
}

function createFixtureDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(schemaSql);
  const teacherUserId = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run('teacher-a', 'x', 'teacher', '陈老师').lastInsertRowid;
  const studentUserId = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run('student-a', 'x', 'student', '林同学').lastInsertRowid;
  const teacherId = database.prepare('INSERT INTO teachers (user_id, title) VALUES (?, ?)').run(teacherUserId, '语文教师').lastInsertRowid;
  const studentId = database.prepare('INSERT INTO students (user_id, student_no, grade) VALUES (?, ?, ?)').run(studentUserId, '2026001', '高三').lastInsertRowid;
  const classId = database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)').run('510班', '高三', teacherId).lastInsertRowid;
  database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(classId, studentId);
  const assignmentId = database.prepare('INSERT INTO assignments (class_id, title, prompt, essay_type, full_score) VALUES (?, ?, ?, ?, ?)').run(classId, '时代青年', '请谈个人选择与时代责任。', '材料作文', 60).lastInsertRowid;
  const essayId = database.prepare('INSERT INTO essays (assignment_id, student_id, title, original_text, created_at) VALUES (?, ?, ?, ?, ?)').run(
    assignmentId,
    studentId,
    '青年/责任',
    '青年应当在时代中寻找自己的责任。',
    '2026-07-12T12:00:00.000Z'
  ).lastInsertRowid;
  database.prepare('INSERT INTO essay_images (essay_id, file_path, ocr_text, sort_order) VALUES (?, ?, ?, ?)').run(essayId, '/uploads/a.jpg', 'OCR识别文字', 0);
  const raw = {
    total_score: 48,
    level: '二类文',
    dimension_scores: [
      { name: '审题立意', score: 17, full: 20, comment: '立意清楚' },
      { name: '内容素材', score: 16, full: 20, comment: '材料较充分' },
      { name: '结构逻辑', score: 15, full: 20, comment: '逻辑基本顺畅' },
      { name: '语言表达', score: 16, full: 20, comment: '表达准确' }
    ],
    strengths: ['观点明确'],
    problems: ['论证还可更深入'],
    suggestions: ['补充时代材料'],
    next_training: ['写一段因果分析'],
    ai_meta: { provider: 'deepseek', model: 'deepseek-chat' }
  };
  database.prepare(`
    INSERT INTO ai_reviews
    (essay_id, total_score, level, dimension_scores, strengths, problems, paragraph_comments, editable_sentences, suggestions, upgraded_paragraph, good_sentences, next_training, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    essayId,
    48,
    '二类文',
    JSON.stringify(raw.dimension_scores),
    JSON.stringify(raw.strengths),
    JSON.stringify(raw.problems),
    '[]',
    '[]',
    JSON.stringify(raw.suggestions),
    '升格段落',
    '[]',
    JSON.stringify(raw.next_training),
    JSON.stringify(raw)
  );
  return { database, essayId };
}

function createMockClient({ fail = false } = {}) {
  const state = { directories: [], uploads: [], deletes: [] };
  return {
    state,
    config: { enabled: true, rootDirectory: 'Chinese Teacher AI Studio' },
    async ensureDirectory(remotePath) {
      state.directories.push(remotePath);
      return { ok: true, path: remotePath };
    },
    async uploadBuffer(remotePath, buffer, contentType) {
      if (fail) throw new Error('ECONNREFUSED WebDAV offline');
      state.uploads.push({ remotePath, buffer: Buffer.from(buffer), contentType });
      return { ok: true, remotePath };
    },
    async deleteFile(remotePath) {
      state.deletes.push(remotePath);
      return { ok: true };
    }
  };
}

test('archive pipeline builds the requested Archive directory structure', () => {
  const basePath = buildArchiveRemoteBasePath({
    className: '510班',
    studentNo: '2026001',
    studentName: '林同学',
    essayTitle: '青年/责任',
    createdAt: '2026-07-12T12:00:00.000Z'
  });

  assert.equal(basePath, 'Archive/510班/2026001_林同学/2026/2026-07/青年责任');
});

test('archive pipeline generates JSON, Markdown, Word, PDF and metadata artifacts', async () => {
  const { database, essayId } = createFixtureDatabase();
  const files = await buildArchiveFiles({ database, essayId });
  const names = files.artifacts.map((artifact) => path.posix.basename(artifact.remotePath)).sort();

  assert.deepEqual(names, ['metadata.json', 'ocr.txt', 'original.md', 'report.docx', 'report.json', 'report.md', 'report.pdf']);
  assert.equal(files.metadata.studentId, '2026001');
  assert.equal(files.metadata.studentName, '林同学');
  assert.equal(files.metadata.className, '510班');
  assert.equal(files.metadata.provider, 'deepseek');
  assert.equal(files.metadata.model, 'deepseek-chat');
  assert.equal(files.reportJson.score, 48);
  assert.equal(files.reportJson.grade, '二类文');
  assert.ok(files.reportJson.logicAnalysis);
  assert.ok(files.reportJson.languageAnalysis);
  assert.ok(files.reportJson.intentAnalysis);
  assert.ok(files.reportJson.materialAnalysis);
  assert.ok(files.artifacts.find((artifact) => artifact.remotePath.endsWith('report.md')).buffer.toString('utf8').includes('教师可读批改报告'));
  assert.ok(files.artifacts.find((artifact) => artifact.remotePath.endsWith('report.docx')).buffer.length > 1000);
  assert.ok(files.artifacts.find((artifact) => artifact.remotePath.endsWith('report.pdf')).buffer.length > 1000);
});

test('archive pipeline uploads to NAS and records a single idempotent archive record', async () => {
  const appDir = createTempAppDir();
  const { database, essayId } = createFixtureDatabase();
  const client = createMockClient();

  const first = await archiveEssayToNAS({ appDir, database, essayId, client });
  const second = await archiveEssayToNAS({ appDir, database, essayId, client });

  assert.equal(first.ok, true);
  assert.equal(first.queued, false);
  assert.equal(second.ok, true);
  assert.equal(client.state.directories.includes('Archive/510班/2026001_林同学/2026/2026-07/青年责任'), true);
  assert.equal(client.state.uploads.length, 14);
  assert.equal(readArchiveRecords(appDir).records.length, 1);
  assert.equal(getArchiveRecord(appDir, `essay-${essayId}`).archiveStatus, 'archived');
  assert.equal(listArchiveRecords(appDir, { search: '林同学' }).length, 1);
});

test('archive pipeline queues all artifacts when NAS upload fails', async () => {
  const appDir = createTempAppDir();
  const { database, essayId } = createFixtureDatabase();
  const client = createMockClient({ fail: true });

  const result = await archiveEssayToNAS({ appDir, database, essayId, client });
  const queuePath = path.join(appDir, 'data', 'storage-queue', 'zspace-pending.json');
  const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));

  assert.equal(result.ok, false);
  assert.equal(result.queued, true);
  assert.equal(queue.tasks.length, 7);
  assert.equal(getArchiveRecord(appDir, `essay-${essayId}`).archiveStatus, 'queued');
});
