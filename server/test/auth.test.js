import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { schemaSql } from '../src/db/schema.js';
import { resolveLoginUser } from '../src/routes/auth.js';

function createFixtureDb() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(schemaSql);

  const addUser = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
  const studentUserId = addUser.run('TEST001', '123456', 'student', '测试学生').lastInsertRowid;
  database.prepare('INSERT INTO students (user_id, student_no, grade, school) VALUES (?, ?, ?, ?)').run(studentUserId, 'TEST001', '高二', 'TEST 中学');

  const teacherUserId = addUser.run('teacher', '123456', 'teacher', '陈老师').lastInsertRowid;
  database.prepare('INSERT INTO teachers (user_id, title, school) VALUES (?, ?, ?)').run(teacherUserId, '教师', 'TEST 中学');

  return { database };
}

test('student login accepts student number as the account identifier', () => {
  const fixture = createFixtureDb();

  const result = resolveLoginUser(fixture.database, { username: 'TEST001', password: '123456' });

  assert.equal(result.status, 200);
  assert.equal(result.user.username, 'TEST001');
  assert.equal(result.user.role, 'student');
  assert.equal(result.user.studentId > 0, true);
});

test('student login rejects incorrect password for student number login', () => {
  const fixture = createFixtureDb();

  const result = resolveLoginUser(fixture.database, { username: 'TEST001', password: 'wrong' });

  assert.equal(result.status, 401);
});
