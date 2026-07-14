import { db } from './connection.js';
import { schemaSql } from './schema.js';
import { applyP2FeishuWorkbenchMigration } from './migrations/20260713_p2_feishu_workbench.js';

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

function addColumnIfMissing(database, tableName, columnName, ddl) {
  const exists = database.prepare(`PRAGMA table_info('${tableName}')`).all()
    .some((column) => column.name === columnName);
  if (exists) return;
  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${ddl}`);
}

export function relaxUserRoleConstraint(database = db) {
  const row = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  const sql = String(row?.sql || '');
  if (!sql || sql.includes("'admin'")) return;

  database.exec('PRAGMA foreign_keys = OFF');
  database.exec('PRAGMA legacy_alter_table = ON');
  try {
    database.exec(`
      BEGIN;
      ALTER TABLE users RENAME TO users_role_legacy;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('student','teacher','admin')),
        name TEXT NOT NULL,
        phone TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users (id, username, password, role, name, phone, created_at)
      SELECT id, username, password, role, name, phone, created_at
      FROM users_role_legacy;
      DROP TABLE users_role_legacy;
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

export function migrateAssignmentWorkflow(database = db) {
  addColumnIfMissing(database, 'assignments', 'public_id', 'TEXT');
  addColumnIfMissing(database, 'assignments', 'requirements', "TEXT DEFAULT ''");
  addColumnIfMissing(database, 'assignments', 'grade', 'TEXT');
  addColumnIfMissing(database, 'assignments', 'min_words', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'assignments', 'max_words', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'assignments', 'scoring_standard', "TEXT DEFAULT ''");
  addColumnIfMissing(database, 'assignments', 'status', "TEXT NOT NULL DEFAULT 'published'");
  addColumnIfMissing(database, 'assignments', 'allow_resubmit', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'assignments', 'allow_late_submit', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'assignments', 'second_draft_enabled', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(database, 'assignments', 'reminder_enabled', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(database, 'assignments', 'published_at', 'TEXT');
  addColumnIfMissing(database, 'assignments', 'share_url', "TEXT DEFAULT ''");
  addColumnIfMissing(database, 'assignments', 'qr_svg', "TEXT DEFAULT ''");
  addColumnIfMissing(database, 'assignments', 'feishu_chat_id', "TEXT DEFAULT ''");

  addColumnIfMissing(database, 'essays', 'attachments', "TEXT DEFAULT '[]'");
  addColumnIfMissing(database, 'essays', 'word_count', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'essays', 'grading_status', "TEXT NOT NULL DEFAULT 'pending'");
  addColumnIfMissing(database, 'essays', 'report_id', 'INTEGER');
  addColumnIfMissing(database, 'essays', 'submitted_at', 'TEXT');
  addColumnIfMissing(database, 'ai_reviews', 'version_number', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(database, 'ai_reviews', 'report_version', "TEXT DEFAULT '2.0'");
  addColumnIfMissing(database, 'ai_reviews', 'prompt_version', "TEXT DEFAULT ''");
  addColumnIfMissing(database, 'ai_reviews', 'prompt_text', "TEXT DEFAULT ''");
  addColumnIfMissing(database, 'ai_reviews', 'prompt_mode', "TEXT DEFAULT ''");
  addColumnIfMissing(database, 'ai_reviews', 'model', "TEXT DEFAULT ''");
  addColumnIfMissing(database, 'ai_reviews', 'source_type', "TEXT DEFAULT ''");
  addColumnIfMissing(database, 'ai_reviews', 'grading_job_id', "TEXT DEFAULT ''");
  addColumnIfMissing(database, 'ai_reviews', 'rerun_reason', "TEXT DEFAULT ''");
  addColumnIfMissing(database, 'ai_reviews', 'created_by_user_id', "TEXT DEFAULT ''");
  addColumnIfMissing(database, 'ai_reviews', 'created_by_role', "TEXT DEFAULT ''");
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_public_id ON assignments(public_id) WHERE public_id IS NOT NULL');
  database.exec('CREATE INDEX IF NOT EXISTS idx_ai_reviews_essay_version ON ai_reviews(essay_id, version_number DESC, id DESC)');

  database.exec(`
    CREATE TABLE IF NOT EXISTS submission_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      title TEXT,
      content TEXT NOT NULL DEFAULT '',
      attachments TEXT DEFAULT '[]',
      word_count INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(assignment_id, student_id),
      FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE
    );
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS feishu_class_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      feishu_chat_id TEXT NOT NULL,
      feishu_chat_name TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      is_primary INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(class_id, feishu_chat_id),
      FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
      FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS feishu_student_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      feishu_open_id TEXT NOT NULL,
      feishu_union_id TEXT DEFAULT '',
      verified_at TEXT DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, class_id),
      UNIQUE(class_id, feishu_open_id),
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS feishu_assignment_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assignment_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      feishu_chat_id TEXT NOT NULL,
      message_id TEXT DEFAULT '',
      message_type TEXT NOT NULL DEFAULT 'assignment_publish',
      status TEXT NOT NULL DEFAULT 'sent',
      idempotency_key TEXT NOT NULL UNIQUE,
      sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
      revoked_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
      FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
    );
  `);
}

export function initDatabase() {
  db.exec(schemaSql);
  relaxUserRoleConstraint(db);
  relaxInviteCodeConstraint(db);
  migrateAssignmentWorkflow(db);
  applyP2FeishuWorkbenchMigration(db);
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
