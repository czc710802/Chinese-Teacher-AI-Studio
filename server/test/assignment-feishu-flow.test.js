import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { schemaSql } from '../src/db/schema.js';
import {
  buildAssignmentFeishuCard,
  getAssignmentSubmissionStatus,
  shareAssignmentToFeishu
} from '../src/services/assignment-access.js';
import {
  bindFeishuClass,
  bindFeishuStudent,
  listFeishuClassBindings,
  remindMissingStudents
} from '../src/services/feishu-assignment-bindings.js';
import { resolveEssaySubmitTarget, resolveStudentSubmissionStatus } from '../src/services/essay-access.js';

function createFixtureDb() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(schemaSql);

  const addUser = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
  const teacherUserId = addUser.run('teacher', '123456', 'teacher', '陈老师').lastInsertRowid;
  const studentUserId = addUser.run('s001', '123456', 'student', '赵一').lastInsertRowid;
  const missingStudentUserId = addUser.run('s002', '123456', 'student', '钱二').lastInsertRowid;

  const teacherId = database.prepare('INSERT INTO teachers (user_id, title, school) VALUES (?, ?, ?)').run(teacherUserId, '教师', '惠安一中').lastInsertRowid;
  const studentId = database.prepare('INSERT INTO students (user_id, student_no, grade, school) VALUES (?, ?, ?, ?)').run(studentUserId, '001', '高二', '惠安一中').lastInsertRowid;
  const missingStudentId = database.prepare('INSERT INTO students (user_id, student_no, grade, school) VALUES (?, ?, ?, ?)').run(missingStudentUserId, '002', '高二', '惠安一中').lastInsertRowid;
  const classId = database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)').run('高二1班', '高二', teacherId).lastInsertRowid;
  database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(classId, studentId);
  database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(classId, missingStudentId);
  const assignmentId = database.prepare(`
    INSERT INTO assignments
      (class_id, public_id, title, prompt, requirements, essay_type, full_score, min_words, max_words, deadline, share_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    classId,
    'G2-20260713-001',
    '青年选择与时代责任',
    '阅读材料，围绕青年选择与时代责任写一篇议论文。',
    '观点明确，论据充分，结构完整。',
    '材料作文',
    60,
    800,
    1000,
    '2026-07-20T20:00:00',
    'https://pi.zhenwanyue.icu/submit/G2-20260713-001'
  ).lastInsertRowid;

  return {
    database,
    teacherUser: { id: teacherUserId, role: 'teacher' },
    studentUser: { id: studentUserId, role: 'student' },
    teacherId,
    classId,
    studentId,
    missingStudentId,
    assignmentId
  };
}

test('teacher binds one primary Feishu group to a class and reuses it when publishing assignment', async () => {
  const fixture = createFixtureDb();
  const sent = [];
  const feishuService = {
    async sendCard(chatId, card) {
      sent.push({ chatId, card });
      return { message_id: `om_${sent.length}` };
    }
  };

  const binding = bindFeishuClass(fixture.database, fixture.teacherUser, {
    classId: fixture.classId,
    feishuChatId: 'oc_chat_001',
    feishuChatName: '高二1班作文群'
  });
  const result = await shareAssignmentToFeishu({
    database: fixture.database,
    user: fixture.teacherUser,
    assignmentId: fixture.assignmentId,
    feishuService,
    options: { publicOrigin: 'https://pi.zhenwanyue.icu' }
  });

  assert.equal(binding.status, 200);
  assert.equal(listFeishuClassBindings(fixture.database, fixture.teacherUser, { classId: fixture.classId }).rows.length, 1);
  assert.equal(result.status, 200);
  assert.equal(result.sent, true);
  assert.equal(sent[0].chatId, 'oc_chat_001');
  assert.equal(result.messageRecord.status, 'sent');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM feishu_assignment_messages').get().count, 1);
});

test('assignment Feishu card uses public submit URLs and exposes assignment submit and status buttons', () => {
  const fixture = createFixtureDb();
  const status = getAssignmentSubmissionStatus(fixture.database, fixture.teacherUser, fixture.assignmentId, {
    publicOrigin: 'https://pi.zhenwanyue.icu'
  });

  const card = buildAssignmentFeishuCard(status.assignment);
  const content = JSON.stringify(card);

  assert.match(content, /青年选择与时代责任/);
  assert.match(content, /写作要求/);
  assert.match(content, /最低\/最高字数/);
  assert.match(content, /当前已交\/未交/);
  assert.match(content, /查看作业/);
  assert.match(content, /立即提交/);
  assert.match(content, /查看提交状态/);
  assert.match(content, /https:\/\/pi\.zhenwanyue\.icu\/submit\/G2-20260713-001/);
  assert.doesNotMatch(content, /localhost|127\.0\.0\.1|192\.168\.|WebDAV|file:\/\//);
});

test('reminding missing students sends only to bound students who have not submitted', async () => {
  const fixture = createFixtureDb();
  const sent = [];
  bindFeishuStudent(fixture.database, fixture.teacherUser, {
    studentId: fixture.studentId,
    classId: fixture.classId,
    feishuOpenId: 'ou_submitted'
  });
  bindFeishuStudent(fixture.database, fixture.teacherUser, {
    studentId: fixture.missingStudentId,
    classId: fixture.classId,
    feishuOpenId: 'ou_missing'
  });
  fixture.database.prepare('INSERT INTO essays (assignment_id, student_id, title, original_text) VALUES (?, ?, ?, ?)')
    .run(fixture.assignmentId, fixture.studentId, '已交作文', '正文');

  const result = await remindMissingStudents({
    database: fixture.database,
    user: fixture.teacherUser,
    assignmentId: fixture.assignmentId,
    feishuService: {
      async sendCard(targetId, card) {
        sent.push({ targetId, card });
        return { message_id: 'om_remind' };
      }
    },
    options: { publicOrigin: 'https://pi.zhenwanyue.icu' }
  });

  assert.equal(result.status, 200);
  assert.equal(result.sent, 1);
  assert.equal(result.skipped, 0);
  assert.equal(sent[0].targetId, 'ou_missing');
  assert.match(JSON.stringify(sent[0].card), /请尽快提交作文/);
});

test('student submission status distinguishes missing draft submitted graded review and published report states', () => {
  const fixture = createFixtureDb();

  assert.equal(resolveStudentSubmissionStatus(fixture.database, fixture.studentUser, fixture.assignmentId).state, '未提交');
  fixture.database.prepare(`
    INSERT INTO submission_drafts (assignment_id, student_id, title, content, word_count)
    VALUES (?, ?, ?, ?, ?)
  `).run(fixture.assignmentId, fixture.studentId, '草稿', '草稿正文', 4);
  assert.equal(resolveStudentSubmissionStatus(fixture.database, fixture.studentUser, fixture.assignmentId).state, '草稿');
  const essayId = fixture.database.prepare(`
    INSERT INTO essays (assignment_id, student_id, title, original_text, grading_status, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(fixture.assignmentId, fixture.studentId, '正式作文', '正文', 'graded', 'submitted').lastInsertRowid;
  assert.equal(resolveStudentSubmissionStatus(fixture.database, fixture.studentUser, fixture.assignmentId).state, '待教师审核');
  fixture.database.prepare('UPDATE essays SET status = ?, report_id = ? WHERE id = ?').run('report_published', 1001, essayId);
  assert.equal(resolveStudentSubmissionStatus(fixture.database, fixture.studentUser, fixture.assignmentId).state, '已发布报告');
});

test('deadline enforcement blocks late submissions unless late submission is enabled', () => {
  const fixture = createFixtureDb();
  fixture.database.prepare('UPDATE assignments SET deadline = ?, allow_late_submit = 0, min_words = 0, max_words = 0 WHERE id = ?')
    .run('2026-07-01T10:00:00', fixture.assignmentId);

  const blocked = resolveEssaySubmitTarget(fixture.database, fixture.studentUser, {
    assignment_id: fixture.assignmentId,
    original_text: '这是一篇超过截止时间提交的作文。',
    now: '2026-07-13T10:00:00'
  });

  fixture.database.prepare('UPDATE assignments SET allow_late_submit = 1 WHERE id = ?').run(fixture.assignmentId);
  const allowed = resolveEssaySubmitTarget(fixture.database, fixture.studentUser, {
    assignment_id: fixture.assignmentId,
    original_text: '这是一篇允许迟交的作文。',
    now: '2026-07-13T10:00:00'
  });

  assert.equal(blocked.status, 409);
  assert.equal(blocked.message, '作业已截止，不能提交');
  assert.equal(allowed.status, 200);
  assert.equal(allowed.submissionStatus, 'late_submitted');
});
