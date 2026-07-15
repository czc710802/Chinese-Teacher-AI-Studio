import fs from 'node:fs';
import path from 'node:path';

import { generateClassKey } from './teacher-management/teacher-management-service.js';
import { TEACHER_MANAGEMENT_VERSION } from './teacher-management/teacher-management-service.js';
import { buildQrSvg } from './class-lifecycle.js';
import { buildPublicUrl } from './public-access.js';

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

function isTrue(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on', 'system_test'].includes(text);
}

function storePath(appDir, name) {
  return path.join(appDir, 'data', 'teacher-management', `${name}.json`);
}

function readStore(appDir, name) {
  return readJson(storePath(appDir, name), { version: '1.0', items: [] });
}

function latestBackupPath(appDir) {
  const backupDir = path.join(appDir, 'data', 'backups');
  if (!fs.existsSync(backupDir)) return '';
  const files = fs.readdirSync(backupDir)
    .filter((file) => /\.(sqlite|db)$/i.test(file))
    .map((file) => ({
      file,
      fullPath: path.join(backupDir, file),
      stat: fs.statSync(path.join(backupDir, file))
    }))
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
  return files[0]?.fullPath || '';
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

function tableColumns(database, table) {
  if (!database || !tableExists(database, table)) return [];
  try {
    return database.prepare(`PRAGMA table_info("${table}")`).all().map((row) => row.name);
  } catch {
    return [];
  }
}

function getTestFixtureFromStore(appDir) {
  const classes = readStore(appDir, 'classes').items || [];
  const students = readStore(appDir, 'students').items || [];
  const klass = classes.find((item) => isTrue(item.isTestData) || item.className === '系统测试班') || null;
  const student = students.find((item) => isTrue(item.isTestData) || item.studentId === 'TEST001' || item.studentName === '测试学生') || null;
  return { klass, student };
}

function getLiveSystemTestFixture(database) {
  if (!database) return { klass: null, student: null };
  try {
    const klass = tableExists(database, 'classes')
      ? database.prepare(`
        SELECT c.*, t.user_id AS teacher_user_id, u.name AS teacher_name
        FROM classes c
        LEFT JOIN teachers t ON t.id = c.teacher_id
        LEFT JOIN users u ON u.id = t.user_id
        WHERE LOWER(COALESCE(c.data_scope, 'production')) = 'system_test'
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT 1
      `).get() || null
      : null;
    const student = klass && tableExists(database, 'students')
      ? database.prepare(`
        SELECT s.id, s.student_no, u.name AS student_name, u.username
        FROM students s
        LEFT JOIN users u ON u.id = s.user_id
        WHERE LOWER(COALESCE(s.data_scope, 'production')) = 'system_test'
        ORDER BY s.id DESC
        LIMIT 1
      `).get() || null
      : null;
    if (!klass) return { klass: null, student: student ? {
      studentKey: student.username || `student_${student.id}`,
      studentId: student.student_no || String(student.id),
      studentName: student.student_name || '',
      classKey: '',
      className: '',
      grade: '',
      schoolYear: currentYear(),
      status: 'active',
      essayCount: 0,
      averageScore: null,
      latestScore: null,
      scoreTrend: '',
      weakestAbility: '',
      latestEssayAt: '',
      profileUpdatedAt: '',
      createdAt: '',
      updatedAt: '',
      transferHistory: [],
      isTestData: true,
      dataScope: 'system_test'
    } : null };
    const classKey = generateClassKey({ schoolYear: currentYear(), grade: klass.grade || '测试', className: klass.name || '系统测试班' });
    const activeInvite = tableExists(database, 'class_invites')
      ? database.prepare(`
        SELECT *
        FROM class_invites
        WHERE class_id = ? AND status = 'active'
        ORDER BY id DESC
        LIMIT 1
      `).get(klass.id) || null
      : null;
    const studentCount = tableExists(database, 'class_students')
      ? Number(database.prepare(`
        SELECT COUNT(*) AS count
        FROM class_students cs
        LEFT JOIN student_class_bindings b ON b.student_id = cs.student_id AND b.class_id = cs.class_id
        WHERE cs.class_id = ? AND COALESCE(b.status, 'active') = 'active'
      `).get(klass.id)?.count || 0)
      : 0;
    const essayCount = tableExists(database, 'assignments') && tableExists(database, 'essays')
      ? Number(database.prepare(`
        SELECT COUNT(*) AS count
        FROM essays e
        JOIN assignments a ON a.id = e.assignment_id
        WHERE a.class_id = ?
      `).get(klass.id)?.count || 0)
      : 0;
    return {
      klass: {
        classKey,
        className: klass.name || '系统测试班',
        grade: klass.grade || '测试',
        schoolYear: currentYear(),
        teacherId: String(klass.teacher_id || ''),
        teacherName: klass.teacher_name || '',
        schoolName: '',
        studentCount,
        essayCount,
        averageScore: null,
        excellentRate: null,
        passingRate: null,
        latestSubmittedAt: '',
        feishuChatId: '',
        joinMode: klass.join_mode || 'approval',
        inviteCode: activeInvite?.invite_code || klass.invite_code || 'SYSTEM-TEST-001',
        inviteCodeExpiresAt: activeInvite?.expires_at || klass.invite_code_expires_at || '',
        inviteUrl: activeInvite?.invite_token ? buildPublicUrl(`/student-mobile/join?token=${encodeURIComponent(activeInvite.invite_token)}`) : '',
        qrSvg: activeInvite?.invite_token ? buildQrSvg(buildPublicUrl(`/student-mobile/join?token=${encodeURIComponent(activeInvite.invite_token)}`), klass.name || '系统测试班') : '',
        maxStudents: Number(klass.max_students || 60),
        status: klass.status || 'active',
        isTestData: isTrue(klass.is_test_data) || true,
        dataScope: 'system_test',
        testScope: 'system',
        createdAt: klass.created_at || new Date().toISOString(),
        updatedAt: klass.updated_at || new Date().toISOString()
      },
      student: student ? {
        studentKey: student.username || `student_${student.id}`,
        studentId: student.student_no || String(student.id),
        studentName: student.student_name || '',
        classKey,
        className: klass.name || '',
        grade: klass.grade || '',
        schoolYear: currentYear(),
        status: 'active',
        essayCount: 0,
        averageScore: null,
        latestScore: null,
        scoreTrend: '',
        weakestAbility: '',
        latestEssayAt: '',
        profileUpdatedAt: '',
        createdAt: '',
        updatedAt: '',
        transferHistory: [],
        isTestData: true,
        dataScope: 'system_test'
      } : null
    };
  } catch {
    return { klass: null, student: null };
  }
}

function ensureSystemTestFixtureRecord(appDir, items, kind, overrides = {}) {
  const now = new Date().toISOString();
  if (kind === 'class') {
    const classKey = generateClassKey({ schoolYear: currentYear(), grade: '测试', className: '系统测试班' });
    const existing = items.find((item) => item.classKey === classKey || item.className === '系统测试班' || isTrue(item.isTestData));
    if (existing) {
      existing.classKey = existing.classKey || classKey;
      existing.className = overrides.className || '系统测试班';
      existing.grade = overrides.grade || '测试';
      existing.schoolYear = overrides.schoolYear || existing.schoolYear || currentYear();
      existing.status = overrides.status || 'active';
      existing.isTestData = true;
      existing.dataScope = overrides.dataScope || 'system_test';
      existing.testScope = 'system';
      existing.joinMode = overrides.joinMode || existing.joinMode || 'approval';
      existing.inviteCode = overrides.inviteCode || existing.inviteCode || 'SYSTEM-TEST-001';
      existing.inviteUrl = overrides.inviteUrl || existing.inviteUrl || '';
      existing.qrSvg = overrides.qrSvg || existing.qrSvg || '';
      existing.studentCount = Number(overrides.studentCount ?? 0);
      existing.essayCount = Number(overrides.essayCount ?? (existing.essayCount || 0));
      existing.teacherId = overrides.teacherId ?? existing.teacherId ?? '';
      existing.teacherName = overrides.teacherName ?? existing.teacherName ?? '';
      existing.updatedAt = now;
      return { item: existing, created: false };
    }
    const item = {
      classKey,
      className: overrides.className || '系统测试班',
      grade: overrides.grade || '测试',
      schoolYear: overrides.schoolYear || currentYear(),
      teacherId: overrides.teacherId || '',
      teacherName: overrides.teacherName || '',
      schoolName: '',
      studentCount: Number(overrides.studentCount ?? 0),
      essayCount: Number(overrides.essayCount ?? 0),
      averageScore: null,
      excellentRate: null,
      passingRate: null,
      latestSubmittedAt: '',
      feishuChatId: '',
      joinMode: overrides.joinMode || 'approval',
      inviteCode: overrides.inviteCode || 'SYSTEM-TEST-001',
      inviteCodeExpiresAt: '',
      inviteUrl: overrides.inviteUrl || '',
      qrSvg: overrides.qrSvg || '',
      maxStudents: Number(overrides.maxStudents ?? 60),
      status: overrides.status || 'active',
      isTestData: true,
      dataScope: overrides.dataScope || 'system_test',
      testScope: 'system',
      createdAt: now,
      updatedAt: now
    };
    items.push(item);
    return { item, created: true };
  }
  return { item: null, created: false };
}

export function ensureSystemTestFixture(appDir, { logger = console, classOverrides = {} } = {}) {
  const classesStore = readStore(appDir, 'classes');
  const classResult = ensureSystemTestFixtureRecord(appDir, classesStore.items, 'class', classOverrides);
  if (classResult.item) {
    classResult.item.studentCount = Number(classResult.item.studentCount || 0);
    classResult.item.essayCount = Number(classResult.item.essayCount || 0);
    classResult.item.updatedAt = new Date().toISOString();
  }

  writeJson(storePath(appDir, 'classes'), classesStore);
  writeJson(storePath(appDir, 'students'), { version: TEACHER_MANAGEMENT_VERSION, items: [] });

  logger?.info?.('系统测试入口已确认', {
    classKey: classResult.item.classKey,
    studentKey: ''
  });

  return {
    ok: true,
    created: {
      class: classResult.created,
      student: false
    },
    fixture: {
      class: classResult.item,
      student: null
    },
    updatedAt: new Date().toISOString()
  };
}

function summarizeTeacherManagementStore(appDir) {
  const classes = readStore(appDir, 'classes').items || [];
  const students = readStore(appDir, 'students').items || [];
  const essays = readStore(appDir, 'essays').items || [];
  const tasks = readStore(appDir, 'tasks').items || [];
  const comments = readStore(appDir, 'teacher-comments').items || [];
  const profilesRoot = path.join(appDir, 'data', 'student-profiles');
  const profileCounts = new Map();
  if (fs.existsSync(profilesRoot)) {
    for (const classDir of fs.readdirSync(profilesRoot, { withFileTypes: true })) {
      if (!classDir.isDirectory()) continue;
      const classPath = path.join(profilesRoot, classDir.name);
      for (const profileDir of fs.readdirSync(classPath, { withFileTypes: true })) {
        if (!profileDir.isDirectory()) continue;
        const profilePath = path.join(classPath, profileDir.name, 'profile.json');
        const profile = readJson(profilePath, null);
        if (profile?.studentKey) profileCounts.set(profile.studentKey, (profileCounts.get(profile.studentKey) || 0) + 1);
      }
    }
  }

  const essayByClass = new Map();
  const taskByClass = new Map();
  const commentsByStudent = new Map();
  for (const essay of essays) {
    essayByClass.set(essay.classKey, (essayByClass.get(essay.classKey) || 0) + 1);
  }
  for (const task of tasks) {
    taskByClass.set(task.classKey, (taskByClass.get(task.classKey) || 0) + 1);
  }
  const essayByStudent = new Map();
  for (const essay of essays) {
    essayByStudent.set(essay.studentKey, (essayByStudent.get(essay.studentKey) || 0) + 1);
  }
  for (const comment of comments) {
    const essay = essays.find((item) => item.archiveId === comment.archiveId);
    if (essay?.studentKey) commentsByStudent.set(essay.studentKey, (commentsByStudent.get(essay.studentKey) || 0) + 1);
  }

  const classRows = classes.map((klass) => {
    const essayCount = essayByClass.get(klass.classKey) || 0;
    const studentCount = students.filter((student) => student.classKey === klass.classKey).length;
    const taskCount = taskByClass.get(klass.classKey) || 0;
    const commentCount = comments.filter((comment) => {
      const essay = essays.find((item) => item.archiveId === comment.archiveId);
      return essay?.classKey === klass.classKey;
    }).length;
    const profileCount = students.filter((student) => profileCounts.has(student.studentKey) && student.classKey === klass.classKey).length;
    const hasHistory = essayCount > 0 || taskCount > 0 || commentCount > 0 || profileCount > 0 || studentCount > 0;
    const canPhysicalDelete = !hasHistory && !isTrue(klass.isTestData);
    const recommendedAction = isTrue(klass.isTestData)
      ? '保留'
      : canPhysicalDelete
        ? '物理删除候选（仅 dry-run）'
        : '归档';
    return {
      source: 'teacher-management',
      classKey: klass.classKey,
      className: klass.className,
      grade: klass.grade,
      schoolYear: klass.schoolYear,
      teacherName: klass.teacherName || '',
      studentCount,
      taskCount,
      essayCount,
      reportCount: essayCount,
      commentCount,
      profileCount,
      status: klass.status || 'active',
      isTestData: isTrue(klass.isTestData),
      hasHistory,
      canPhysicalDelete,
      recommendedAction,
      reasons: hasHistory ? ['存在任务/作文/评论/档案引用'] : ['无任务、无作文、无评论、无档案引用']
    };
  });

  const studentRows = students.map((student) => {
    const essayCount = essayByStudent.get(student.studentKey) || 0;
    const commentCount = commentsByStudent.get(student.studentKey) || 0;
    const profileCount = profileCounts.get(student.studentKey) || 0;
    const classCount = student.classKey ? 1 : 0;
    const hasHistory = essayCount > 0 || commentCount > 0 || profileCount > 0 || classCount > 0;
    const canPhysicalDelete = !hasHistory && !isTrue(student.isTestData);
    const recommendedAction = isTrue(student.isTestData)
      ? '保留'
      : canPhysicalDelete
        ? '物理删除候选（仅 dry-run）'
        : '逻辑删除或停用';
    return {
      source: 'teacher-management',
      studentKey: student.studentKey,
      studentId: student.studentId,
      studentName: student.studentName,
      classKey: student.classKey,
      className: student.className,
      classCount,
      essayCount,
      reportCount: essayCount,
      commentCount,
      profileCount,
      status: student.status || 'active',
      isTestData: isTrue(student.isTestData),
      hasHistory,
      canPhysicalDelete,
      recommendedAction,
      reasons: hasHistory ? ['存在班级关系或历史记录'] : ['无班级关系、无作文、无评论、无档案引用']
    };
  });

  return {
    source: 'teacher-management',
    totals: {
      classes: classes.length,
      students: students.length,
      essays: essays.length,
      tasks: tasks.length,
      comments: comments.length,
      testClasses: classes.filter((item) => isTrue(item.isTestData)).length,
      testStudents: students.filter((item) => isTrue(item.isTestData)).length
    },
    classes: classRows,
    students: studentRows,
    keep: [
      ...classRows.filter((row) => row.isTestData).map((row) => ({ type: 'class', key: row.classKey, name: row.className })),
      ...studentRows.filter((row) => row.isTestData).map((row) => ({ type: 'student', key: row.studentKey, name: row.studentName }))
    ],
    archive: classRows.filter((row) => !row.isTestData && row.hasHistory && !row.canPhysicalDelete),
    logicalDelete: studentRows.filter((row) => !row.isTestData && row.hasHistory && !row.canPhysicalDelete),
    physicalDelete: [
      ...classRows.filter((row) => row.canPhysicalDelete && !row.isTestData),
      ...studentRows.filter((row) => row.canPhysicalDelete && !row.isTestData)
    ]
  };
}

function summarizeSqlite(database) {
  const tables = [
    'classes',
    'students',
    'class_students',
    'student_class_bindings',
    'assignments',
    'essays',
    'ai_reviews',
    'teacher_comments',
    'ai_upgrade_records',
    'student_profiles',
    'feishu_message_logs',
    'feishu_card_interactions',
    'feishu_class_bindings',
    'feishu_student_bindings',
    'feishu_assignment_messages',
    'feishu_teacher_bindings',
    'feishu_teacher_binding_codes'
  ];
  const counts = Object.fromEntries(tables.map((table) => [table, countTable(database, table)]));
  const classColumns = tableColumns(database, 'classes');
  const studentColumns = tableColumns(database, 'students');
  const essayColumns = tableColumns(database, 'essays');

  const classRows = tableExists(database, 'classes')
    ? database.prepare(`
      SELECT
        c.id,
        c.name,
        c.grade,
        COALESCE(c.status, 'active') AS status,
        COALESCE(c.join_mode, 'approval') AS join_mode,
        c.teacher_id,
        c.created_at,
        c.updated_at,
        COALESCE((SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id), 0) AS student_count,
        COALESCE((SELECT COUNT(*) FROM assignments a WHERE a.class_id = c.id), 0) AS assignment_count,
        COALESCE((SELECT COUNT(*) FROM essays e JOIN assignments a ON a.id = e.assignment_id WHERE a.class_id = c.id), 0) AS essay_count,
        COALESCE((SELECT COUNT(*) FROM ai_reviews r JOIN essays e ON e.id = r.essay_id JOIN assignments a ON a.id = e.assignment_id WHERE a.class_id = c.id), 0) AS report_count,
        COALESCE((SELECT COUNT(*) FROM student_class_bindings b WHERE b.class_id = c.id), 0) AS binding_count
      FROM classes c
      ORDER BY c.id
    `).all()
    : [];

  const studentRows = tableExists(database, 'students')
    ? database.prepare(`
      SELECT
        s.id,
        s.student_no,
        s.grade,
        s.school,
        'active' AS status,
        u.name AS student_name,
        u.username,
        COALESCE((SELECT COUNT(*) FROM class_students cs WHERE cs.student_id = s.id), 0) AS class_count,
        COALESCE((SELECT COUNT(*) FROM essays e WHERE e.student_id = s.id), 0) AS essay_count,
        COALESCE((SELECT COUNT(*) FROM ai_reviews r JOIN essays e ON e.id = r.essay_id WHERE e.student_id = s.id), 0) AS report_count,
        COALESCE((SELECT COUNT(*) FROM student_profiles p WHERE p.student_id = s.id), 0) AS profile_count
      FROM students s
      JOIN users u ON u.id = s.user_id
      ORDER BY s.id
    `).all()
    : [];

  const essayCountByClass = new Map();
  if (tableExists(database, 'assignments') && tableExists(database, 'essays')) {
    for (const row of database.prepare(`
      SELECT a.class_id, COUNT(*) AS count
      FROM essays e
      JOIN assignments a ON a.id = e.assignment_id
      GROUP BY a.class_id
    `).all()) {
      essayCountByClass.set(String(row.class_id), Number(row.count || 0));
    }
  }

  const tests = {
    sqliteColumns: { classes: classColumns, students: studentColumns, essays: essayColumns },
    classRows: classRows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      grade: row.grade,
      status: row.status,
      joinMode: row.join_mode,
      teacherId: row.teacher_id,
      studentCount: Number(row.student_count || 0),
      assignmentCount: Number(row.assignment_count || 0),
      essayCount: Number(row.essay_count || essayCountByClass.get(String(row.id)) || 0),
      reportCount: Number(row.report_count || 0),
      bindingCount: Number(row.binding_count || 0),
      hasHistory: Number(row.student_count || 0) > 0 || Number(row.assignment_count || 0) > 0 || Number(row.essay_count || 0) > 0 || Number(row.report_count || 0) > 0,
      canPhysicalDelete: Number(row.student_count || 0) === 0 && Number(row.assignment_count || 0) === 0 && Number(row.essay_count || 0) === 0 && Number(row.report_count || 0) === 0
    })),
    studentRows: studentRows.map((row) => ({
      id: Number(row.id),
      studentNo: row.student_no,
      studentName: row.student_name,
      username: row.username,
      grade: row.grade,
      school: row.school,
      status: row.status,
      classCount: Number(row.class_count || 0),
      essayCount: Number(row.essay_count || 0),
      reportCount: Number(row.report_count || 0),
      profileCount: Number(row.profile_count || 0),
      hasHistory: Number(row.class_count || 0) > 0 || Number(row.essay_count || 0) > 0 || Number(row.report_count || 0) > 0 || Number(row.profile_count || 0) > 0,
      canPhysicalDelete: Number(row.class_count || 0) === 0 && Number(row.essay_count || 0) === 0 && Number(row.report_count || 0) === 0 && Number(row.profile_count || 0) === 0
    }))
  };

  return {
    source: 'sqlite',
    tables: counts,
    tests
  };
}

export function buildLegacyCleanupDryRun({ appDir = process.cwd(), database = null, backupPath = '' } = {}) {
  const teacherManagement = summarizeTeacherManagementStore(appDir);
  const sqlite = database ? summarizeSqlite(database) : null;
  const fixture = getTestFixtureFromStore(appDir);
  const effectiveBackupPath = backupPath || latestBackupPath(appDir);
  return {
    generatedAt: new Date().toISOString(),
    appDir,
    backupPath: effectiveBackupPath,
    fixture: {
      class: fixture.klass || null,
      student: fixture.student || null
    },
    teacherManagement,
    sqlite,
    keep: teacherManagement.keep,
    archive: teacherManagement.archive,
    logicalDelete: teacherManagement.logicalDelete,
    physicalDelete: teacherManagement.physicalDelete,
    notes: [
      '本报告仅用于 dry-run，不会执行物理删除。',
      'teacher-management 展示层默认应使用系统测试数据视图。',
      '历史作文、报告、评语和成长档案仅做保留/隐藏，不会在 dry-run 中被删除。'
    ]
  };
}

export function writeLegacyCleanupReport(appDir, report) {
  const reportDir = path.join(appDir, 'reports', 'cleanup');
  fs.mkdirSync(reportDir, { recursive: true });
  const stamped = `legacy-cleanup-dry-run-${new Date(report.generatedAt || Date.now()).toISOString().replace(/[:.]/g, '-')}`;
  const jsonPath = path.join(reportDir, `${stamped}.json`);
  const mdPath = path.join(reportDir, `${stamped}.md`);
  const latestJsonPath = path.join(reportDir, 'legacy-cleanup-dry-run-latest.json');
  const latestMdPath = path.join(reportDir, 'legacy-cleanup-dry-run-latest.md');
  writeJson(jsonPath, report);
  writeJson(latestJsonPath, report);
  const lines = [
    '# Legacy Cleanup Dry Run',
    '',
    `- Generated: ${report.generatedAt}`,
    `- Backup: ${report.backupPath || '未检测到最近备份'}`,
    `- Test class: ${report.fixture?.class?.classKey || '未配置'}`,
    `- Test student: ${report.fixture?.student?.studentKey || '未配置'}`,
    '',
    `## teacher-management`,
    `- Classes: ${report.teacherManagement?.totals?.classes ?? 0}`,
    `- Students: ${report.teacherManagement?.totals?.students ?? 0}`,
    `- Essays: ${report.teacherManagement?.totals?.essays ?? 0}`,
    `- Tasks: ${report.teacherManagement?.totals?.tasks ?? 0}`,
    `- Comments: ${report.teacherManagement?.totals?.comments ?? 0}`,
    '',
    `## SQLite`,
    report.sqlite ? `- Tables: ${Object.keys(report.sqlite.tables || {}).length}` : '- SQLite summary unavailable',
    '',
    '## Keep',
    ...(report.keep || []).map((item) => `- ${item.type}: ${item.name || item.key}`),
    '',
    '## Archive',
    ...(report.archive || []).map((item) => `- ${item.classKey} ${item.className}`),
    '',
    '## Logical Delete',
    ...(report.logicalDelete || []).map((item) => `- ${item.studentKey} ${item.studentName}`),
    '',
    '## Physical Delete',
    ...(report.physicalDelete || []).map((item) => `- ${item.classKey || item.studentKey} ${item.className || item.studentName}`)
  ];
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`, 'utf8');
  fs.writeFileSync(latestMdPath, `${lines.join('\n')}\n`, 'utf8');
  return { jsonPath, mdPath, latestJsonPath, latestMdPath };
}

export function buildSystemTestCenterSnapshot({ appDir = process.cwd(), database = null, backupPath = '' } = {}) {
  const report = buildLegacyCleanupDryRun({ appDir, database, backupPath });
  const storeFixture = report.fixture || {};
  let fixture = storeFixture;
  if (database) {
    try {
      const klass = database.prepare(`
        SELECT c.*, t.user_id AS teacher_user_id, u.name AS teacher_name
        FROM classes c
        LEFT JOIN teachers t ON t.id = c.teacher_id
        LEFT JOIN users u ON u.id = t.user_id
        WHERE LOWER(COALESCE(c.data_scope, 'production')) = 'system_test'
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT 1
      `).get() || null;
      if (klass) {
        const activeInvite = database.prepare(`
          SELECT *
          FROM class_invites
          WHERE class_id = ? AND status = 'active'
          ORDER BY id DESC
          LIMIT 1
        `).get(klass.id) || null;
        const student = database.prepare(`
          SELECT s.id, s.student_no, u.name AS student_name, u.username
          FROM students s
          LEFT JOIN users u ON u.id = s.user_id
          WHERE LOWER(COALESCE(s.data_scope, 'production')) = 'system_test'
          ORDER BY s.id DESC
          LIMIT 1
        `).get() || null;
        const classKey = generateClassKey({ schoolYear: currentYear(), grade: klass.grade || '测试', className: klass.name || '系统测试班' });
        fixture = {
          class: {
            classId: String(klass.id || ''),
            classKey,
            className: klass.name || '系统测试班',
            grade: klass.grade || '测试',
            schoolYear: currentYear(),
            teacherId: String(klass.teacher_id || ''),
            teacherName: klass.teacher_name || '',
            schoolName: '',
            studentCount: Number(database.prepare(`
              SELECT COUNT(*) AS count
              FROM class_students cs
              LEFT JOIN student_class_bindings b ON b.student_id = cs.student_id AND b.class_id = cs.class_id
              WHERE cs.class_id = ? AND COALESCE(b.status, 'active') = 'active'
            `).get(klass.id)?.count || 0),
            essayCount: Number(database.prepare(`
              SELECT COUNT(*) AS count
              FROM essays e
              JOIN assignments a ON a.id = e.assignment_id
              WHERE a.class_id = ?
            `).get(klass.id)?.count || 0),
            averageScore: null,
            excellentRate: null,
            passingRate: null,
            latestSubmittedAt: '',
            feishuChatId: '',
            joinMode: klass.join_mode || 'approval',
            inviteCode: activeInvite?.invite_code || klass.invite_code || 'SYSTEM-TEST-001',
            inviteCodeExpiresAt: activeInvite?.expires_at || klass.invite_code_expires_at || '',
            inviteStatus: activeInvite?.status || klass.status || 'active',
            inviteUrl: activeInvite?.invite_token ? buildPublicUrl(`/student-mobile/join?token=${encodeURIComponent(activeInvite.invite_token)}`) : '',
            qrSvg: activeInvite?.invite_token ? buildQrSvg(buildPublicUrl(`/student-mobile/join?token=${encodeURIComponent(activeInvite.invite_token)}`), klass.name || '系统测试班') : '',
            maxStudents: Number(klass.max_students || 60),
            status: klass.status || 'active',
            isTestData: true,
            dataScope: 'system_test',
            testScope: 'system',
            createdAt: klass.created_at || new Date().toISOString(),
            updatedAt: klass.updated_at || new Date().toISOString()
          },
      student: student ? {
            studentKey: student.username || `student_${student.id}`,
            studentId: student.student_no || String(student.id),
            studentName: student.student_name || '',
            classKey,
            className: klass.name || '',
            grade: klass.grade || '',
            schoolYear: currentYear(),
            status: 'active',
            essayCount: 0,
            averageScore: null,
            latestScore: null,
            scoreTrend: '',
            weakestAbility: '',
            latestEssayAt: '',
            profileUpdatedAt: '',
            createdAt: '',
            updatedAt: '',
            transferHistory: [],
            isTestData: true,
            dataScope: 'system_test'
          } : null
        };
      }
    } catch {
      fixture = storeFixture;
    }
  }
  const classKey = fixture.class?.classKey || generateClassKey({ schoolYear: currentYear(), grade: '测试', className: '系统测试班' });
  const studentKey = fixture.student?.studentKey || '';
  return {
    generatedAt: report.generatedAt,
    backupPath: report.backupPath,
    fixture: {
      class: fixture.class || null,
      student: fixture.student || null
    },
    report,
    links: {
      teacherClasses: '/teacher/classes?scope=system_test',
      teacherStudents: '/teacher/students?scope=system_test',
      teacherAssignments: '/assignments/new',
      teacherTasks: '/teacher/tasks',
      teacherTestCenter: '/teacher/test-center',
      studentHome: '/student-mobile/home',
      studentJoin: fixture.class?.inviteUrl || buildPublicUrl('/student-mobile/join/code'),
      studentTasks: '/student-mobile/tasks',
      studentProfile: '/student-mobile/profile',
      testClassDetail: `/teacher/classes/${encodeURIComponent(classKey)}`,
      testClassMembers: `/teacher/classes/${encodeURIComponent(classKey)}/members`,
      testClassRequests: `/teacher/classes/${encodeURIComponent(classKey)}/join-requests`,
      testStudentProfile: studentKey ? `/student-profiles/${encodeURIComponent(studentKey)}` : ''
    }
  };
}
