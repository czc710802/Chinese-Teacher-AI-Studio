const MIGRATION_ID = '20260715_p3_mobile_class_lifecycle';

function tableExists(database, tableName) {
  return Boolean(database.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', tableName));
}

function columnExists(database, tableName, columnName) {
  if (!tableExists(database, tableName)) return false;
  return database.prepare(`PRAGMA table_info('${tableName}')`).all().some((column) => column.name === columnName);
}

function addColumnIfMissing(database, tableName, columnName, ddl) {
  if (columnExists(database, tableName, columnName)) return;
  database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${ddl}`);
}

function ensureMigrationTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function markApplied(database) {
  database.prepare(`
    INSERT INTO schema_migrations (id, applied_at)
    VALUES (?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET applied_at = excluded.applied_at
  `).run(MIGRATION_ID);
}

function markRolledBack(database) {
  database.prepare('DELETE FROM schema_migrations WHERE id = ?').run(MIGRATION_ID);
}

function applyClassLifecycleSchema(database) {
  addColumnIfMissing(database, 'classes', 'invite_code_expires_at', 'TEXT');
  addColumnIfMissing(database, 'classes', 'join_mode', "TEXT NOT NULL DEFAULT 'approval'");
  addColumnIfMissing(database, 'classes', 'status', "TEXT NOT NULL DEFAULT 'active'");
  addColumnIfMissing(database, 'classes', 'max_students', 'INTEGER DEFAULT 0');
  addColumnIfMissing(database, 'classes', 'archived_at', 'TEXT');
  addColumnIfMissing(database, 'classes', 'deleted_at', 'TEXT');
  addColumnIfMissing(database, 'classes', 'updated_at', 'TEXT');

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

export function applyP3MobileClassLifecycleMigration(database) {
  ensureMigrationTable(database);
  applyClassLifecycleSchema(database);
  markApplied(database);
}

export function rollbackP3MobileClassLifecycleMigration(database) {
  ensureMigrationTable(database);
  database.exec(`
    DROP INDEX IF EXISTS idx_student_class_bindings_student_id;
    DROP INDEX IF EXISTS idx_student_class_bindings_class_id;
    DROP INDEX IF EXISTS idx_class_invites_class_id;
    DROP INDEX IF EXISTS idx_class_invites_status;
    DROP INDEX IF EXISTS idx_class_join_requests_class_id;
    DROP INDEX IF EXISTS idx_class_join_requests_status;
    DROP INDEX IF EXISTS idx_class_membership_audit_logs_target;
    DROP TABLE IF EXISTS class_membership_audit_logs;
    DROP TABLE IF EXISTS class_join_requests;
    DROP TABLE IF EXISTS class_invites;
    DROP TABLE IF EXISTS student_class_bindings;
  `);

  if (columnExists(database, 'classes', 'join_mode')) {
    database.exec('PRAGMA foreign_keys = OFF');
    database.exec('PRAGMA legacy_alter_table = ON');
    try {
      database.exec(`
        BEGIN;
        ALTER TABLE classes RENAME TO classes_p3_mobile_legacy;
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
        FROM classes_p3_mobile_legacy;
        DROP TABLE classes_p3_mobile_legacy;
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

  markRolledBack(database);
}

export function getP3MobileClassLifecycleMigrationId() {
  return MIGRATION_ID;
}
