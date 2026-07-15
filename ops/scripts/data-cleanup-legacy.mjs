import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { buildLegacyCleanupDryRun, writeLegacyCleanupReport } from '../../server/src/services/legacy-cleanup.js';
import { schemaSql } from '../../server/src/db/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');
const databasePath = process.env.DATABASE_PATH || path.join(appDir, 'data', 'essay-review.sqlite');
const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
const mode = (modeArg ? modeArg.split('=')[1] : 'dry-run').trim();

function openDatabase() {
  if (!fs.existsSync(databasePath)) {
    throw new Error(`数据库不存在：${databasePath}`);
  }
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(schemaSql);
  return database;
}

function printSummary(report, files = {}) {
  const summary = {
    ok: true,
    mode: 'dry-run',
    generatedAt: report.generatedAt,
    backupPath: report.backupPath || '',
    fixture: report.fixture,
    teacherManagement: {
      classes: report.teacherManagement?.totals?.classes || 0,
      students: report.teacherManagement?.totals?.students || 0,
      essays: report.teacherManagement?.totals?.essays || 0,
      tasks: report.teacherManagement?.totals?.tasks || 0,
      comments: report.teacherManagement?.totals?.comments || 0
    },
    sqlite: report.sqlite ? {
      classes: report.sqlite.tables?.classes || 0,
      students: report.sqlite.tables?.students || 0,
      class_students: report.sqlite.tables?.class_students || 0,
      student_class_bindings: report.sqlite.tables?.student_class_bindings || 0,
      assignments: report.sqlite.tables?.assignments || 0,
      essays: report.sqlite.tables?.essays || 0,
      ai_reviews: report.sqlite.tables?.ai_reviews || 0,
      teacher_comments: report.sqlite.tables?.teacher_comments || 0,
      ai_upgrade_records: report.sqlite.tables?.ai_upgrade_records || 0,
      student_profiles: report.sqlite.tables?.student_profiles || 0,
      feishu_bindings: report.sqlite.tables?.feishu_class_bindings || 0
    } : null,
    keep: report.keep || [],
    archive: report.archive || [],
    logicalDelete: report.logicalDelete || [],
    physicalDelete: report.physicalDelete || [],
    files
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (mode !== 'dry-run') {
  process.stdout.write(`${JSON.stringify({
    ok: false,
    mode,
    message: '本阶段仅允许 dry-run。execute / rollback 已保留脚本入口，但尚未启用真实删除。'
  }, null, 2)}\n`);
  process.exit(0);
}

const database = openDatabase();
try {
  const report = buildLegacyCleanupDryRun({ appDir, database });
  const files = writeLegacyCleanupReport(appDir, report);
  printSummary(report, files);
} finally {
  database.close();
}
