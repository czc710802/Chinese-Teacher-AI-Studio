import crypto from 'node:crypto';

const PUBLIC_ORIGIN = 'https://pi.zhenwanyue.icu';
const SENSITIVE_DETAIL_KEYS = /secret|token|password|authorization|cookie|key|appsecret|access/i;
const LONG_TEXT_KEYS = /essay|作文|report|报告|content|正文/i;

function nowIso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function getTeacherByUser(database, user) {
  if (!user) return null;
  return database.prepare(`
    SELECT t.*, u.name AS teacher_name, u.role AS user_role
    FROM teachers t
    JOIN users u ON u.id = t.user_id
    WHERE t.user_id = ?
  `).get(Number(user.id));
}

function hashBindingCode(code) {
  return crypto.createHash('sha256').update(String(code || '').trim().toUpperCase()).digest('hex');
}

function randomBindingCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let raw = '';
  const bytes = crypto.randomBytes(8);
  for (const byte of bytes) raw += alphabet[byte % alphabet.length];
  return `TCH-${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

function safeJsonDetails(details = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (SENSITIVE_DETAIL_KEYS.test(key) || LONG_TEXT_KEYS.test(key)) continue;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    safe[key] = String(text || '').slice(0, 300);
  }
  return JSON.stringify(safe);
}

export function recordFeishuAction(database, {
  actorType,
  actorId = '',
  feishuOpenId = '',
  action,
  resourceType = '',
  resourceId = '',
  requestId = '',
  status = 'success',
  errorCode = '',
  details = {}
} = {}) {
  const normalizedRequestId = String(requestId || '').trim();
  if (normalizedRequestId) {
    const existing = database.prepare('SELECT * FROM feishu_action_logs WHERE request_id = ?').get(normalizedRequestId);
    if (existing) return existing;
  }
  const result = database.prepare(`
    INSERT INTO feishu_action_logs
      (actor_type, actor_id, feishu_open_id, action, resource_type, resource_id, request_id, status, error_code, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(actorType || 'system'),
    String(actorId || ''),
    String(feishuOpenId || ''),
    String(action || 'unknown'),
    String(resourceType || ''),
    String(resourceId || ''),
    normalizedRequestId,
    String(status || 'success'),
    String(errorCode || ''),
    safeJsonDetails(details)
  );
  return database.prepare('SELECT * FROM feishu_action_logs WHERE id = ?').get(result.lastInsertRowid);
}

export function recordFeishuCardInteraction(database, {
  eventId = '',
  operatorOpenId = '',
  actionName,
  resourceType = '',
  resourceId = '',
  idempotencyKey,
  status = 'processed'
} = {}) {
  const key = String(idempotencyKey || `${eventId}:${operatorOpenId}:${actionName}`).trim();
  const existing = database.prepare('SELECT * FROM feishu_card_interactions WHERE idempotency_key = ?').get(key);
  if (existing) return existing;
  const result = database.prepare(`
    INSERT INTO feishu_card_interactions
      (event_id, operator_open_id, action_name, resource_type, resource_id, idempotency_key, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(eventId || ''),
    String(operatorOpenId || ''),
    String(actionName || 'unknown'),
    String(resourceType || ''),
    String(resourceId || ''),
    key,
    String(status || 'processed')
  );
  return database.prepare('SELECT * FROM feishu_card_interactions WHERE id = ?').get(result.lastInsertRowid);
}

export function createTeacherBindingCode(database, {
  teacherId,
  createdBy = '',
  ttlSeconds = 900,
  now = new Date()
} = {}) {
  const teacher = database.prepare('SELECT id FROM teachers WHERE id = ?').get(Number(teacherId));
  if (!teacher) return { status: 404, message: '教师不存在' };
  const code = randomBindingCode();
  const createdAt = new Date(nowIso(now));
  const expiresAt = new Date(createdAt.getTime() + Number(ttlSeconds || 900) * 1000).toISOString();
  const result = database.prepare(`
    INSERT INTO feishu_teacher_binding_codes
      (teacher_id, code_hash, expires_at, created_by, status, created_at)
    VALUES (?, ?, ?, ?, 'active', ?)
  `).run(Number(teacherId), hashBindingCode(code), expiresAt, String(createdBy || ''), createdAt.toISOString());
  recordFeishuAction(database, {
    actorType: 'admin',
    actorId: String(createdBy || ''),
    action: 'teacher_binding_code_create',
    resourceType: 'teacher',
    resourceId: String(teacherId),
    requestId: `teacher-binding-code:${result.lastInsertRowid}`,
    status: 'success'
  });
  return { status: 200, id: result.lastInsertRowid, teacherId: Number(teacherId), code, expiresAt };
}

export function bindTeacherWithCode(database, {
  code,
  feishuOpenId,
  feishuUnionId = '',
  tenantKey = '',
  now = new Date()
} = {}) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  const openId = String(feishuOpenId || '').trim();
  if (!normalizedCode || !openId) return { status: 400, message: '请提供绑定码和飞书身份' };
  const row = database.prepare('SELECT * FROM feishu_teacher_binding_codes WHERE code_hash = ?').get(hashBindingCode(normalizedCode));
  if (!row) return { status: 400, message: '绑定码无效' };
  if (row.used_at || row.status === 'used') return { status: 409, message: '绑定码已使用' };
  if (row.status !== 'active') return { status: 409, message: '绑定码不可用' };
  if (new Date(row.expires_at).getTime() < new Date(nowIso(now)).getTime()) {
    database.prepare("UPDATE feishu_teacher_binding_codes SET status = 'expired' WHERE id = ?").run(row.id);
    return { status: 410, message: '绑定码已过期' };
  }

  database.prepare(`
    INSERT INTO feishu_teacher_bindings
      (teacher_id, feishu_open_id, feishu_union_id, tenant_key, status, verified_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
    ON CONFLICT(teacher_id, tenant_key) DO UPDATE SET
      feishu_open_id = excluded.feishu_open_id,
      feishu_union_id = excluded.feishu_union_id,
      status = 'active',
      verified_at = excluded.verified_at,
      updated_at = excluded.updated_at
  `).run(row.teacher_id, openId, String(feishuUnionId || ''), String(tenantKey || ''), nowIso(now), nowIso(now));
  database.prepare("UPDATE feishu_teacher_binding_codes SET used_at = ?, status = 'used' WHERE id = ?").run(nowIso(now), row.id);
  recordFeishuAction(database, {
    actorType: 'teacher',
    actorId: String(row.teacher_id),
    feishuOpenId: openId,
    action: 'teacher_bind',
    resourceType: 'teacher',
    resourceId: String(row.teacher_id),
    requestId: `teacher-bind-code:${row.id}`,
    status: 'success'
  });
  return {
    status: 200,
    binding: database.prepare('SELECT * FROM feishu_teacher_bindings WHERE teacher_id = ? AND tenant_key = ?').get(row.teacher_id, String(tenantKey || ''))
  };
}

export function listTeacherBindings(database, { keyword = '' } = {}) {
  const like = `%${String(keyword || '').trim()}%`;
  return database.prepare(`
    SELECT
      t.id AS teacher_id,
      u.name AS teacher_name,
      u.username,
      t.title,
      t.school,
      b.id AS binding_id,
      b.feishu_open_id,
      b.feishu_union_id,
      b.tenant_key,
      b.status,
      b.verified_at,
      b.updated_at,
      COUNT(c.id) AS class_count
    FROM teachers t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN feishu_teacher_bindings b ON b.teacher_id = t.id
    LEFT JOIN classes c ON c.teacher_id = t.id
    WHERE (? = '%%' OR u.name LIKE ? OR u.username LIKE ?)
    GROUP BY t.id, b.id
    ORDER BY u.name ASC, t.id ASC
  `).all(like, like, like);
}

export function updateTeacherBindingStatus(database, {
  bindingId,
  status,
  actorId = '',
  requestId = ''
} = {}) {
  const allowed = new Set(['active', 'disabled', 'unbound']);
  if (!allowed.has(status)) return { status: 400, message: '绑定状态不合法' };
  const binding = database.prepare('SELECT * FROM feishu_teacher_bindings WHERE id = ?').get(Number(bindingId));
  if (!binding) return { status: 404, message: '教师绑定不存在' };
  database.prepare('UPDATE feishu_teacher_bindings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, Number(bindingId));
  recordFeishuAction(database, {
    actorType: 'admin',
    actorId: String(actorId || ''),
    action: `teacher_binding_${status}`,
    resourceType: 'teacher_binding',
    resourceId: String(bindingId),
    requestId: requestId || `teacher-binding:${bindingId}:${status}:${Date.now()}`,
    status: 'success'
  });
  return { status: 200, binding: database.prepare('SELECT * FROM feishu_teacher_bindings WHERE id = ?').get(Number(bindingId)) };
}

export function bindClassToFeishuGroup(database, {
  user,
  classId,
  feishuChatId,
  feishuChatName = '',
  tenantKey = '',
  isPrimary = true,
  requestId = ''
} = {}) {
  const normalizedRequestId = String(requestId || '').trim();
  const chatId = String(feishuChatId || '').trim();
  if (normalizedRequestId) {
    const existingAction = database.prepare('SELECT * FROM feishu_action_logs WHERE request_id = ?').get(normalizedRequestId);
    if (existingAction) {
      const existingBinding = chatId
        ? database.prepare('SELECT * FROM feishu_class_bindings WHERE class_id = ? AND feishu_chat_id = ?').get(Number(classId), chatId)
        : null;
      return { status: 200, idempotent: true, binding: existingBinding };
    }
  }
  const teacher = getTeacherByUser(database, user);
  if (!teacher) return { status: 403, message: '没有教师权限' };
  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(Number(classId));
  if (!klass) return { status: 404, message: '班级不存在' };
  if (Number(klass.teacher_id) !== Number(teacher.id)) return { status: 403, message: '没有管理该班级的权限' };
  if (!chatId) return { status: 400, message: '请填写飞书群 chatId' };

  const occupied = database.prepare(`
    SELECT * FROM feishu_class_bindings
    WHERE feishu_chat_id = ? AND COALESCE(tenant_key, '') = ? AND class_id <> ? AND status = 'active'
  `).get(chatId, String(tenantKey || ''), Number(classId));
  if (occupied) return { status: 409, message: '该飞书群已绑定其他班级' };

  if (isPrimary) {
    database.prepare('UPDATE feishu_class_bindings SET is_primary = 0, updated_at = CURRENT_TIMESTAMP WHERE class_id = ?').run(Number(classId));
  }
  database.prepare(`
    INSERT INTO feishu_class_bindings
      (teacher_id, class_id, feishu_chat_id, feishu_chat_name, tenant_key, status, is_primary, updated_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(class_id, feishu_chat_id) DO UPDATE SET
      teacher_id = excluded.teacher_id,
      feishu_chat_name = excluded.feishu_chat_name,
      tenant_key = excluded.tenant_key,
      status = 'active',
      is_primary = excluded.is_primary,
      updated_at = CURRENT_TIMESTAMP
  `).run(Number(teacher.id), Number(classId), chatId, String(feishuChatName || ''), String(tenantKey || ''), isPrimary ? 1 : 0);

  const binding = database.prepare('SELECT * FROM feishu_class_bindings WHERE class_id = ? AND feishu_chat_id = ?').get(Number(classId), chatId);
  recordFeishuAction(database, {
    actorType: 'teacher',
    actorId: String(teacher.id),
    action: 'class_group_bind',
    resourceType: 'class',
    resourceId: String(classId),
    requestId: normalizedRequestId || `class-bind:${binding.id}:${Date.now()}`,
    status: 'success',
    details: { feishuChatName, isPrimary: Boolean(isPrimary) }
  });
  return { status: 200, binding };
}

export function listTeacherFeishuClasses(database, user) {
  const teacher = getTeacherByUser(database, user);
  if (!teacher) return { status: 403, message: '没有教师权限', rows: [] };
  const rows = database.prepare(`
    SELECT
      c.id,
      c.name,
      c.grade,
      c.teacher_id,
      b.id AS binding_id,
      b.feishu_chat_id,
      b.feishu_chat_name,
      b.tenant_key,
      b.is_primary,
      b.status AS binding_status,
      b.last_tested_at,
      b.last_test_status,
      b.last_error_code
    FROM classes c
    LEFT JOIN feishu_class_bindings b ON b.class_id = c.id AND b.status = 'active'
    WHERE c.teacher_id = ?
    ORDER BY c.created_at DESC, c.id DESC, b.is_primary DESC
  `).all(teacher.id);
  return { status: 200, teacher, rows };
}

export function updateClassBindingTestResult(database, {
  bindingId,
  ok,
  errorCode = '',
  actorId = '',
  requestId = ''
} = {}) {
  const binding = database.prepare('SELECT * FROM feishu_class_bindings WHERE id = ?').get(Number(bindingId));
  if (!binding) return { status: 404, message: '班级群绑定不存在' };
  database.prepare(`
    UPDATE feishu_class_bindings
    SET last_tested_at = CURRENT_TIMESTAMP, last_test_status = ?, last_error_code = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(ok ? 'success' : 'failure', String(errorCode || ''), Number(bindingId));
  recordFeishuAction(database, {
    actorType: 'teacher',
    actorId: String(actorId || binding.teacher_id),
    action: 'class_group_test',
    resourceType: 'class_binding',
    resourceId: String(bindingId),
    requestId: requestId || `class-group-test:${bindingId}:${Date.now()}`,
    status: ok ? 'success' : 'failure',
    errorCode
  });
  return { status: 200, binding: database.prepare('SELECT * FROM feishu_class_bindings WHERE id = ?').get(Number(bindingId)) };
}

export function getTeacherWorkbenchSummary(database, {
  feishuOpenId,
  tenantKey = '',
  now = new Date(),
  publicOrigin = PUBLIC_ORIGIN
} = {}) {
  const openId = String(feishuOpenId || '').trim();
  const binding = database.prepare(`
    SELECT b.*, t.user_id, u.name AS teacher_name, t.school, t.title
    FROM feishu_teacher_bindings b
    JOIN teachers t ON t.id = b.teacher_id
    JOIN users u ON u.id = t.user_id
    WHERE b.feishu_open_id = ? AND COALESCE(b.tenant_key, '') = ? AND b.status = 'active' AND u.role = 'teacher'
  `).get(openId, String(tenantKey || ''));
  if (!binding) {
    return { status: 401, message: '教师身份未绑定', bound: false, publicOrigin };
  }

  const teacherId = Number(binding.teacher_id);
  const today = nowIso(now).slice(0, 10);
  const classCount = database.prepare('SELECT COUNT(*) AS count FROM classes WHERE teacher_id = ?').get(teacherId).count;
  const boundGroupCount = database.prepare(`
    SELECT COUNT(*) AS count FROM feishu_class_bindings
    WHERE teacher_id = ? AND status = 'active'
  `).get(teacherId).count;
  const todayDueAssignments = database.prepare(`
    SELECT COUNT(*) AS count
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    WHERE c.teacher_id = ? AND date(a.deadline) = date(?)
  `).get(teacherId, today).count;
  const pendingGradingCount = database.prepare(`
    SELECT COUNT(*) AS count
    FROM essays e
    JOIN assignments a ON a.id = e.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE c.teacher_id = ? AND e.grading_status IN ('pending', 'queued', 'processing')
  `).get(teacherId).count;
  const pendingReviewCount = database.prepare(`
    SELECT COUNT(*) AS count
    FROM essays e
    JOIN assignments a ON a.id = e.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE c.teacher_id = ?
      AND e.grading_status = 'graded'
      AND e.status NOT IN ('report_published', 'published')
  `).get(teacherId).count;
  const missingStudentCount = database.prepare(`
    SELECT COALESCE(SUM(total_students - submitted_students), 0) AS count
    FROM (
      SELECT
        a.id,
        COUNT(DISTINCT cs.student_id) AS total_students,
        COUNT(DISTINCT e.student_id) AS submitted_students
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      LEFT JOIN class_students cs ON cs.class_id = c.id
      LEFT JOIN essays e ON e.assignment_id = a.id AND e.student_id = cs.student_id
      WHERE c.teacher_id = ? AND a.status IN ('published', 'active')
      GROUP BY a.id
    )
  `).get(teacherId).count;

  recordFeishuAction(database, {
    actorType: 'teacher',
    actorId: String(teacherId),
    feishuOpenId: openId,
    action: 'open_workbench',
    resourceType: 'workbench',
    resourceId: 'teacher',
    requestId: `workbench:${openId}:${today}:${Date.now()}`,
    status: 'success'
  });

  return {
    status: 200,
    bound: true,
    teacherId,
    teacherName: binding.teacher_name,
    school: binding.school || '',
    title: binding.title || '',
    bindingStatus: binding.status,
    classCount: Number(classCount || 0),
    boundGroupCount: Number(boundGroupCount || 0),
    todayDueAssignments: Number(todayDueAssignments || 0),
    pendingGradingCount: Number(pendingGradingCount || 0),
    pendingReviewCount: Number(pendingReviewCount || 0),
    missingStudentCount: Number(missingStudentCount || 0),
    systemStatus: '正常',
    publicOrigin
  };
}

export function getFeishuPermissionStatus() {
  return {
    canListChats: false,
    missingPermissions: [
      'im:chat:readonly 或等效机器人所在群读取权限',
      'im:message:send_as_bot'
    ],
    needsAppRepublish: true,
    manualChatIdFallback: true
  };
}
