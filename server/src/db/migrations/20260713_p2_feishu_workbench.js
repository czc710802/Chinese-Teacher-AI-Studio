const MIGRATION_ID = '20260713_p2_feishu_workbench';

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

function ensureFeishuClassBindingColumns(database) {
  if (!tableExists(database, 'feishu_class_bindings')) {
    database.exec(`
      CREATE TABLE feishu_class_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL,
        class_id INTEGER NOT NULL,
        feishu_chat_id TEXT NOT NULL,
        feishu_chat_name TEXT DEFAULT '',
        tenant_key TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        is_primary INTEGER NOT NULL DEFAULT 1,
        last_tested_at TEXT,
        last_test_status TEXT DEFAULT '',
        last_error_code TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(class_id, feishu_chat_id),
        FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE,
        FOREIGN KEY(class_id) REFERENCES classes(id) ON DELETE CASCADE
      );
    `);
    return;
  }

  addColumnIfMissing(database, 'feishu_class_bindings', 'tenant_key', "TEXT DEFAULT ''");
  addColumnIfMissing(database, 'feishu_class_bindings', 'last_tested_at', 'TEXT');
  addColumnIfMissing(database, 'feishu_class_bindings', 'last_test_status', "TEXT DEFAULT ''");
  addColumnIfMissing(database, 'feishu_class_bindings', 'last_error_code', "TEXT DEFAULT ''");
}

export function applyP2FeishuWorkbenchMigration(database) {
  ensureMigrationTable(database);
  ensureFeishuClassBindingColumns(database);

  database.exec(`
    CREATE TABLE IF NOT EXISTS feishu_teacher_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL,
      feishu_open_id TEXT NOT NULL,
      feishu_union_id TEXT DEFAULT '',
      tenant_key TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      verified_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(teacher_id, tenant_key),
      UNIQUE(feishu_open_id, tenant_key),
      FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS feishu_action_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_type TEXT NOT NULL,
      actor_id TEXT DEFAULT '',
      feishu_open_id TEXT DEFAULT '',
      action TEXT NOT NULL,
      resource_type TEXT DEFAULT '',
      resource_id TEXT DEFAULT '',
      request_id TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'success',
      error_code TEXT DEFAULT '',
      details TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS feishu_message_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_type TEXT NOT NULL,
      resource_type TEXT DEFAULT '',
      resource_id TEXT DEFAULT '',
      feishu_chat_id TEXT DEFAULT '',
      receiver_open_id TEXT DEFAULT '',
      request_id TEXT DEFAULT '',
      idempotency_key TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      error_code TEXT DEFAULT '',
      sent_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS feishu_card_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT DEFAULT '',
      operator_open_id TEXT DEFAULT '',
      action_name TEXT NOT NULL,
      resource_type TEXT DEFAULT '',
      resource_id TEXT DEFAULT '',
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processed',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS feishu_teacher_binding_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      teacher_id INTEGER NOT NULL,
      code_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_by TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_feishu_teacher_bindings_teacher_id ON feishu_teacher_bindings(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_feishu_teacher_bindings_open_id ON feishu_teacher_bindings(feishu_open_id);
    CREATE INDEX IF NOT EXISTS idx_feishu_teacher_bindings_status ON feishu_teacher_bindings(status);
    CREATE INDEX IF NOT EXISTS idx_feishu_class_bindings_teacher_id ON feishu_class_bindings(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_feishu_class_bindings_chat_id ON feishu_class_bindings(feishu_chat_id);
    CREATE INDEX IF NOT EXISTS idx_feishu_class_bindings_status ON feishu_class_bindings(status);
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_feishu_class_primary_group ON feishu_class_bindings(class_id) WHERE is_primary = 1 AND status = 'active';
    CREATE INDEX IF NOT EXISTS idx_feishu_action_logs_actor ON feishu_action_logs(actor_type, actor_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_feishu_action_logs_request_id ON feishu_action_logs(request_id) WHERE request_id <> '';
    CREATE INDEX IF NOT EXISTS idx_feishu_action_logs_action ON feishu_action_logs(action, created_at);
    CREATE INDEX IF NOT EXISTS idx_feishu_message_logs_chat_id ON feishu_message_logs(feishu_chat_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_feishu_message_logs_idempotency ON feishu_message_logs(idempotency_key) WHERE idempotency_key <> '';
    CREATE INDEX IF NOT EXISTS idx_feishu_card_interactions_event_id ON feishu_card_interactions(event_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_feishu_card_interactions_idempotency ON feishu_card_interactions(idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_feishu_teacher_binding_codes_teacher_id ON feishu_teacher_binding_codes(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_feishu_teacher_binding_codes_status ON feishu_teacher_binding_codes(status);
  `);

  markApplied(database);
}

export function rollbackP2FeishuWorkbenchMigration(database) {
  ensureMigrationTable(database);
  database.exec(`
    DROP INDEX IF EXISTS idx_feishu_teacher_bindings_teacher_id;
    DROP INDEX IF EXISTS idx_feishu_teacher_bindings_open_id;
    DROP INDEX IF EXISTS idx_feishu_teacher_bindings_status;
    DROP INDEX IF EXISTS uniq_feishu_class_primary_group;
    DROP INDEX IF EXISTS idx_feishu_class_bindings_teacher_id;
    DROP INDEX IF EXISTS idx_feishu_class_bindings_chat_id;
    DROP INDEX IF EXISTS idx_feishu_class_bindings_status;
    DROP INDEX IF EXISTS idx_feishu_action_logs_actor;
    DROP INDEX IF EXISTS idx_feishu_action_logs_request_id;
    DROP INDEX IF EXISTS idx_feishu_action_logs_action;
    DROP INDEX IF EXISTS idx_feishu_message_logs_chat_id;
    DROP INDEX IF EXISTS idx_feishu_message_logs_idempotency;
    DROP INDEX IF EXISTS idx_feishu_card_interactions_event_id;
    DROP INDEX IF EXISTS idx_feishu_card_interactions_idempotency;
    DROP INDEX IF EXISTS idx_feishu_teacher_binding_codes_teacher_id;
    DROP INDEX IF EXISTS idx_feishu_teacher_binding_codes_status;
    DROP TABLE IF EXISTS feishu_teacher_binding_codes;
    DROP TABLE IF EXISTS feishu_card_interactions;
    DROP TABLE IF EXISTS feishu_message_logs;
    DROP TABLE IF EXISTS feishu_action_logs;
    DROP TABLE IF EXISTS feishu_teacher_bindings;
  `);
  markRolledBack(database);
}

export function getP2FeishuWorkbenchMigrationId() {
  return MIGRATION_ID;
}
