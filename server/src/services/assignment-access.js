import {
  getPrimaryFeishuClassBinding,
  markAssignmentMessageRevoked,
  recordFeishuAssignmentMessage
} from './feishu-assignment-bindings.js';
import { buildFeishuBusinessMigrationNotice, isFeishuBusinessEnabled } from '../integrations/feishu/config.js';

function getTeacher(database, user) {
  return database.prepare('SELECT id FROM teachers WHERE user_id = ?').get(user.id);
}

function getStudent(database, user) {
  return database.prepare('SELECT id FROM students WHERE user_id = ?').get(user.id);
}

function tableColumns(database, tableName) {
  try {
    return new Set(database.prepare(`PRAGMA table_info('${tableName}')`).all().map((column) => column.name));
  } catch {
    return new Set();
  }
}

function hasColumn(database, tableName, columnName) {
  return tableColumns(database, tableName).has(columnName);
}

function assignmentScopeExpression(database) {
  return hasColumn(database, 'assignments', 'data_scope')
    ? "COALESCE(NULLIF(a.data_scope, ''), c.data_scope, 'production')"
    : "COALESCE(c.data_scope, 'production')";
}

function activeAssignmentCondition(database, alias = 'a') {
  const parts = [`${alias}.status = 'published'`];
  if (hasColumn(database, 'assignments', 'deleted_at')) parts.push(`COALESCE(${alias}.deleted_at, '') = ''`);
  if (hasColumn(database, 'assignments', 'archived_at')) parts.push(`COALESCE(${alias}.archived_at, '') = ''`);
  return parts.join(' AND ');
}

function normalizeAssignmentRow(row) {
  if (!row) return row;
  return {
    ...row,
    data_scope: row.data_scope || row.class_data_scope || 'production',
    requires_teacher_review: Number(row.requires_teacher_review ?? 1),
    auto_grading: Number(row.auto_grading ?? 1),
    allow_student_view_result: Number(row.allow_student_view_result ?? 1)
  };
}

function assignmentKey(row) {
  return [
    row.class_id,
    String(row.title || '').trim(),
    String(row.prompt || '').trim(),
    String(row.requirements || '').trim(),
    String(row.essay_type || '').trim(),
    Number(row.full_score || 0),
    Number(row.min_words || 0),
    Number(row.max_words || 0),
    String(row.deadline || '').trim()
  ].join('\u001f');
}

function preferAssignment(candidate, current) {
  if (!current) return candidate;
  const candidateEssays = Number(candidate.essay_count || 0);
  const currentEssays = Number(current.essay_count || 0);
  if (candidateEssays !== currentEssays) return candidateEssays > currentEssays ? candidate : current;
  if (String(candidate.created_at || '') !== String(current.created_at || '')) {
    return String(candidate.created_at || '') > String(current.created_at || '') ? candidate : current;
  }
  return Number(candidate.id || 0) > Number(current.id || 0) ? candidate : current;
}

function dedupeAssignments(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = assignmentKey(row);
    byKey.set(key, preferAssignment(row, byKey.get(key)));
  }
  return [...byKey.values()].sort((a, b) => {
    const created = String(b.created_at || '').localeCompare(String(a.created_at || ''));
    if (created !== 0) return created;
    return Number(b.id || 0) - Number(a.id || 0);
  });
}

function normalizePublicOrigin(options = {}) {
  const raw = String(options.publicOrigin || process.env.PUBLIC_APP_ORIGIN || 'https://pi.zhenwanyue.icu').trim().replace(/\/+$/, '');
  try {
    const url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(url.hostname)) return 'https://pi.zhenwanyue.icu';
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.)/.test(url.hostname)) return 'https://pi.zhenwanyue.icu';
    return url.origin;
  } catch {
    return 'https://pi.zhenwanyue.icu';
  }
}

function dateCode(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const yyyy = safe.getFullYear();
  const mm = String(safe.getMonth() + 1).padStart(2, '0');
  const dd = String(safe.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function gradeCode(value, classId) {
  const raw = String(value || '').toUpperCase();
  const mapped = raw
    .replace(/高一|一年级|G1/g, 'G1')
    .replace(/高二|二年级|G2/g, 'G2')
    .replace(/高三|三年级|G3/g, 'G3')
    .replace(/[^A-Z0-9]/g, '');
  return mapped || `G${classId || 'X'}`;
}

function normalizedEssayType(value) {
  return String(value || '材料作文').trim() || '材料作文';
}

function buildManagedAssignmentTitle({ grade, essayType, klass }) {
  const gradeLabel = String(grade || klass.grade || '').trim();
  const typeLabel = normalizedEssayType(essayType);
  if (gradeLabel && typeLabel) return `${gradeLabel}${typeLabel}`;
  if (gradeLabel) return `${gradeLabel}作文任务`;
  if (typeLabel) return `${typeLabel}任务`;
  return '作文任务';
}

function buildManagedAssignmentPrompt({ grade, essayType }) {
  const gradeLabel = String(grade || '').trim();
  const typeLabel = normalizedEssayType(essayType);
  const context = gradeLabel ? `${gradeLabel}${typeLabel}` : typeLabel;
  return `围绕“${context}”完成作文训练。请依据班级教学要求认真审题、组织材料、展开论证，并根据篇幅自动进入对应批改模式。`;
}

function buildManagedAssignmentRequirements({ grade, essayType }) {
  const gradeLabel = String(grade || '').trim();
  const typeLabel = normalizedEssayType(essayType);
  const context = gradeLabel ? `${gradeLabel}${typeLabel}` : typeLabel;
  return `完成一篇${context}作文。AI 将按篇幅自动分档批改，教师可在后续环节继续审核和发布结果。`;
}

export function buildSubmissionUrl(publicId, options = {}) {
  return `${normalizePublicOrigin(options)}/submit/${encodeURIComponent(String(publicId || ''))}`;
}

export function buildAssignmentQrSvg(url) {
  const safeUrl = String(url || '').replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char]));
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" role="img" aria-label="作文提交二维码">',
    '<rect width="240" height="240" fill="#ffffff"/>',
    '<rect x="16" y="16" width="48" height="48" fill="#111827"/><rect x="28" y="28" width="24" height="24" fill="#ffffff"/>',
    '<rect x="176" y="16" width="48" height="48" fill="#111827"/><rect x="188" y="28" width="24" height="24" fill="#ffffff"/>',
    '<rect x="16" y="176" width="48" height="48" fill="#111827"/><rect x="28" y="188" width="24" height="24" fill="#ffffff"/>',
    '<path d="M88 32h16v16H88zm32 0h16v16h-16zm32 0h16v16h-16zM88 72h16v16H88zm48 0h16v16h-16zm-16 32h16v16h-16zm40 24h16v16h-16zm-72 32h16v16H88zm32 24h16v16h-16zm64-16h16v16h-16zm-32 32h16v16h-16z" fill="#111827"/>',
    `<text x="120" y="118" text-anchor="middle" font-size="12" fill="#111827">扫码提交作文</text>`,
    `<text x="120" y="138" text-anchor="middle" font-size="8" fill="#4b5563">${safeUrl.slice(0, 42)}</text>`,
    '</svg>'
  ].join('');
}

function createPublicId(database, klass, now = new Date()) {
  const prefix = `${gradeCode(klass.grade, klass.id)}-${dateCode(now)}`;
  const row = database.prepare(`
    SELECT public_id FROM assignments
    WHERE public_id LIKE ?
    ORDER BY public_id DESC
    LIMIT 1
  `).get(`${prefix}-%`);
  const last = Number(String(row?.public_id || '').split('-').pop() || 0);
  return `${prefix}-${String(last + 1).padStart(3, '0')}`;
}

function ensureAssignmentShareFields(database, assignment, options = {}) {
  if (!assignment) return assignment;
  let publicId = assignment.public_id;
  if (!publicId) {
    const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(assignment.class_id) || { id: assignment.class_id };
    publicId = createPublicId(database, { ...klass, grade: assignment.grade || klass.grade }, options.now);
  }
  const submissionUrl = buildSubmissionUrl(publicId, options);
  const qrSvg = assignment.qr_svg || buildAssignmentQrSvg(submissionUrl);
  if (!assignment.public_id || !assignment.share_url || !assignment.qr_svg) {
    database.prepare(`
      UPDATE assignments SET public_id = ?, share_url = ?, qr_svg = ?, published_at = COALESCE(published_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `).run(publicId, submissionUrl, qrSvg, assignment.id);
  }
  return { ...assignment, public_id: publicId, submission_url: submissionUrl, share_url: submissionUrl, qr_svg: qrSvg };
}

function withSubmissionStats(database, assignment, options = {}) {
  const normalized = normalizeAssignmentRow(assignment);
  const shared = ensureAssignmentShareFields(database, normalized, options);
  if (!shared) return shared;
  const submitted = database.prepare(`
    SELECT COUNT(DISTINCT student_id) AS count
    FROM essays
    WHERE assignment_id = ?
  `).get(shared.id).count;
  const total = database.prepare('SELECT COUNT(*) AS count FROM class_students WHERE class_id = ?').get(shared.class_id).count;
  return {
    ...shared,
    submitted_count: Number(submitted || 0),
    missing_count: Math.max(0, Number(total || 0) - Number(submitted || 0)),
    total_students: Number(total || 0)
  };
}

function mapAssignmentRows(database, rows, options = {}) {
  return dedupeAssignments(rows.map(normalizeAssignmentRow)).map((row) => withSubmissionStats(database, row, options));
}

export function listAssignmentsForClass(database, classId, { dataScope = '', includeArchived = false, options = {} } = {}) {
  const scopeExpression = assignmentScopeExpression(database);
  const conditions = ['a.class_id = ?'];
  const params = [String(classId)];
  if (dataScope) {
    conditions.push(`${scopeExpression} = ?`);
    params.push(String(dataScope));
  }
  if (!includeArchived) conditions.push(activeAssignmentCondition(database));
  const rows = database.prepare(`
    SELECT a.*, c.name AS class_name, c.data_scope AS class_data_scope, ${scopeExpression} AS data_scope, COUNT(e.id) AS essay_count
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    LEFT JOIN essays e ON e.assignment_id = a.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY a.id
    ORDER BY a.created_at DESC, a.id DESC
  `).all(...params);
  return { status: 200, rows: mapAssignmentRows(database, rows, options) };
}

export function getAssignmentById(database, assignmentId, options = {}) {
  const scopeExpression = assignmentScopeExpression(database);
  const assignment = database.prepare(`
    SELECT a.*, c.name AS class_name, c.data_scope AS class_data_scope, ${scopeExpression} AS data_scope, COUNT(e.id) AS essay_count
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    LEFT JOIN essays e ON e.assignment_id = a.id
    WHERE a.id = ? OR a.public_id = ?
    GROUP BY a.id
  `).get(Number(assignmentId) || -1, String(assignmentId || ''));
  if (!assignment) return { status: 404, message: '作文任务不存在' };
  return { status: 200, assignment: withSubmissionStats(database, assignment, options) };
}

export function listVisibleAssignmentsForStudent(database, studentId, { classId = '', dataScope = '', options = {} } = {}) {
  const scopeExpression = assignmentScopeExpression(database);
  const conditions = ['cs.student_id = ?', "c.status != 'deleted'", "COALESCE(b.status, 'active') = 'active'", activeAssignmentCondition(database)];
  const params = [Number(studentId)];
  if (classId) {
    conditions.push('a.class_id = ?');
    params.push(String(classId));
  }
  if (dataScope) {
    conditions.push(`${scopeExpression} = ?`);
    params.push(String(dataScope));
  }
  const rows = database.prepare(`
    SELECT a.*, c.name AS class_name, c.grade AS class_grade, c.data_scope AS class_data_scope, ${scopeExpression} AS data_scope, COUNT(e.id) AS essay_count
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    JOIN class_students cs ON cs.class_id = c.id
    LEFT JOIN student_class_bindings b ON b.student_id = cs.student_id AND b.class_id = c.id
    LEFT JOIN essays e ON e.assignment_id = a.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY a.id
    ORDER BY a.created_at DESC, a.id DESC
  `).all(...params);
  return {
    status: 200,
    rows: mapAssignmentRows(database, rows, options).map((row) => ({
      ...row,
      word_count_range: [Number(row.min_words || 0), Number(row.max_words || 0)],
      submitted: false
    }))
  };
}

export function getVisibleAssignmentForStudent(database, studentId, assignmentId, options = {}) {
  const rows = listVisibleAssignmentsForStudent(database, studentId, { options }).rows;
  const assignment = rows.find((row) => String(row.id) === String(assignmentId) || String(row.public_id || '') === String(assignmentId));
  if (!assignment) return { status: 404, message: '任务不存在或暂不可见' };
  return { status: 200, assignment };
}

export function listAssignmentsForUser(database, user, { classId, dataScope } = {}) {
  const scopedClassId = classId ? String(classId) : null;
  const scopeExpression = assignmentScopeExpression(database);

  if (user.role === 'teacher') {
    const teacher = getTeacher(database, user);
    const conditions = ['c.teacher_id = ?', '(? IS NULL OR a.class_id = ?)'];
    const params = [teacher?.id || 0, scopedClassId, scopedClassId];
    if (dataScope) {
      conditions.push(`${scopeExpression} = ?`);
      params.push(String(dataScope));
    }
    conditions.push(activeAssignmentCondition(database));
    const rows = database.prepare(`
      SELECT a.*, c.name AS class_name, c.data_scope AS class_data_scope, ${scopeExpression} AS data_scope, COUNT(e.id) AS essay_count
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      LEFT JOIN essays e ON e.assignment_id = a.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY a.id
      ORDER BY a.created_at DESC, a.id DESC
    `).all(...params);
    return { status: 200, rows: mapAssignmentRows(database, rows) };
  }

  if (user.role === 'student') {
    const student = getStudent(database, user);
    if (!student) return { status: 403, message: '没有查看作文任务的权限', rows: [] };
    return listVisibleAssignmentsForStudent(database, student.id, { classId: scopedClassId, dataScope });
  }

  return { status: 403, message: '没有查看作文任务的权限', rows: [] };
}

export function createManagedAssignment(database, user, body, options = {}) {
  const teacher = getTeacher(database, user);
  if (!teacher) return { status: 400, message: '请先创建教师账号后再发布任务' };

  const classId = Number(body.class_id || body.classId);
  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!klass) return { status: 404, message: '班级不存在' };
  if (klass.teacher_id !== teacher.id) return { status: 403, message: '没有管理该班级的权限' };

  const next = {
    class_id: classId,
    essay_type: normalizedEssayType(body.essay_type || body.essayType),
    grade: String(body.grade || klass.grade || '').trim(),
    title: String(body.title || buildManagedAssignmentTitle({ grade: body.grade || klass.grade || '', essayType: body.essay_type || body.essayType, klass })).trim(),
    prompt: String(body.prompt || buildManagedAssignmentPrompt({ grade: body.grade || klass.grade || '', essayType: body.essay_type || body.essayType })).trim(),
    requirements: String(body.requirements || buildManagedAssignmentRequirements({ grade: body.grade || klass.grade || '', essayType: body.essay_type || body.essayType })).trim(),
    full_score: Number(body.full_score || body.fullScore || 60),
    min_words: Math.max(0, Number(body.min_words ?? body.minWords ?? 0)),
    max_words: Math.max(0, Number(body.max_words ?? body.maxWords ?? 0)),
    scoring_standard: String(body.scoring_standard || body.scoringStandard || '内容、表达、发展等级综合评分').trim(),
    deadline: String(body.deadline || '').trim(),
    status: String(body.status || 'published').trim() || 'published',
    data_scope: String(body.data_scope || body.dataScope || klass.data_scope || '').trim(),
    fixture_key: String(body.fixture_key || body.fixtureKey || '').trim(),
    requires_teacher_review: body.requires_teacher_review === false || body.requiresTeacherReview === false ? 0 : 1,
    auto_grading: body.auto_grading === false || body.autoGrading === false ? 0 : 1,
    allow_student_view_result: body.allow_student_view_result === false || body.allowStudentViewResult === false ? 0 : 1,
    allow_resubmit: body.allow_resubmit || body.allowResubmit ? 1 : 0,
    allow_late_submit: body.allow_late_submit || body.allowLateSubmit ? 1 : 0,
    second_draft_enabled: body.second_draft_enabled || body.secondDraftEnabled ? 1 : 0,
    reminder_enabled: body.reminder_enabled === false || body.reminderEnabled === false ? 0 : 1,
    feishu_chat_id: String(body.feishu_chat_id || body.feishuChatId || '').trim()
  };
  if (next.max_words && next.min_words && next.max_words < next.min_words) {
    return { status: 400, message: '最高字数不能小于最低字数' };
  }

  const existing = database.prepare(`
    SELECT a.*, COUNT(e.id) AS essay_count
    FROM assignments a
    LEFT JOIN essays e ON e.assignment_id = a.id
    WHERE a.class_id = ?
      AND TRIM(a.title) = TRIM(?)
      AND TRIM(a.prompt) = TRIM(?)
      AND COALESCE(TRIM(a.requirements), '') = COALESCE(TRIM(?), '')
      AND TRIM(a.essay_type) = TRIM(?)
      AND a.full_score = ?
      AND COALESCE(a.min_words, 0) = ?
      AND COALESCE(a.max_words, 0) = ?
      AND COALESCE(TRIM(a.deadline), '') = COALESCE(TRIM(?), '')
      AND COALESCE(a.archived_at, '') = ''
      AND COALESCE(a.deleted_at, '') = ''
    GROUP BY a.id
    ORDER BY essay_count DESC, a.created_at DESC, a.id DESC
    LIMIT 1
  `).get(next.class_id, next.title, next.prompt, next.requirements, next.essay_type, next.full_score, next.min_words, next.max_words, next.deadline || '');
  if (existing) return { status: 200, assignment: withSubmissionStats(database, existing, options), reused: true };

  const publicId = createPublicId(database, { ...klass, grade: next.grade }, options.now);
  const submissionUrl = buildSubmissionUrl(publicId, options);
  const qrSvg = buildAssignmentQrSvg(submissionUrl);

  const result = database.prepare(`
    INSERT INTO assignments
      (class_id, public_id, title, prompt, requirements, essay_type, full_score, grade,
       min_words, max_words, scoring_standard, data_scope, fixture_key, status,
       requires_teacher_review, auto_grading, allow_student_view_result, allow_resubmit, allow_late_submit,
       second_draft_enabled, reminder_enabled, published_at,
       share_url, qr_svg, feishu_chat_id, deadline)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
  `).run(
    next.class_id, publicId, next.title, next.prompt, next.requirements, next.essay_type, next.full_score, next.grade,
    next.min_words, next.max_words, next.scoring_standard, next.data_scope || null, next.fixture_key || null, next.status,
    next.requires_teacher_review, next.auto_grading, next.allow_student_view_result, next.allow_resubmit,
    next.allow_late_submit, next.second_draft_enabled, next.reminder_enabled,
    submissionUrl, qrSvg, next.feishu_chat_id, next.deadline || null
  );
  return {
    status: 200,
    assignment: withSubmissionStats(database, database.prepare('SELECT * FROM assignments WHERE id = ?').get(result.lastInsertRowid), options)
  };
}

export function ensureSystemTestAssignment(database, { classId, actorId = 'system', options = {} } = {}) {
  const liveClassId = Number(classId || 0);
  const klass = database.prepare(`
    SELECT c.*, t.user_id AS teacher_user_id
    FROM classes c
    JOIN teachers t ON t.id = c.teacher_id
    WHERE c.id = ?
  `).get(liveClassId);
  if (!klass) return { status: 404, message: '系统测试班不存在' };
  if (String(klass.data_scope || '').toLowerCase() !== 'system_test') return { status: 409, message: '目标班级不是 system_test，已拒绝初始化测试任务' };

  const fixtureKey = `system_test_assignment:${liveClassId}:teacher_student_loop`;
  const existing = hasColumn(database, 'assignments', 'fixture_key')
    ? database.prepare(`
      SELECT a.*, c.name AS class_name, c.data_scope AS class_data_scope, ${assignmentScopeExpression(database)} AS data_scope
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      WHERE a.fixture_key = ? AND ${activeAssignmentCondition(database)}
      LIMIT 1
    `).get(fixtureKey)
    : null;

  const archiveDuplicates = (keepId) => {
    const candidates = database.prepare(`
      SELECT a.id, a.title, a.status
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      WHERE a.class_id = ? AND a.id != ? AND ${activeAssignmentCondition(database)}
    `).all(liveClassId, keepId);
    for (const row of candidates) {
      database.prepare("UPDATE assignments SET data_scope = COALESCE(NULLIF(data_scope, ''), 'system_test'), status = 'archived', archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP) WHERE id = ?").run(row.id);
      database.prepare(`
        INSERT INTO class_membership_audit_logs (operator_id, operator_role, target_type, target_id, action, before_state, after_state, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(actorId || 'system'),
        'system',
        'assignment',
        String(row.id),
        'assignment.archive_duplicate_system_test',
        JSON.stringify(row),
        JSON.stringify({ status: 'archived', archived_at: 'CURRENT_TIMESTAMP' }),
        `保留 class ${liveClassId} 的唯一系统测试任务`
      );
    }
    return candidates.length;
  };

  try {
    database.exec('BEGIN IMMEDIATE');
    if (existing) {
      const archivedCount = archiveDuplicates(existing.id);
      database.exec('COMMIT');
      return { status: 200, assignment: withSubmissionStats(database, existing, options), created: false, archivedDuplicates: archivedCount };
    }

    const created = createManagedAssignment(database, { id: klass.teacher_user_id, role: 'teacher' }, {
      class_id: liveClassId,
      title: '师生闭环测试作文',
      prompt: '用于验证教师发布、学生查看、作文提交、AI 批改、教师审核和学生查看结果的完整教学流程。',
      requirements: '写一篇不少于300字的测试作文。只允许使用虚构内容，不得填写真实学生隐私。',
      essay_type: '材料作文',
      full_score: 60,
      grade: klass.grade || '测试',
      min_words: 300,
      max_words: 0,
      scoring_standard: '内容、表达、发展等级综合评分',
      data_scope: 'system_test',
      fixture_key: fixtureKey,
      status: 'published',
      requires_teacher_review: true,
      auto_grading: true,
      allow_student_view_result: true
    }, options);
    if (created.status !== 200) {
      database.exec('ROLLBACK');
      return created;
    }
    database.prepare(`
      UPDATE assignments
      SET data_scope = 'system_test',
          fixture_key = ?,
          status = 'published',
          requires_teacher_review = 1,
          auto_grading = 1,
          allow_student_view_result = 1,
          deleted_at = NULL,
          archived_at = NULL,
          published_at = COALESCE(published_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `).run(fixtureKey, created.assignment.id);
    database.prepare(`
      INSERT INTO class_membership_audit_logs (operator_id, operator_role, target_type, target_id, action, before_state, after_state, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(actorId || 'system'),
      'system',
      'assignment',
      String(created.assignment.id),
      'assignment.seed_system_test',
      '{}',
      JSON.stringify({ classId: liveClassId, fixtureKey, title: '师生闭环测试作文' }),
      '初始化唯一系统测试任务'
    );
    const archivedCount = archiveDuplicates(created.assignment.id);
    database.exec('COMMIT');
    return {
      status: 200,
      assignment: withSubmissionStats(database, database.prepare('SELECT a.*, c.name AS class_name, c.data_scope AS class_data_scope FROM assignments a JOIN classes c ON c.id = a.class_id WHERE a.id = ?').get(created.assignment.id), options),
      created: true,
      archivedDuplicates: archivedCount
    };
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function getAssignmentPublicSummary(database, assignmentId, options = {}) {
  const scopeExpression = assignmentScopeExpression(database);
  const assignment = database.prepare(`
    SELECT a.*, c.name AS class_name, c.data_scope AS class_data_scope, ${scopeExpression} AS data_scope
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    WHERE (a.id = ? OR a.public_id = ?) AND ${activeAssignmentCondition(database)}
  `).get(Number(assignmentId) || -1, String(assignmentId || ''));
  if (!assignment) return { status: 404, message: '作文作业不存在或链接已失效' };
  if (assignment.status && assignment.status !== 'published') return { status: 404, message: '作文作业尚未发布' };
  return { status: 200, assignment: withSubmissionStats(database, assignment, options) };
}

export function getAssignmentSubmissionStatus(database, user, assignmentId, options = {}) {
  const scopeExpression = assignmentScopeExpression(database);
  const assignment = database.prepare(`
    SELECT a.*, c.name AS class_name, c.teacher_id, c.data_scope AS class_data_scope, ${scopeExpression} AS data_scope
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    WHERE (a.id = ? OR a.public_id = ?) AND ${activeAssignmentCondition(database)}
  `).get(Number(assignmentId) || -1, String(assignmentId || ''));
  if (!assignment) return { status: 404, message: '作文作业不存在' };
  const teacher = getTeacher(database, user);
  if (teacher?.id !== assignment.teacher_id) return { status: 403, message: '没有查看该作业提交状态的权限' };

  const submissions = database.prepare(`
    SELECT e.id, e.student_id, e.title, e.status, e.grading_status, e.report_id, e.submit_round,
           e.word_count, e.submitted_at, e.created_at, u.name AS student_name, s.student_no
    FROM essays e
    JOIN students s ON s.id = e.student_id
    JOIN users u ON u.id = s.user_id
    WHERE e.assignment_id = ?
    ORDER BY e.created_at DESC, e.id DESC
  `).all(assignment.id);
  const submittedStudentIds = new Set(submissions.map((row) => Number(row.student_id)));
  const missing = database.prepare(`
    SELECT s.id AS student_id, s.student_no, u.name AS student_name
    FROM class_students cs
    JOIN students s ON s.id = cs.student_id
    JOIN users u ON u.id = s.user_id
    WHERE cs.class_id = ?
    ORDER BY CAST(s.student_no AS INTEGER), s.student_no, u.name
  `).all(assignment.class_id).filter((row) => !submittedStudentIds.has(Number(row.student_id)));

  return {
    status: 200,
    assignment: withSubmissionStats(database, assignment, options),
    submissions,
    missing
  };
}

export function buildAssignmentFeishuCard(assignment) {
  const deadline = assignment.deadline ? new Date(assignment.deadline).toLocaleString('zh-CN') : '未设置';
  const submitUrl = assignment.submission_url || assignment.share_url;
  const statusUrl = `${submitUrl}${String(submitUrl || '').includes('?') ? '&' : '?'}tab=status`;
  const detailUrl = `${submitUrl}${String(submitUrl || '').includes('?') ? '&' : '?'}view=assignment`;
  const promptSummary = String(assignment.prompt || '').replace(/\s+/g, ' ').slice(0, 180);
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '作文作业已发布' },
      subtitle: { tag: 'plain_text', content: 'Chinese Teacher AI Studio' }
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**作文标题**：${assignment.title}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**写作材料摘要**：${promptSummary || '见作业详情'}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**写作要求**：${assignment.requirements || assignment.prompt}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**最低/最高字数**：${assignment.min_words || 0} / ${assignment.max_words || '不限'}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**截止时间**：${deadline}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**班级**：${assignment.class_name || assignment.grade || '未填写'}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**当前已交/未交**：${assignment.submitted_count || 0}/${assignment.missing_count || 0}` } },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            type: 'default',
            text: { tag: 'plain_text', content: '查看作业' },
            url: detailUrl
          },
          {
            tag: 'button',
            type: 'primary',
            text: { tag: 'plain_text', content: '立即提交' },
            url: submitUrl
          },
          {
            tag: 'button',
            type: 'default',
            text: { tag: 'plain_text', content: '查看提交状态' },
            url: statusUrl
          }
        ]
      }
    ]
  };
}

export function buildAssignmentReminderCard(assignment) {
  const deadline = assignment.deadline ? new Date(assignment.deadline).toLocaleString('zh-CN') : '未设置';
  const submitUrl = assignment.submission_url || assignment.share_url;
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '作文作业提醒' },
      subtitle: { tag: 'plain_text', content: 'Chinese Teacher AI Studio' }
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**请尽快提交作文**：${assignment.title}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**截止时间**：${deadline}` } },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            type: 'primary',
            text: { tag: 'plain_text', content: '立即提交' },
            url: submitUrl
          }
        ]
      }
    ]
  };
}

export async function shareAssignmentToFeishu({ database, user, assignmentId, feishuService, chatId, options = {} }) {
  const status = getAssignmentSubmissionStatus(database, user, assignmentId, options);
  if (status.status !== 200) return status;
  if (!isFeishuBusinessEnabled(options.env || process.env)) {
    return {
      status: 200,
      sent: false,
      paused: true,
      message: buildFeishuBusinessMigrationNotice(options.env || process.env),
      card: buildAssignmentFeishuCard(status.assignment),
      assignment: status.assignment
    };
  }
  const binding = getPrimaryFeishuClassBinding(database, status.assignment.class_id);
  const targetChatId = String(chatId || status.assignment.feishu_chat_id || binding?.feishu_chat_id || '').trim();
  const card = buildAssignmentFeishuCard(status.assignment);
  if (!targetChatId) return { status: 200, sent: false, message: '未配置飞书群 chatId，已生成分享卡片', card, assignment: status.assignment };
  if (!feishuService?.sendCard) return { status: 200, sent: false, message: '飞书发送服务不可用，已生成分享卡片', card, assignment: status.assignment };
  const result = await feishuService.sendCard(targetChatId, card);
  const messageRecord = recordFeishuAssignmentMessage(database, {
    assignmentId: status.assignment.id,
    classId: status.assignment.class_id,
    feishuChatId: targetChatId,
    messageId: result?.message_id || result?.data?.message_id || '',
    messageType: 'assignment_publish',
    status: 'sent',
    idempotencyKey: `assignment:${status.assignment.id}:publish:${targetChatId}`
  });
  return { status: 200, sent: true, result, card, assignment: status.assignment, messageRecord };
}

export function revokeAssignmentFeishuPublish(database, user, assignmentId) {
  return markAssignmentMessageRevoked(database, user, assignmentId);
}

export function deleteManagedAssignment(database, user, assignmentId) {
  const assignment = database.prepare(`
    SELECT a.*, c.teacher_id, c.name AS class_name
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    WHERE a.id = ?
  `).get(assignmentId);
  if (!assignment) return { status: 404, message: '作文任务不存在' };

  const teacher = getTeacher(database, user);
  if (teacher?.id !== assignment.teacher_id) return { status: 403, message: '没有管理该任务的权限' };

  database.prepare('DELETE FROM assignments WHERE id = ?').run(assignmentId);
  return { status: 200, assignment };
}
