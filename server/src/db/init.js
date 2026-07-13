import { db } from './connection.js';
import { schemaSql } from './schema.js';

export function relaxInviteCodeConstraint(database = db) {
  const inviteColumn = database.prepare("PRAGMA table_info('classes')").all()
    .find((column) => column.name === 'invite_code');
  if (!inviteColumn || inviteColumn.notnull === 0) return;

  database.exec('PRAGMA foreign_keys = OFF');
  database.exec('PRAGMA legacy_alter_table = ON');
  try {
    database.exec(`
      BEGIN;
      ALTER TABLE classes RENAME TO classes_required_invite_legacy;
      CREATE TABLE classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        grade TEXT,
        teacher_id INTEGER NOT NULL,
        invite_code TEXT UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
      );
      INSERT INTO classes (id, name, grade, teacher_id, invite_code, created_at)
      SELECT id, name, grade, teacher_id, invite_code, created_at
      FROM classes_required_invite_legacy;
      DROP TABLE classes_required_invite_legacy;
      COMMIT;
    `);
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch {}
    throw error;
  } finally {
    database.exec('PRAGMA legacy_alter_table = OFF');
    database.exec('PRAGMA foreign_keys = ON');
  }
}

export function initDatabase() {
  db.exec(schemaSql);
  relaxInviteCodeConstraint(db);
  try { db.exec("ALTER TABLE ai_reviews ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP"); } catch(e) {}
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count > 0) return;

  const insertUser = db.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
  const teacherUser = insertUser.run('teacher', '123456', 'teacher', '陈老师').lastInsertRowid;
  const studentUser = insertUser.run('student', '123456', 'student', '林同学').lastInsertRowid;

  const teacherId = db.prepare('INSERT INTO teachers (user_id, title, school) VALUES (?, ?, ?)').run(teacherUser, '高中语文教师', '示范高中').lastInsertRowid;
  const studentId = db.prepare('INSERT INTO students (user_id, student_no, grade, school) VALUES (?, ?, ?, ?)').run(studentUser, '2026001', '高三', '示范高中').lastInsertRowid;
  const classId = db.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)').run('高三语文示范班', '高三', teacherId).lastInsertRowid;
  db.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(classId, studentId);
  db.prepare('INSERT INTO assignments (class_id, title, prompt, essay_type, full_score, deadline) VALUES (?, ?, ?, ?, ?, ?)')
    .run(classId, '时代青年与精神成长', '阅读材料后，请围绕“时代浪潮中的青年选择”写一篇不少于800字的文章。', '材料作文', 60, '2026-07-01');
  db.prepare('INSERT INTO student_profiles (student_id, growth_report) VALUES (?, ?)').run(studentId, '已建立作文成长档案，等待更多写作记录形成趋势。');
}

if (process.argv[1]?.endsWith('init.js')) {
  initDatabase();
  console.log('SQLite database initialized.');
}
