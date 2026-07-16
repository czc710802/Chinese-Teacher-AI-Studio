import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { schemaSql } from '../src/db/schema.js';
import { canReadEssay, resolveEssayListScope } from '../src/services/essay-access.js';

function createFixtureDb() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(schemaSql);

  const addUser = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
  const teacher1UserId = addUser.run('teacher-1', '123456', 'teacher', '陈老师').lastInsertRowid;
  const teacher2UserId = addUser.run('teacher-2', '123456', 'teacher', '李老师').lastInsertRowid;
  const studentUserId = addUser.run('student-1', '123456', 'student', '测试学生').lastInsertRowid;
  const student2UserId = addUser.run('student-2', '123456', 'student', '测试学生二').lastInsertRowid;

  const teacher1Id = database.prepare('INSERT INTO teachers (user_id, title, school) VALUES (?, ?, ?)').run(teacher1UserId, '教师', '测试学校').lastInsertRowid;
  const teacher2Id = database.prepare('INSERT INTO teachers (user_id, title, school) VALUES (?, ?, ?)').run(teacher2UserId, '教师', '测试学校').lastInsertRowid;
  const studentId = database.prepare('INSERT INTO students (user_id, student_no, grade, school) VALUES (?, ?, ?, ?)').run(studentUserId, 'TEST001', '高二', '测试学校').lastInsertRowid;
  const student2Id = database.prepare('INSERT INTO students (user_id, student_no, grade, school) VALUES (?, ?, ?, ?)').run(student2UserId, 'TEST002', '高二', '测试学校').lastInsertRowid;

  const class1Id = database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)').run('A班', '高二', teacher1Id).lastInsertRowid;
  const class2Id = database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)').run('B班', '高二', teacher2Id).lastInsertRowid;
  database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(class1Id, studentId);
  database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(class2Id, student2Id);

  const assignment1Id = database.prepare('INSERT INTO assignments (class_id, title, prompt, essay_type, full_score, status) VALUES (?, ?, ?, ?, ?, ?)').run(class1Id, '任务A', '材料A', '材料作文', 60, 'published').lastInsertRowid;
  const assignment2Id = database.prepare('INSERT INTO assignments (class_id, title, prompt, essay_type, full_score, status) VALUES (?, ?, ?, ?, ?, ?)').run(class2Id, '任务B', '材料B', '材料作文', 60, 'published').lastInsertRowid;

  const essay1Id = database.prepare('INSERT INTO essays (assignment_id, student_id, title, original_text, grading_status, status) VALUES (?, ?, ?, ?, ?, ?)').run(assignment1Id, studentId, '作文A', '正文A', 'graded', 'report_published').lastInsertRowid;
  const essay2Id = database.prepare('INSERT INTO essays (assignment_id, student_id, title, original_text, grading_status, status) VALUES (?, ?, ?, ?, ?, ?)').run(assignment2Id, student2Id, '作文B', '正文B', 'graded', 'report_published').lastInsertRowid;

  return {
    database,
    teacher1User: { id: teacher1UserId, role: 'teacher' },
    teacher2User: { id: teacher2UserId, role: 'teacher' },
    studentUser: { id: studentUserId, role: 'student' },
    class1Id,
    class2Id,
    essay1Id,
    essay2Id
  };
}

test('teacher essay list scope is limited to owned classes and exposes teacher id', () => {
  const fixture = createFixtureDb();

  const ownScope = resolveEssayListScope(fixture.database, fixture.teacher1User, { classId: fixture.class1Id });
  const otherScope = resolveEssayListScope(fixture.database, fixture.teacher1User, { classId: fixture.class2Id });

  assert.equal(ownScope.status, 200);
  assert.equal(ownScope.teacherId, 1);
  assert.equal(ownScope.classId, fixture.class1Id);

  assert.equal(otherScope.status, 403);
  assert.match(otherScope.message, /没有查看该班级作文的权限/);
});

test('teacher can read only essays from the managed class', () => {
  const fixture = createFixtureDb();

  assert.equal(canReadEssay(fixture.database, fixture.teacher1User, fixture.essay1Id), true);
  assert.equal(canReadEssay(fixture.database, fixture.teacher1User, fixture.essay2Id), false);
  assert.equal(canReadEssay(fixture.database, fixture.teacher2User, fixture.essay2Id), true);
});

test('student essay scope remains limited to active joined class', () => {
  const fixture = createFixtureDb();
  const ownScope = resolveEssayListScope(fixture.database, fixture.studentUser, { classId: fixture.class1Id });
  const otherScope = resolveEssayListScope(fixture.database, fixture.studentUser, { classId: fixture.class2Id });

  assert.equal(ownScope.status, 200);
  assert.equal(ownScope.studentId, fixture.database.prepare('SELECT id FROM students WHERE user_id = ?').get(fixture.studentUser.id).id);
  assert.equal(otherScope.status, 403);
});
