import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { schemaSql } from '../../server/src/db/schema.js';
import {
  buildLegacyCleanupDryRun,
  buildSystemTestCenterSnapshot
} from '../../server/src/services/legacy-cleanup.js';
import {
  createTestEnvironmentBackup,
  getTestEnvironmentStatus,
  resetSystemTestEnvironment,
  rollbackTestEnvironment
} from '../../server/src/services/test-environment.js';
import { applyP3MobileClassLifecycleMigration } from '../../server/src/db/migrations/20260715_p3_mobile_class_lifecycle.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');
const databasePath = process.env.DATABASE_PATH || path.join(appDir, 'data', 'essay-review.sqlite');
const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
const mode = (modeArg ? modeArg.split('=')[1] : 'audit').trim();
const confirmArg = process.argv.find((arg) => arg.startsWith('--confirm='));
const confirmText = confirmArg ? confirmArg.split('=')[1] : '';
const backupArg = process.argv.find((arg) => arg.startsWith('--backup-path='));
const backupPath = backupArg ? backupArg.split('=')[1] : '';

function openDatabase() {
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(schemaSql);
  applyP3MobileClassLifecycleMigration(database);
  return database;
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

if (mode === 'audit') {
  const database = openDatabase();
  try {
    const backup = createTestEnvironmentBackup(appDir, database);
    const dryRun = buildLegacyCleanupDryRun({ appDir, database, backupPath: backup.backupPath });
    printJson({
      ok: true,
      mode,
      databasePath,
      backupPath: backup.backupPath,
      manifest: backup.manifest,
      dryRun,
      snapshot: buildSystemTestCenterSnapshot({ appDir, database, backupPath: backup.backupPath })
    });
  } finally {
    database.close();
  }
  process.exit(0);
}

if (mode === 'dry-run') {
  const database = openDatabase();
  try {
    const backup = createTestEnvironmentBackup(appDir, database);
    const dryRun = buildLegacyCleanupDryRun({ appDir, database, backupPath: backup.backupPath });
    printJson({
      ok: true,
      mode,
      databasePath,
      backupPath: backup.backupPath,
      manifest: backup.manifest,
      dryRun,
      snapshot: buildSystemTestCenterSnapshot({ appDir, database, backupPath: backup.backupPath })
    });
  } finally {
    database.close();
  }
  process.exit(0);
}

if (mode === 'status') {
  const database = openDatabase();
  try {
    printJson(getTestEnvironmentStatus({ appDir, database }));
  } finally {
    database.close();
  }
  process.exit(0);
}

if (mode === 'reset') {
  if (confirmText !== 'RESET SYSTEM TEST') {
    printJson({
      ok: false,
      mode,
      message: '需要确认文本：RESET SYSTEM TEST'
    });
    process.exit(1);
  }

  const database = openDatabase();
  try {
    printJson(resetSystemTestEnvironment({ appDir, database }));
  } finally {
    database.close();
  }
  process.exit(0);
}

if (mode === 'rollback') {
  printJson(rollbackTestEnvironment({ appDir, backupPath }));
  process.exit(0);
}

printJson({
  ok: false,
  mode,
  message: '不支持的 test-env 模式'
});
process.exit(1);
