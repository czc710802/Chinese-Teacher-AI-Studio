import fs from 'node:fs';
import path from 'node:path';

import { createLifecycleClass } from './class-lifecycle.js';
import { ensureSystemTestFixture, buildLegacyCleanupDryRun, buildSystemTestCenterSnapshot } from './legacy-cleanup.js';

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

function currentYear() {
  return String(new Date().getFullYear());
}

function tableExists(database, table) {
  try {
    return Boolean(database.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get('table', table));
  } catch {
    return false;
  }
}

function countTable(database, table) {
  if (!database || !tableExists(database, table)) return 0;
  try {
    return Number(database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get()?.count || 0);
  } catch {
    return 0;
  }
}

function normalizeScope(value, fallback = 'production') {
  const scope = String(value ?? '').trim().toLowerCase();
  if (['system_test', 'production', 'migrated_legacy'].includes(scope)) return scope;
  return fallback;
}

function scopeCountsFromRows(rows = []) {
  const summary = { system_test: 0, production: 0, migrated_legacy: 0, unknown: 0 };
  for (const row of rows) {
    const scope = normalizeScope(row.data_scope || row.dataScope || row.scope || '');
    if (summary[scope] == null) summary.unknown += 1;
    else summary[scope] += 1;
  }
  return summary;
}

function testBackupRoot(appDir) {
  return path.join(appDir, 'data', 'backups', 'test-env');
}

function safeCopy(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.cpSync(src, dest, { recursive: true, force: true });
  } else {
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
  }
  return true;
}

function safeRemove(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

function latestTestBackup(appDir) {
  const root = testBackupRoot(appDir);
  if (!fs.existsSync(root)) return '';
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((item) => item.isDirectory())
    .map((item) => {
      const fullPath = path.join(root, item.name);
      const stat = fs.statSync(fullPath);
      return { fullPath, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries[0]?.fullPath || '';
}

function databaseSummary(database) {
  const tables = [
    'classes',
    'students',
    'class_students',
    'student_class_bindings',
    'class_join_requests',
    'class_invites',
    'assignments',
    'submission_drafts',
    'essays',
    'essay_images',
    'ai_reviews',
    'teacher_comments',
    'student_profiles',
    'export_records',
    'ai_tutor_conversations',
    'ai_writing_exercises',
    'ai_upgrade_records',
    'mock_marking_records',
    'teacher_reports',
    'student_weekly_reports',
    'feishu_action_logs',
    'feishu_card_interactions',
    'feishu_message_logs',
    'feishu_class_bindings',
    'feishu_student_bindings',
    'feishu_assignment_messages',
    'feishu_teacher_bindings',
    'feishu_teacher_binding_codes',
    'class_membership_audit_logs'
  ];

  const counts = Object.fromEntries(tables.map((table) => [table, countTable(database, table)]));
  const classes = tableExists(database, 'classes')
    ? database.prepare('SELECT id, name, grade, teacher_id, data_scope, status, invite_code FROM classes ORDER BY id').all()
    : [];
  const students = tableExists(database, 'students')
    ? database.prepare(`
      SELECT s.id, s.student_no, s.grade, s.school, s.data_scope, u.name AS student_name, u.username
      FROM students s
      JOIN users u ON u.id = s.user_id
      ORDER BY s.id
    `).all()
    : [];

  return {
    counts,
    scopeSummary: {
      classes: scopeCountsFromRows(classes),
      students: scopeCountsFromRows(students)
    },
    classes: classes.map((row) => ({
      id: Number(row.id),
      name: row.name,
      grade: row.grade || '',
      teacherId: row.teacher_id,
      dataScope: normalizeScope(row.data_scope || 'production'),
      status: row.status || 'active',
      inviteCode: row.invite_code || ''
    })),
    students: students.map((row) => ({
      id: Number(row.id),
      studentNo: row.student_no || '',
      studentName: row.student_name || '',
      username: row.username || '',
      grade: row.grade || '',
      school: row.school || '',
      dataScope: normalizeScope(row.data_scope || 'production')
    }))
  };
}

function teacherManagementSummary(appDir) {
  const files = ['classes', 'students', 'essays', 'tasks', 'teacher-comments', 'management-queue'];
  const result = {};
  for (const name of files) {
    const data = readJson(path.join(appDir, 'data', 'teacher-management', `${name}.json`), { version: '1.0', items: [] });
    result[name] = {
      count: Array.isArray(data.items) ? data.items.length : 0,
      testCount: Array.isArray(data.items) ? data.items.filter((item) => item.isTestData || normalizeScope(item.dataScope || item.scope || '') === 'system_test').length : 0
    };
  }
  return result;
}

function collectAudit(appDir, database) {
  const sqlite = databaseSummary(database);
  const store = teacherManagementSummary(appDir);
  const dryRun = buildLegacyCleanupDryRun({ appDir, database, backupPath: latestTestBackup(appDir) });
  return {
    generatedAt: new Date().toISOString(),
    backupPath: latestTestBackup(appDir),
    sqlite,
    teacherManagement: store,
    dryRun
  };
}

function backupTargets(appDir) {
  return [
    path.join(appDir, 'data', 'essay-review.sqlite'),
    path.join(appDir, 'data', 'archive-records.json'),
    path.join(appDir, 'data', 'essay-ai'),
    path.join(appDir, 'data', 'student-profiles'),
    path.join(appDir, 'data', 'teacher-management'),
    path.join(appDir, 'data', 'storage-queue'),
    path.join(appDir, 'data', 'student-profile-queue'),
    path.join(appDir, 'exports', 'teacher-management'),
    path.join(appDir, 'reports', 'cleanup'),
    path.join(appDir, 'server', 'exports'),
    path.join(appDir, 'server', 'uploads')
  ];
}

export function createTestEnvironmentBackup(appDir, database) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const root = path.join(testBackupRoot(appDir), stamp);
  fs.mkdirSync(root, { recursive: true });
  const manifest = {
    backupId: stamp,
    createdAt: new Date().toISOString(),
    source: appDir,
    copied: []
  };

  const sqlitePath = path.join(appDir, 'data', 'essay-review.sqlite');
  if (fs.existsSync(sqlitePath)) {
    const target = path.join(root, 'essay-review.sqlite');
    fs.copyFileSync(sqlitePath, target, fs.constants.COPYFILE_EXCL);
    manifest.copied.push(path.relative(root, target));
  }

  for (const targetPath of backupTargets(appDir).filter((item) => item !== sqlitePath)) {
    if (!fs.existsSync(targetPath)) continue;
    const relative = path.relative(appDir, targetPath);
    const destination = path.join(root, relative);
    safeCopy(targetPath, destination);
    manifest.copied.push(relative);
  }

  const summary = collectAudit(appDir, database);
  manifest.summary = summary;
  writeJson(path.join(root, 'manifest.json'), manifest);
  return { backupId: stamp, backupPath: root, manifest };
}

function collectSystemTestContext(database) {
  const classRows = tableExists(database, 'classes')
    ? database.prepare("SELECT id FROM classes WHERE LOWER(COALESCE(data_scope, 'production')) = 'system_test'").all()
    : [];
  const studentRows = tableExists(database, 'students')
    ? database.prepare("SELECT id, user_id FROM students WHERE LOWER(COALESCE(data_scope, 'production')) = 'system_test'").all()
    : [];
  const classIds = classRows.map((row) => Number(row.id)).filter((value) => Number.isInteger(value) && value > 0);
  const studentIds = studentRows.map((row) => Number(row.id)).filter((value) => Number.isInteger(value) && value > 0);
  const studentUserIds = studentRows.map((row) => Number(row.user_id)).filter((value) => Number.isInteger(value) && value > 0);
  const assignmentIds = classIds.length && tableExists(database, 'assignments')
    ? database.prepare(`SELECT id FROM assignments WHERE class_id IN (${classIds.map(() => '?').join(',')})`).all(...classIds).map((row) => Number(row.id)).filter((value) => Number.isInteger(value) && value > 0)
    : [];
  const essayIds = assignmentIds.length && tableExists(database, 'essays')
    ? database.prepare(`SELECT id FROM essays WHERE assignment_id IN (${assignmentIds.map(() => '?').join(',')})`).all(...assignmentIds).map((row) => Number(row.id)).filter((value) => Number.isInteger(value) && value > 0)
    : [];
  return { classIds, studentIds, studentUserIds, assignmentIds, essayIds };
}

function deleteWhereIn(database, table, column, values) {
  const ids = Array.from(new Set((values || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)));
  if (!ids.length || !tableExists(database, table)) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const result = database.prepare(`DELETE FROM "${table}" WHERE "${column}" IN (${placeholders})`).run(...ids);
  return Number(result.changes || 0);
}

function resetTeacherManagementStores(appDir, classRecord) {
  writeJson(path.join(appDir, 'data', 'teacher-management', 'classes.json'), {
    version: '1.0',
    items: classRecord ? [classRecord] : []
  });
  writeJson(path.join(appDir, 'data', 'teacher-management', 'students.json'), { version: '1.0', items: [] });
  writeJson(path.join(appDir, 'data', 'teacher-management', 'essays.json'), { version: '1.0', items: [] });
  writeJson(path.join(appDir, 'data', 'teacher-management', 'tasks.json'), { version: '1.0', items: [] });
  writeJson(path.join(appDir, 'data', 'teacher-management', 'teacher-comments.json'), { version: '1.0', items: [] });
  writeJson(path.join(appDir, 'data', 'teacher-management', 'management-queue.json'), { version: '1.0', items: [] });
  writeJson(path.join(appDir, 'data', 'archive-records.json'), { version: 1, records: [] });
  writeJson(path.join(appDir, 'data', 'essay-ai', 'records.json'), { version: 1, items: [] });

  for (const dir of [
    path.join(appDir, 'data', 'student-profiles'),
    path.join(appDir, 'data', 'storage-queue'),
    path.join(appDir, 'data', 'student-profile-queue'),
    path.join(appDir, 'exports', 'teacher-management'),
    path.join(appDir, 'reports', 'cleanup'),
    path.join(appDir, 'server', 'exports'),
    path.join(appDir, 'server', 'uploads')
  ]) {
    safeRemove(dir);
  }
}

function resolveTeacherUser(database) {
  const row = database.prepare(`
    SELECT u.id, u.name
    FROM teachers t
    JOIN users u ON u.id = t.user_id
    ORDER BY t.id
    LIMIT 1
  `).get();
  if (row) return { id: Number(row.id), name: String(row.name || '') };
  const admin = database.prepare("SELECT id, name FROM users WHERE role IN ('teacher','admin') ORDER BY id LIMIT 1").get();
  if (admin) return { id: Number(admin.id), name: String(admin.name || '') };
  throw new Error('未找到可用的教师账号，无法重建系统测试班');
}

export function resetSystemTestEnvironment({ appDir = process.cwd(), database, logger = console } = {}) {
  if (!database) throw new Error('resetSystemTestEnvironment 需要数据库连接');
  const backup = createTestEnvironmentBackup(appDir, database);
  const before = collectAudit(appDir, database);

  try {
    database.exec('BEGIN IMMEDIATE');
    const context = collectSystemTestContext(database);
    if (context.classIds.length || context.studentIds.length) {
      deleteWhereIn(database, 'teacher_comments', 'essay_id', context.essayIds);
      deleteWhereIn(database, 'ai_reviews', 'essay_id', context.essayIds);
      deleteWhereIn(database, 'mock_marking_records', 'essay_id', context.essayIds);
      deleteWhereIn(database, 'essay_images', 'essay_id', context.essayIds);
      deleteWhereIn(database, 'student_weekly_reports', 'student_id', context.studentIds);
      deleteWhereIn(database, 'student_profiles', 'student_id', context.studentIds);
      deleteWhereIn(database, 'ai_tutor_conversations', 'student_id', context.studentIds);
      deleteWhereIn(database, 'ai_writing_exercises', 'student_id', context.studentIds);
      deleteWhereIn(database, 'ai_upgrade_records', 'student_id', context.studentIds);
      deleteWhereIn(database, 'submission_drafts', 'student_id', context.studentIds);
      deleteWhereIn(database, 'feishu_student_bindings', 'student_id', context.studentIds);
      deleteWhereIn(database, 'feishu_class_bindings', 'class_id', context.classIds);
      deleteWhereIn(database, 'feishu_assignment_messages', 'class_id', context.classIds);
      deleteWhereIn(database, 'class_membership_audit_logs', 'target_id', context.classIds);
      deleteWhereIn(database, 'class_join_requests', 'class_id', context.classIds);
      deleteWhereIn(database, 'class_invites', 'class_id', context.classIds);
      deleteWhereIn(database, 'student_class_bindings', 'class_id', context.classIds);
      deleteWhereIn(database, 'class_students', 'class_id', context.classIds);
      deleteWhereIn(database, 'assignments', 'class_id', context.classIds);
      deleteWhereIn(database, 'essays', 'assignment_id', context.assignmentIds);
      deleteWhereIn(database, 'classes', 'id', context.classIds);
      deleteWhereIn(database, 'students', 'id', context.studentIds);
      deleteWhereIn(database, 'users', 'id', context.studentUserIds);
    }
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch {}
    throw error;
  }

  const teacher = resolveTeacherUser(database);
  const created = createLifecycleClass(database, { id: teacher.id, role: 'teacher' }, {
    name: '系统测试班',
    grade: '测试',
    join_mode: 'approval',
    status: 'active',
    max_students: 60,
    dataScope: 'system_test'
  });
  if (created.status !== 200) {
    throw new Error(created.message || '无法创建系统测试班');
  }

  const classRow = database.prepare('SELECT * FROM classes WHERE id = ?').get(created.class.id);
  const normalizedClassRecord = {
    classId: String(classRow?.id || created.class.id || ''),
    classKey: `${currentYear()}_测试_系统测试班`,
    className: classRow?.name || '系统测试班',
    grade: classRow?.grade || '测试',
    schoolYear: currentYear(),
    teacherId: String(teacher.id),
    teacherName: teacher.name || '',
    schoolName: '',
    studentCount: 0,
    essayCount: 0,
    averageScore: null,
    excellentRate: null,
    passingRate: null,
    latestSubmittedAt: '',
    feishuChatId: '',
    joinMode: classRow?.join_mode || 'approval',
    inviteCode: classRow?.invite_code || 'SYSTEM-TEST-001',
    inviteCodeExpiresAt: classRow?.invite_code_expires_at || '',
    inviteStatus: classRow?.invite_status || classRow?.status || 'active',
    inviteUrl: classRow?.invite_url || created.class.invite_url || '',
    qrSvg: classRow?.qr_svg || created.class.qr_svg || '',
    maxStudents: Number(classRow?.max_students || 60),
    status: classRow?.status || 'active',
    isTestData: true,
    dataScope: 'system_test',
    testScope: 'system',
    createdAt: classRow?.created_at || new Date().toISOString(),
    updatedAt: classRow?.updated_at || new Date().toISOString()
  };

  resetTeacherManagementStores(appDir, normalizedClassRecord);
  ensureSystemTestFixture(appDir, { logger, classOverrides: normalizedClassRecord });

  const after = collectAudit(appDir, database);
  const snapshot = buildSystemTestCenterSnapshot({
    appDir,
    database,
    backupPath: backup.backupPath
  });

  return {
    ok: true,
    backup,
    before,
    after,
    snapshot,
    created: {
      class: created.class,
      inviteToken: created.inviteToken
    }
  };
}

export function getTestEnvironmentStatus({ appDir = process.cwd(), database } = {}) {
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    backupPath: latestTestBackup(appDir),
    audit: collectAudit(appDir, database),
    snapshot: buildSystemTestCenterSnapshot({ appDir, database, backupPath: latestTestBackup(appDir) })
  };
}

export function rollbackTestEnvironment({ appDir = process.cwd(), backupPath = '' } = {}) {
  const target = backupPath || latestTestBackup(appDir);
  if (!target || !fs.existsSync(target)) {
    throw new Error('未找到可用于回滚的测试环境备份');
  }

  const restoreEntries = [
    ['essay-review.sqlite', path.join(appDir, 'data', 'essay-review.sqlite')],
    ['archive-records.json', path.join(appDir, 'data', 'archive-records.json')],
    ['essay-ai', path.join(appDir, 'data', 'essay-ai')],
    ['student-profiles', path.join(appDir, 'data', 'student-profiles')],
    ['teacher-management', path.join(appDir, 'data', 'teacher-management')],
    ['storage-queue', path.join(appDir, 'data', 'storage-queue')],
    ['student-profile-queue', path.join(appDir, 'data', 'student-profile-queue')],
    [path.join('exports', 'teacher-management'), path.join(appDir, 'exports', 'teacher-management')],
    [path.join('reports', 'cleanup'), path.join(appDir, 'reports', 'cleanup')],
    [path.join('server', 'exports'), path.join(appDir, 'server', 'exports')],
    [path.join('server', 'uploads'), path.join(appDir, 'server', 'uploads')]
  ];

  for (const [, destination] of restoreEntries) {
    safeRemove(destination);
  }

  for (const [relative, destination] of restoreEntries) {
    const source = path.join(target, relative);
    if (!fs.existsSync(source)) continue;
    safeCopy(source, destination);
  }

  return {
    ok: true,
    backupPath: target,
    restoredAt: new Date().toISOString()
  };
}
