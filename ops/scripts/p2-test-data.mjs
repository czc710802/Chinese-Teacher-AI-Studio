import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { schemaSql } from '../../server/src/db/schema.js';
import { applyP2FeishuWorkbenchMigration } from '../../server/src/db/migrations/20260713_p2_feishu_workbench.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');
const databasePath = process.env.P2_TEST_DB_PATH || process.env.DATABASE_PATH || path.join(appDir, 'data', 'p2-stage3-test.sqlite');
const mode = process.argv.includes('--clean') ? 'clean' : 'init';
const password = process.env.P2_TEST_PASSWORD || `TEST-${Date.now()}`;

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec('PRAGMA foreign_keys = ON');
database.exec(schemaSql);
applyP2FeishuWorkbenchMigration(database);

function clean() {
  database.exec(`
    DELETE FROM feishu_action_logs WHERE actor_id LIKE 'TEST-%' OR resource_id LIKE 'TEST-%';
    DELETE FROM feishu_card_interactions WHERE resource_id LIKE 'TEST-%';
    DELETE FROM feishu_teacher_binding_codes WHERE created_by = 'TEST-SEED';
    DELETE FROM feishu_teacher_bindings WHERE tenant_key = 'TEST-TENANT';
    DELETE FROM feishu_class_bindings WHERE tenant_key = 'TEST-TENANT';
    DELETE FROM assignments WHERE public_id LIKE 'TEST-P2-%';
    DELETE FROM class_students WHERE class_id IN (SELECT id FROM classes WHERE name LIKE 'TEST P2%');
    DELETE FROM classes WHERE name LIKE 'TEST P2%';
    DELETE FROM students WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'test-p2-student-%');
    DELETE FROM teachers WHERE user_id IN (SELECT id FROM users WHERE username = 'test-p2-teacher');
    DELETE FROM users WHERE username IN ('test-p2-admin', 'test-p2-teacher')
       OR username LIKE 'test-p2-student-%';
  `);
}

function insertUser(username, role, name) {
  const existing = database.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return existing.id;
  return database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)')
    .run(username, password, role, name).lastInsertRowid;
}

if (mode === 'clean') {
  clean();
  database.close();
  console.log(JSON.stringify({ ok: true, mode, databasePath }, null, 2));
  process.exit(0);
}

clean();
const adminUserId = insertUser('test-p2-admin', 'admin', 'TEST P2 管理员');
const teacherUserId = insertUser('test-p2-teacher', 'teacher', 'TEST P2 陈老师');
const teacherId = database.prepare('INSERT INTO teachers (user_id, title, school) VALUES (?, ?, ?)').run(teacherUserId, '高中语文教师', 'TEST P2 中学').lastInsertRowid;
const classId = database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)').run('TEST P2 高二1班', '高二', teacherId).lastInsertRowid;
for (let index = 1; index <= 3; index += 1) {
  const userId = insertUser(`test-p2-student-${index}`, 'student', `TEST P2 学生${index}`);
  const studentId = database.prepare('INSERT INTO students (user_id, student_no, grade, school) VALUES (?, ?, ?, ?)').run(userId, `TP2${index}`, '高二', 'TEST P2 中学').lastInsertRowid;
  database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(classId, studentId);
}
const assignmentId = database.prepare(`
  INSERT INTO assignments
    (class_id, public_id, title, prompt, essay_type, full_score, deadline, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(classId, 'TEST-P2-001', 'TEST P2 青年责任作文', '围绕青年责任写一篇议论文。', '材料作文', 60, '2026-07-20T20:00:00', 'published').lastInsertRowid;
database.close();

console.log(JSON.stringify({
  ok: true,
  mode,
  databasePath,
  admin: 'test-p2-admin',
  teacher: 'test-p2-teacher',
  passwordSource: process.env.P2_TEST_PASSWORD ? 'P2_TEST_PASSWORD' : 'generated-once',
  teacherId,
  classId,
  assignmentId
}, null, 2));
