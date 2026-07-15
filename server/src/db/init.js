import { db } from './connection.js';
import { schemaSql } from './schema.js';
import { applyP2FeishuWorkbenchMigration } from './migrations/20260713_p2_feishu_workbench.js';
import { applyP3MobileClassLifecycleMigration } from './migrations/20260715_p3_mobile_class_lifecycle.js';

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
        invite_code_expires_at TEXT,
        join_mode TEXT NOT NULL DEFAULT 'approval',
        status TEXT NOT NULL DEFAULT 'active',
        max_students INTEGER DEFAULT 0,
        archived_at TEXT,
        deleted_at TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
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
  try {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${ddl}`);
  } catch (error) {
    const message = String(error?.message || '');
    if (!message.includes('non-constant default')) throw error;
    const fallbackDdl = String(ddl)
      .replace(/\s+NOT\s+NULL/ig, '')
      .replace(/\s+DEFAULT\s+(?:'[^']*'|"[^"]*"|[^\s,]+)/ig, '');
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${fallbackDdl}`);
  }
}

function migrateClassLifecycleWorkflow(database = db) {
  addColumnIfMissing(database, 'classes', 'invite_code_expires_at', 'TEXT');
  addColumnIfMissing(database, 'classes', 'join_mode', 'TEXT');
  addColumnIfMissing(database, 'classes', 'status', 'TEXT');
  addColumnIfMissing(database, 'classes', 'max_students', 'INTEGER');
  addColumnIfMissing(database, 'classes', 'archived_at', 'TEXT');
  addColumnIfMissing(database, 'classes', 'deleted_at', 'TEXT');
  addColumnIfMissing(database, 'classes', 'updated_at', 'TEXT');
  database.exec(`
    UPDATE classes
    SET join_mode = COALESCE(NULLIF(join_mode, ''), 'approval'),
        status = COALESCE(NULLIF(status, ''), 'active'),
        max_students = COALESCE(max_students, 0),
        updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
    WHERE join_mode IS NULL OR status IS NULL OR max_students IS NULL OR updated_at IS NULL
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS student_class_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      class_id INTEGER NOT NULL,
      join_mode TEXT NOT NULL DEFAULT 'approval',
      status TEXT NOT NULL DEFAULT 'active',
      joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
      left_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(student_id, class_id),
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
      FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS class_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      invite_code TEXT NOT NULL,
      invite_token TEXT NOT NULL,
      invite_token_hash TEXT NOT NULL,
      join_mode TEXT NOT NULL DEFAULT 'approval',
      max_uses INTEGER DEFAULT 0,
      used_count INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_by_user_id TEXT DEFAULT '',
      created_by_role TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(class_id, invite_code),
      UNIQUE(invite_token_hash),
      FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS class_join_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_id INTEGER NOT NULL,
      student_id INTEGER,
      student_name TEXT NOT NULL,
      student_no TEXT DEFAULT '',
      source TEXT DEFAULT 'web',
      status TEXT NOT NULL DEFAULT 'pending',
      invite_id INTEGER,
      metadata TEXT DEFAULT '{}',
      requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      reviewed_by_user_id TEXT DEFAULT '',
      review_reason TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE SET NULL,
      FOREIGN KEY(invite_id) REFERENCES class_invites(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS class_membership_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operator_id TEXT DEFAULT '',
      operator_role TEXT DEFAULT '',
      target_type TEXT NOT NULL DEFAULT '',
      target_id TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      before_state TEXT DEFAULT '{}',
      after_state TEXT DEFAULT '{}',
      reason TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  database.exec('CREATE INDEX IF NOT EXISTS idx_student_class_bindings_student_id ON student_class_bindings(student_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_student_class_bindings_class_id ON student_class_bindings(class_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_class_invites_class_id ON class_invites(class_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_class_invites_status ON class_invites(status)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_class_join_requests_class_id ON class_join_requests(class_id)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_class_join_requests_status ON class_join_requests(status)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_class_membership_audit_logs_target ON class_membership_audit_logs(target_type, target_id)');
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
  addColumnIfMissing(database, 'assignments', 'data_scope', 'TEXT');
  addColumnIfMissing(database, 'assignments', 'fixture_key', 'TEXT');
  addColumnIfMissing(database, 'assignments', 'status', "TEXT NOT NULL DEFAULT 'published'");
  addColumnIfMissing(database, 'assignments', 'archived_at', 'TEXT');
  addColumnIfMissing(database, 'assignments', 'deleted_at', 'TEXT');
  addColumnIfMissing(database, 'assignments', 'requires_teacher_review', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(database, 'assignments', 'auto_grading', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(database, 'assignments', 'allow_student_view_result', 'INTEGER NOT NULL DEFAULT 1');
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
  database.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_fixture_key ON assignments(fixture_key) WHERE fixture_key IS NOT NULL AND fixture_key != ''");
  database.exec('CREATE INDEX IF NOT EXISTS idx_assignments_class_scope_status ON assignments(class_id, data_scope, status)');
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
  try { db.exec("ALTER TABLE classes ADD COLUMN data_scope TEXT NOT NULL DEFAULT 'production'"); } catch (error) {
    if (!String(error?.message || '').includes('duplicate column name')) throw error;
  }
  try { db.exec("ALTER TABLE students ADD COLUMN data_scope TEXT NOT NULL DEFAULT 'production'"); } catch (error) {
    if (!String(error?.message || '').includes('duplicate column name')) throw error;
  }
}

export function initDatabase() {
  db.exec(schemaSql);
  relaxUserRoleConstraint(db);
  relaxInviteCodeConstraint(db);
  migrateAssignmentWorkflow(db);
  migrateClassLifecycleWorkflow(db);
  applyP2FeishuWorkbenchMigration(db);
  applyP3MobileClassLifecycleMigration(db);
  try { db.exec("ALTER TABLE ai_reviews ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP"); } catch(e) {}
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count > 0) return;

  const insertUser = db.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
  const teacherUser = insertUser.run('teacher', '123456', 'teacher', '陈老师').lastInsertRowid;

  const teacherId = db.prepare('INSERT INTO teachers (user_id, title, school) VALUES (?, ?, ?)').run(teacherUser, '高中语文教师', '示范高中').lastInsertRowid;
  db.prepare('INSERT INTO classes (name, grade, teacher_id, data_scope) VALUES (?, ?, ?, ?)')
    .run('高三语文示范班', '高三', teacherId, 'system_test');
}

if (process.argv[1]?.endsWith('init.js')) {
  initDatabase();
  console.log('SQLite database initialized.');
}
