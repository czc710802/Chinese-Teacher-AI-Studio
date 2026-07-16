import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { schemaSql } from '../src/db/schema.js';
import { relaxInviteCodeConstraint } from '../src/db/init.js';
import { deleteManagedEmptyClass, getClassRosterForUser, renameStudentForManagedClass } from '../src/services/class-access.js';
import { canReadEssay, getEssayLengthBand, resolveEssayListScope, resolveEssaySubmitStudentId, resolveEssaySubmitTarget } from '../src/services/essay-access.js';

function createFixtureDb() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(schemaSql);

  const addUser = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
  const teacherUserId = addUser.run('teacher', '123456', 'teacher', '陈老师').lastInsertRowid;
  const studentUserId = addUser.run('s51001', '123456', 'student', '赵一').lastInsertRowid;
  const otherStudentUserId = addUser.run('s51002', '123456', 'student', '钱二').lastInsertRowid;

  const teacherId = database.prepare('INSERT INTO teachers (user_id, title, school) VALUES (?, ?, ?)').run(teacherUserId, '教师', '惠安一中').lastInsertRowid;
  const studentId = database.prepare('INSERT INTO students (user_id, student_no, grade, school) VALUES (?, ?, ?, ?)').run(studentUserId, '1', '高二', '惠安一中').lastInsertRowid;
  const otherStudentId = database.prepare('INSERT INTO students (user_id, student_no, grade, school) VALUES (?, ?, ?, ?)').run(otherStudentUserId, '2', '高二', '惠安一中').lastInsertRowid;
  const classId = database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)').run('510班', '高二', teacherId).lastInsertRowid;
  database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(classId, studentId);
  database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(classId, otherStudentId);
  const assignmentId = database.prepare('INSERT INTO assignments (class_id, title, prompt, essay_type, full_score) VALUES (?, ?, ?, ?, ?)').run(classId, '本周作文', '写一篇议论文', '材料作文', 60).lastInsertRowid;
  const ownEssayId = database.prepare('INSERT INTO essays (assignment_id, student_id, title, original_text) VALUES (?, ?, ?, ?)').run(assignmentId, studentId, '我的作文', '正文').lastInsertRowid;
  const otherEssayId = database.prepare('INSERT INTO essays (assignment_id, student_id, title, original_text) VALUES (?, ?, ?, ?)').run(assignmentId, otherStudentId, '别人的作文', '正文').lastInsertRowid;

  return {
    database,
    teacherUser: { id: teacherUserId, role: 'teacher' },
    studentUser: { id: studentUserId, role: 'student' },
    adminUser: { id: 9999, role: 'admin' },
    teacherId,
    classId,
    studentId,
    otherStudentId,
    ownEssayId,
    otherEssayId
  };
}

test('student can read the roster for their own class', () => {
  const fixture = createFixtureDb();

  const result = getClassRosterForUser(fixture.database, fixture.studentUser, fixture.classId);

  assert.equal(result.status, 200);
  assert.deepEqual(result.rows.map((row) => row.name), ['赵一', '钱二']);
  assert.equal(result.rows[0].is_current_user, 1);
  assert.equal(result.rows[1].is_current_user, 0);
});

test('teacher can rename a student in managed class and student roster shows the new name', () => {
  const fixture = createFixtureDb();

  const renamed = renameStudentForManagedClass(fixture.database, fixture.teacherUser, fixture.classId, fixture.studentId, '赵一新名');
  const roster = getClassRosterForUser(fixture.database, fixture.studentUser, fixture.classId);

  assert.equal(renamed.status, 200);
  assert.equal(renamed.student.name, '赵一新名');
  assert.deepEqual(roster.rows.map((row) => row.name), ['赵一新名', '钱二']);
});

test('teacher can delete an empty managed class', () => {
  const fixture = createFixtureDb();
  const emptyClassId = fixture.database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)')
    .run('511班', '高二', fixture.teacherId).lastInsertRowid;

  const result = deleteManagedEmptyClass(fixture.database, fixture.teacherUser, emptyClassId);

  const exists = fixture.database.prepare('SELECT 1 FROM classes WHERE id = ?').get(emptyClassId);
  assert.equal(result.status, 200);
  assert.equal(exists, undefined);
});

test('class records can be created without invitation codes', () => {
  const fixture = createFixtureDb();

  const classId = fixture.database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)')
    .run('512班', '高二', fixture.teacherId).lastInsertRowid;

  const klass = fixture.database.prepare('SELECT name, invite_code FROM classes WHERE id = ?').get(classId);
  assert.equal(klass.name, '512班');
  assert.equal(klass.invite_code, null);
});

test('legacy required invitation-code class table is migrated to nullable invite code', () => {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('student','teacher')),
      name TEXT NOT NULL
    );
    CREATE TABLE teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      grade TEXT,
      teacher_id INTEGER NOT NULL,
      invite_code TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
    );
  `);
  const userId = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)')
    .run('teacher', '123456', 'teacher', '陈老师').lastInsertRowid;
  const teacherId = database.prepare('INSERT INTO teachers (user_id) VALUES (?)').run(userId).lastInsertRowid;
  database.prepare('INSERT INTO classes (name, grade, teacher_id, invite_code) VALUES (?, ?, ?, ?)')
    .run('旧班级', '高二', teacherId, 'YWOLD');

  relaxInviteCodeConstraint(database);

  const migratedClassId = database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)')
    .run('新班级', '高二', teacherId).lastInsertRowid;
  const rows = database.prepare('SELECT name, invite_code FROM classes ORDER BY id').all();
  assert.deepEqual(rows.map((row) => row.name), ['旧班级', '新班级']);
  assert.equal(database.prepare('SELECT invite_code FROM classes WHERE id = ?').get(migratedClassId).invite_code, null);
});

test('teacher cannot delete a class that still has students or assignments', () => {
  const fixture = createFixtureDb();

  const result = deleteManagedEmptyClass(fixture.database, fixture.teacherUser, fixture.classId);

  const exists = fixture.database.prepare('SELECT 1 FROM classes WHERE id = ?').get(fixture.classId);
  assert.equal(result.status, 409);
  assert.match(result.message, /先删除学生名单和作文任务/);
  assert.equal(exists['1'], 1);
});

test('student essay scope ignores spoofed student_id and only allows own essay', () => {
  const fixture = createFixtureDb();

  const scope = resolveEssayListScope(fixture.database, fixture.studentUser, {
    studentId: fixture.otherStudentId,
    classId: fixture.classId
  });
  const submitStudentId = resolveEssaySubmitStudentId(fixture.database, fixture.studentUser, {
    student_id: fixture.otherStudentId
  });

  assert.equal(scope.status, 200);
  assert.equal(scope.studentId, fixture.studentId);
  assert.equal(scope.classId, fixture.classId);
  assert.equal(submitStudentId.status, 200);
  assert.equal(submitStudentId.studentId, fixture.studentId);
  assert.equal(canReadEssay(fixture.database, fixture.studentUser, fixture.ownEssayId), true);
  assert.equal(canReadEssay(fixture.database, fixture.studentUser, fixture.otherEssayId), false);
});

test('student submission requires an active membership even if roster data still exists', () => {
  const fixture = createFixtureDb();
  fixture.database.prepare(`
    INSERT INTO student_class_bindings (student_id, class_id, join_mode, status, joined_at, updated_at, left_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(fixture.studentId, fixture.classId, 'approval', 'removed');
  const assignmentId = fixture.database.prepare('SELECT id FROM assignments WHERE class_id = ? LIMIT 1').get(fixture.classId).id;

  const scope = resolveEssayListScope(fixture.database, fixture.studentUser, { classId: fixture.classId });
  const submitTarget = resolveEssaySubmitTarget(fixture.database, fixture.studentUser, {
    assignment_id: assignmentId,
    original_text: '这是一篇需要活跃 membership 才能提交的作文。'
  });

  assert.equal(scope.status, 403);
  assert.equal(scope.message, '没有查看该班级作文的权限');
  assert.equal(submitTarget.status, 403);
  assert.equal(submitTarget.message, '没有提交该作文任务的权限');
});

test('student text submission validates assignment and class membership before insert', () => {
  const fixture = createFixtureDb();
  const otherClassId = fixture.database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)')
    .run('511班', '高二', fixture.teacherId).lastInsertRowid;
  const otherAssignmentId = fixture.database.prepare('INSERT INTO assignments (class_id, title, prompt, essay_type, full_score) VALUES (?, ?, ?, ?, ?)')
    .run(otherClassId, '别班作文', '写作要求', '材料作文', 60).lastInsertRowid;

  const missingAssignment = resolveEssaySubmitTarget(fixture.database, fixture.studentUser, {
    assignment_id: 9999,
    original_text: '这是一篇粘贴提交的作文。'
  });
  const otherClassAssignment = resolveEssaySubmitTarget(fixture.database, fixture.studentUser, {
    assignment_id: otherAssignmentId,
    original_text: '这是一篇粘贴提交的作文。'
  });
  const emptyText = resolveEssaySubmitTarget(fixture.database, fixture.studentUser, {
    assignment_id: fixture.database.prepare('SELECT id FROM assignments WHERE class_id = ? LIMIT 1').get(fixture.classId).id,
    original_text: '   '
  });

  assert.equal(missingAssignment.status, 404);
  assert.equal(missingAssignment.message, '作文任务不存在');
  assert.equal(otherClassAssignment.status, 403);
  assert.equal(otherClassAssignment.message, '没有提交该作文任务的权限');
  assert.equal(emptyText.status, 400);
  assert.equal(emptyText.message, '请先粘贴或输入作文正文');
});

test('student cannot submit the same assignment twice unless resubmission is allowed', () => {
  const fixture = createFixtureDb();
  const assignmentId = fixture.database.prepare('SELECT id FROM assignments WHERE class_id = ? LIMIT 1').get(fixture.classId).id;

  const blocked = resolveEssaySubmitTarget(fixture.database, fixture.studentUser, {
    assignment_id: assignmentId,
    original_text: '这是一篇第二次提交的作文，默认不允许重复提交。'
  });

  fixture.database.prepare('UPDATE assignments SET allow_resubmit = 1 WHERE id = ?').run(assignmentId);
  const allowed = resolveEssaySubmitTarget(fixture.database, fixture.studentUser, {
    assignment_id: assignmentId,
    original_text: '这是一篇允许重新提交的作文。'
  });

  assert.equal(blocked.status, 409);
  assert.equal(blocked.message, '该作业已提交，请勿重复提交');
  assert.equal(allowed.status, 200);
  assert.equal(allowed.nextSubmitRound, 2);
});

test('student can submit a short essay and still enter grading flow when the assignment has a minimum word setting', () => {
  const fixture = createFixtureDb();
  const assignmentId = fixture.database.prepare('SELECT id FROM assignments WHERE class_id = ? LIMIT 1').get(fixture.classId).id;
  fixture.database.prepare('UPDATE assignments SET min_words = 800, max_words = 1000, allow_resubmit = 1 WHERE id = ?').run(assignmentId);

  const result = resolveEssaySubmitTarget(fixture.database, fixture.studentUser, {
    assignment_id: assignmentId,
    original_text: '这是短文，但也应进入 AI 批改流程。'
  });

  assert.equal(result.status, 200);
  assert.equal(result.assignment.id, assignmentId);
  assert.equal(result.wordCount > 0, true);
  assert.equal(result.submissionStatus, 'submitted');
});

test('student can submit essays longer than the old 1000-word ceiling and still enter grading flow', () => {
  const fixture = createFixtureDb();
  const assignmentId = fixture.database.prepare('SELECT id FROM assignments WHERE class_id = ? LIMIT 1').get(fixture.classId).id;
  fixture.database.prepare('UPDATE assignments SET min_words = 800, max_words = 1000, allow_resubmit = 1 WHERE id = ?').run(assignmentId);
  const longEssay = '这是长文段落。'.repeat(220);

  const result = resolveEssaySubmitTarget(fixture.database, fixture.studentUser, {
    assignment_id: assignmentId,
    original_text: longEssay
  });

  assert.equal(result.status, 200);
  assert.equal(result.assignment.id, assignmentId);
  assert.ok(result.wordCount > 1000);
  assert.equal(result.lengthBand, 'full');
  assert.equal(getEssayLengthBand(longEssay), 'full');
});

test('student draft is saved and loaded per assignment without exposing other students', async () => {
  const fixture = createFixtureDb();
  const module = await import('../src/services/essay-access.js');
  assert.equal(typeof module.saveSubmissionDraft, 'function');
  assert.equal(typeof module.getSubmissionDraft, 'function');

  const assignmentId = fixture.database.prepare('SELECT id FROM assignments WHERE class_id = ? LIMIT 1').get(fixture.classId).id;
  const saved = module.saveSubmissionDraft(fixture.database, fixture.studentUser, {
    assignment_id: assignmentId,
    title: '我的草稿',
    content: '草稿正文',
    attachments: [{ name: 'draft.docx', type: 'docx' }]
  });
  const loaded = module.getSubmissionDraft(fixture.database, fixture.studentUser, assignmentId);
  const teacherLoaded = module.getSubmissionDraft(fixture.database, fixture.teacherUser, assignmentId);

  assert.equal(saved.status, 200);
  assert.equal(loaded.status, 200);
  assert.equal(loaded.draft.title, '我的草稿');
  assert.equal(loaded.draft.word_count, 4);
  assert.deepEqual(JSON.parse(loaded.draft.attachments), [{ name: 'draft.docx', type: 'docx' }]);
  assert.equal(teacherLoaded.status, 403);
});

test('admin role is not granted class or essay access after administrator removal', () => {
  const fixture = createFixtureDb();

  const roster = getClassRosterForUser(fixture.database, fixture.adminUser, fixture.classId);

  assert.equal(roster.status, 403);
  assert.equal(canReadEssay(fixture.database, fixture.adminUser, fixture.ownEssayId), false);
});
