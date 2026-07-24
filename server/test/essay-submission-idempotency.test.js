import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { schemaSql } from '../src/db/schema.js';
import { createOrReuseEssaySubmission } from '../src/services/essay-submission.js';

function createFixtureDb() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(schemaSql);

  const addUser = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
  const teacherUserId = addUser.run('teacher', '123456', 'teacher', '陈老师').lastInsertRowid;
  const studentUserId = addUser.run('student', '123456', 'student', '陈振聪').lastInsertRowid;

  const teacherId = database.prepare('INSERT INTO teachers (user_id, title, school) VALUES (?, ?, ?)')
    .run(teacherUserId, '教师', '示范高中').lastInsertRowid;
  const studentId = database.prepare('INSERT INTO students (user_id, student_no, grade, school) VALUES (?, ?, ?, ?)')
    .run(studentUserId, 's503001', '高一', '示范高中').lastInsertRowid;
  const classId = database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)')
    .run('高一（3）班', '高一', teacherId).lastInsertRowid;
  database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)')
    .run(classId, studentId);
  const assignmentId = database.prepare('INSERT INTO assignments (class_id, title, prompt, essay_type, full_score, allow_resubmit) VALUES (?, ?, ?, ?, ?, ?)')
    .run(classId, '周练', '写成议论文', '材料作文', 60, 0).lastInsertRowid;

  return {
    database,
    assignment: { id: assignmentId, title: '周练', allow_resubmit: 0 },
    studentId
  };
}

test('same clientSubmissionKey reuses the existing essay and does not create duplicates', () => {
  const fixture = createFixtureDb();

  const first = createOrReuseEssaySubmission(fixture.database, {
    assignment: fixture.assignment,
    studentId: fixture.studentId,
    title: '周练',
    essayText: '这是一篇图片提交作文。',
    attachments: [{ kind: 'image', name: 'essay-1.jpg', size: 1234, mimeType: 'image/jpeg' }],
    clientSubmissionKey: 'client-key-001',
    submitRound: 1,
    submissionStatus: 'submitted'
  });

  const second = createOrReuseEssaySubmission(fixture.database, {
    assignment: fixture.assignment,
    studentId: fixture.studentId,
    title: '周练',
    essayText: '这是一篇图片提交作文。',
    attachments: [{ kind: 'image', name: 'essay-1.jpg', size: 1234, mimeType: 'image/jpeg' }],
    clientSubmissionKey: 'client-key-001',
    submitRound: 2,
    submissionStatus: 'submitted'
  });

  const count = fixture.database.prepare('SELECT COUNT(*) AS count FROM essays WHERE student_id = ? AND assignment_id = ?')
    .get(fixture.studentId, fixture.assignment.id).count;

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.essayId, second.essayId);
  assert.equal(count, 1);
});
