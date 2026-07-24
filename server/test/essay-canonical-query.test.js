import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { canonicalEssayIdsSql } from '../src/services/essay-submission.js';
import { schemaSql } from '../src/db/schema.js';

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

  return { database, assignmentId, studentId };
}

test('canonical essay query keeps only the latest row per submission group', () => {
  const { database, assignmentId, studentId } = createFixtureDb();

  const insertEssay = database.prepare(`
    INSERT INTO essays (
      id, assignment_id, student_id, title, original_text, revised_text, attachments, word_count, status, grading_status, submit_round, client_submission_key, submission_group_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertEssay.run(1, assignmentId, studentId, '周练', '第一版', '', '[]', 5, 'submitted', 'graded', 1, 'client-001', 'group-001', '2026-07-24 10:00:00', '2026-07-24 10:00:00');
  insertEssay.run(2, assignmentId, studentId, '周练', '第一版重复重试', '', '[]', 5, 'submitted', 'graded', 2, 'client-002', 'group-001', '2026-07-24 10:01:00', '2026-07-24 10:01:00');
  insertEssay.run(3, assignmentId, studentId, '周练', '第二组内容', '', '[]', 6, 'submitted', 'graded', 1, 'client-003', 'group-002', '2026-07-24 10:02:00', '2026-07-24 10:02:00');

  const rows = database.prepare(`
    ${canonicalEssayIdsSql('e')}
    SELECT e.id, e.original_text, e.client_submission_key, e.submission_group_key
    FROM canonical_essays ce
    JOIN essays e ON e.id = ce.id
    WHERE e.student_id = ?
    ORDER BY e.id
  `).all(studentId);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.id), [2, 3]);
  assert.deepEqual(rows.map((row) => row.original_text), ['第一版重复重试', '第二组内容']);
});
