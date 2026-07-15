import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { schemaSql } from '../src/db/schema.js';
import {
  createManagedAssignment,
  deleteManagedAssignment,
  ensureSystemTestAssignment,
  getAssignmentById,
  listAssignmentsForClass,
  listAssignmentsForUser,
  listVisibleAssignmentsForStudent
} from '../src/services/assignment-access.js';

function createFixtureDb() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(schemaSql);

  const addUser = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
  const teacherUserId = addUser.run('teacher', '123456', 'teacher', '陈老师').lastInsertRowid;
  const otherTeacherUserId = addUser.run('teacher2', '123456', 'teacher', '李老师').lastInsertRowid;
  const studentUserId = addUser.run('s51001', '123456', 'student', '赵一').lastInsertRowid;

  const teacherId = database.prepare('INSERT INTO teachers (user_id, title, school) VALUES (?, ?, ?)').run(teacherUserId, '教师', '惠安一中').lastInsertRowid;
  const otherTeacherId = database.prepare('INSERT INTO teachers (user_id, title, school) VALUES (?, ?, ?)').run(otherTeacherUserId, '教师', '惠安一中').lastInsertRowid;
  const studentId = database.prepare('INSERT INTO students (user_id, student_no, grade, school) VALUES (?, ?, ?, ?)').run(studentUserId, '1', '高二', '惠安一中').lastInsertRowid;

  const classId = database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)').run('510班', '高二', teacherId).lastInsertRowid;
  const otherClassId = database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)').run('511班', '高二', otherTeacherId).lastInsertRowid;
  database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(classId, studentId);

  const addAssignment = database.prepare('INSERT INTO assignments (class_id, title, prompt, essay_type, full_score, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const olderAssignmentId = addAssignment.run(classId, '旧任务', '旧材料', '材料作文', 60, '2026-06-20 08:00:00').lastInsertRowid;
  const newerAssignmentId = addAssignment.run(classId, '新任务', '新材料', '材料作文', 60, '2026-06-21 08:00:00').lastInsertRowid;
  const otherAssignmentId = addAssignment.run(otherClassId, '别班任务', '别班材料', '材料作文', 60, '2026-06-22 08:00:00').lastInsertRowid;
  const essayId = database.prepare('INSERT INTO essays (assignment_id, student_id, title, original_text) VALUES (?, ?, ?, ?)').run(newerAssignmentId, studentId, '我的作文', '正文').lastInsertRowid;

  return {
    database,
    teacherUser: { id: teacherUserId, role: 'teacher' },
    otherTeacherUser: { id: otherTeacherUserId, role: 'teacher' },
    studentUser: { id: studentUserId, role: 'student' },
    classId,
    olderAssignmentId,
    newerAssignmentId,
    otherAssignmentId,
    essayId
  };
}

test('teacher assignment management lists only managed assignments by newest first', () => {
  const fixture = createFixtureDb();

  const result = listAssignmentsForUser(fixture.database, fixture.teacherUser, {});

  assert.equal(result.status, 200);
  assert.deepEqual(result.rows.map((row) => row.title), ['新任务', '旧任务']);
  assert.deepEqual(result.rows.map((row) => row.class_name), ['510班', '510班']);
});

test('teacher assignment management collapses duplicate task rows and keeps submissions', () => {
  const fixture = createFixtureDb();

  const duplicateId = fixture.database.prepare(`
    INSERT INTO assignments (class_id, title, prompt, essay_type, full_score, deadline, created_at)
    SELECT class_id, title, prompt, essay_type, full_score, deadline, '2026-06-21 08:00:01'
    FROM assignments WHERE id = ?
  `).run(fixture.newerAssignmentId).lastInsertRowid;

  const result = listAssignmentsForUser(fixture.database, fixture.teacherUser, {});

  assert.equal(result.status, 200);
  assert.deepEqual(result.rows.map((row) => row.title), ['新任务', '旧任务']);
  assert.equal(result.rows[0].id, fixture.newerAssignmentId);
  assert.equal(result.rows.some((row) => row.id === duplicateId), false);
});

test('teacher publishing the same assignment twice reuses the existing task', () => {
  const fixture = createFixtureDb();
  const body = {
    class_id: fixture.classId,
    title: '重复任务',
    prompt: '同一份材料',
    essay_type: '材料作文',
    full_score: 60,
    deadline: ''
  };

  const first = createManagedAssignment(fixture.database, fixture.teacherUser, body);
  const second = createManagedAssignment(fixture.database, fixture.teacherUser, body);
  const count = fixture.database.prepare(`
    SELECT COUNT(*) AS count FROM assignments
    WHERE class_id = ? AND title = ? AND prompt = ? AND essay_type = ? AND full_score = ? AND COALESCE(deadline, '') = ''
  `).get(fixture.classId, body.title, body.prompt, body.essay_type, body.full_score).count;

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.assignment.id, first.assignment.id);
  assert.equal(count, 1);
});

test('teacher assignment publishing creates a public submit link and submission counters', () => {
  const fixture = createFixtureDb();
  const result = createManagedAssignment(fixture.database, fixture.teacherUser, {
    class_id: fixture.classId,
    title: '青年责任写作训练',
    prompt: '围绕青年选择与时代责任写一篇议论文。',
    requirements: '观点明确，论据充分，结构完整。',
    essay_type: '材料作文',
    full_score: 60,
    grade: '高二',
    min_words: 800,
    max_words: 1000,
    scoring_standard: '按内容、表达、发展等级评分。',
    deadline: '2026-07-20T20:00:00'
  }, { publicOrigin: 'https://pi.zhenwanyue.icu' });

  const listed = listAssignmentsForUser(fixture.database, fixture.teacherUser, {});
  const assignment = listed.rows.find((row) => row.id === result.assignment.id);

  assert.equal(result.status, 200);
  assert.match(result.assignment.public_id, /^G[A-Z0-9-]+-\d{8}-\d{3}$/);
  assert.equal(result.assignment.requirements, '观点明确，论据充分，结构完整。');
  assert.equal(result.assignment.min_words, 800);
  assert.equal(result.assignment.max_words, 1000);
  assert.equal(result.assignment.status, 'published');
  assert.equal(assignment.submitted_count, 0);
  assert.equal(assignment.missing_count, 1);
  assert.equal(assignment.submission_url, `https://pi.zhenwanyue.icu/submit/${result.assignment.public_id}`);
  assert.match(assignment.qr_svg, /<svg/);
});

test('student assignment list is scoped to joined class and hides deleted assignments', () => {
  const fixture = createFixtureDb();

  const deleted = deleteManagedAssignment(fixture.database, fixture.teacherUser, fixture.newerAssignmentId);
  const result = listAssignmentsForUser(fixture.database, fixture.studentUser, { classId: fixture.classId });

  assert.equal(deleted.status, 200);
  assert.deepEqual(result.rows.map((row) => row.title), ['旧任务']);
  assert.equal(fixture.database.prepare('SELECT 1 FROM essays WHERE id = ?').get(fixture.essayId), undefined);
});

test('teacher cannot delete another teacher assignment', () => {
  const fixture = createFixtureDb();

  const result = deleteManagedAssignment(fixture.database, fixture.otherTeacherUser, fixture.newerAssignmentId);

  assert.equal(result.status, 403);
  assert.equal(fixture.database.prepare('SELECT 1 FROM assignments WHERE id = ?').get(fixture.newerAssignmentId)['1'], 1);
});

test('system test assignment initialization creates one live task and preserves production assignments', () => {
  const fixture = createFixtureDb();
  const testClassId = fixture.database.prepare(`
    INSERT INTO classes (name, grade, teacher_id, data_scope, status)
    VALUES (?, ?, ?, ?, ?)
  `).run('系统测试班', '测试', 1, 'system_test', 'active').lastInsertRowid;
  const testStudentUserId = fixture.database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)')
    .run('system-test-student', '123456', 'student', '测试学生').lastInsertRowid;
  const testStudentId = fixture.database.prepare('INSERT INTO students (user_id, student_no, grade, school, data_scope) VALUES (?, ?, ?, ?, ?)')
    .run(testStudentUserId, '6001', '测试', '测试学校', 'system_test').lastInsertRowid;
  fixture.database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(testClassId, testStudentId);
  const productionAssignmentId = fixture.database.prepare(`
    INSERT INTO assignments (class_id, title, prompt, essay_type, full_score, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(fixture.classId, '周练', '正式任务材料', '材料作文', 60, 'published').lastInsertRowid;
  fixture.database.prepare(`
    INSERT INTO assignments (class_id, title, prompt, essay_type, full_score, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(testClassId, '周练', '旧测试材料', '材料作文', 60, 'published');

  const first = ensureSystemTestAssignment(fixture.database, { classId: testClassId, actorId: 'test' });
  const second = ensureSystemTestAssignment(fixture.database, { classId: testClassId, actorId: 'test' });
  const liveRows = listAssignmentsForClass(fixture.database, testClassId, { dataScope: 'system_test' }).rows;
  const productionAssignment = getAssignmentById(fixture.database, productionAssignmentId).assignment;
  const studentRows = listVisibleAssignmentsForStudent(fixture.database, testStudentId).rows;

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.assignment.id, first.assignment.id);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.deepEqual(liveRows.map((row) => row.title), ['师生闭环测试作文']);
  assert.equal(liveRows[0].status, 'published');
  assert.equal(liveRows[0].data_scope, 'system_test');
  assert.equal(liveRows[0].min_words, 300);
  assert.equal(liveRows[0].submitted_count, 0);
  assert.equal(liveRows[0].missing_count, 1);
  assert.equal(studentRows.length, 1);
  assert.equal(studentRows[0].id, first.assignment.id);
  assert.equal(productionAssignment.id, productionAssignmentId);
  assert.equal(productionAssignment.class_id, fixture.classId);
  assert.equal(productionAssignment.title, '周练');
});

test('assignment class and student lists isolate production from system test scope', () => {
  const fixture = createFixtureDb();
  const systemTeacherClassId = fixture.database.prepare(`
    INSERT INTO classes (name, grade, teacher_id, data_scope, status)
    VALUES (?, ?, ?, ?, ?)
  `).run('系统测试班', '测试', 1, 'system_test', 'active').lastInsertRowid;
  fixture.database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(systemTeacherClassId, fixture.database.prepare('SELECT id FROM students WHERE user_id = ?').get(fixture.studentUser.id).id);
  fixture.database.prepare(`
    INSERT INTO assignments (class_id, title, prompt, essay_type, full_score, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(systemTeacherClassId, '系统测试旧任务', '旧材料', '材料作文', 60, 'published');

  const systemRows = listAssignmentsForClass(fixture.database, systemTeacherClassId, { dataScope: 'system_test' }).rows;
  const productionRows = listAssignmentsForClass(fixture.database, fixture.classId, { dataScope: 'production' }).rows;

  assert.ok(systemRows.every((row) => row.data_scope === 'system_test'));
  assert.ok(systemRows.every((row) => Number(row.class_id) === Number(systemTeacherClassId)));
  assert.ok(productionRows.every((row) => row.data_scope === 'production'));
  assert.ok(productionRows.every((row) => Number(row.class_id) === Number(fixture.classId)));
});
