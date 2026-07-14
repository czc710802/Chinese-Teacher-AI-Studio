import crypto from 'node:crypto';
import { db } from '../db/connection.js';

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function nowIso() {
  return new Date().toISOString();
}

function toJson(value) {
  try { return JSON.stringify(value ?? {}, null, 2); } catch { return '{}'; }
}

function fromJson(value, fallback = {}) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function randomString(length = 8) {
  const bytes = crypto.randomBytes(length);
  let output = '';
  for (let i = 0; i < bytes.length; i += 1) {
    output += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  }
  return output;
}

export function buildClassJoinToken() {
  return `join_${crypto.randomUUID().replace(/-/g, '')}`;
}

export function hashJoinToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

export function buildInviteCode(prefix = 'JOIN') {
  const safePrefix = String(prefix || 'JOIN').replace(/[^A-Z0-9]/gi, '').slice(0, 4).toUpperCase() || 'JOIN';
  return `${safePrefix}-${randomString(6)}`;
}

export function buildQrSvg(url, title = '班级邀请链接') {
  const safeUrl = String(url || '').replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char]));
  const safeTitle = String(title || '').replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char]));
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280" viewBox="0 0 280 280" role="img">',
    '<rect width="280" height="280" rx="18" fill="#ffffff"/>',
    '<rect x="20" y="20" width="68" height="68" rx="10" fill="#1f2937"/><rect x="36" y="36" width="36" height="36" rx="4" fill="#ffffff"/>',
    '<rect x="192" y="20" width="68" height="68" rx="10" fill="#1f2937"/><rect x="208" y="36" width="36" height="36" rx="4" fill="#ffffff"/>',
    '<rect x="20" y="192" width="68" height="68" rx="10" fill="#1f2937"/><rect x="36" y="208" width="36" height="36" rx="4" fill="#ffffff"/>',
    '<path d="M114 38h16v16h-16zm24 0h16v16h-16zm24 0h16v16h-16zm-48 24h16v16h-16zm48 0h16v16h-16zm-24 24h16v16h-16zm56 0h16v16h-16zm-104 24h16v16h-16zm32 0h16v16h-16zm24 0h16v16h-16zm32 0h16v16h-16zm-88 24h16v16h-16zm40 0h16v16h-16zm24 0h16v16h-16zm40 0h16v16h-16zm-56 24h16v16h-16zm40 0h16v16h-16zm-88 24h16v16h-16zm48 0h16v16h-16zm24 0h16v16h-16zm32 0h16v16h-16zm-96 24h16v16h-16zm48 0h16v16h-16zm56 0h16v16h-16z" fill="#1f2937"/>',
    `<text x="140" y="150" text-anchor="middle" font-size="14" fill="#111827">${safeTitle}</text>`,
    `<text x="140" y="172" text-anchor="middle" font-size="10" fill="#4b5563">${safeUrl.slice(0, 48)}</text>`,
    '</svg>'
  ].join('');
}

function getTeacherId(database, user) {
  if (!user) return null;
  return database.prepare('SELECT id FROM teachers WHERE user_id = ?').get(user.id)?.id || null;
}

function teacherOwnsClass(database, user, classId) {
  const teacherId = getTeacherId(database, user);
  if (!teacherId) return false;
  const klass = database.prepare('SELECT id FROM classes WHERE id = ? AND teacher_id = ?').get(classId, teacherId);
  return Boolean(klass);
}

function classBaseRow(row = {}) {
  return {
    id: row.id,
    name: row.name,
    grade: row.grade || '',
    teacher_id: row.teacher_id,
    invite_code: row.invite_code || '',
    invite_code_expires_at: row.invite_code_expires_at || '',
    join_mode: row.join_mode || 'approval',
    status: row.status || 'active',
    max_students: Number(row.max_students || 0),
    archived_at: row.archived_at || '',
    deleted_at: row.deleted_at || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || row.created_at || ''
  };
}

function ensureAudit(database, payload = {}) {
  database.prepare(`
    INSERT INTO class_membership_audit_logs (
      operator_id, operator_role, target_type, target_id, action, before_state, after_state, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(payload.operatorId || ''),
    String(payload.operatorRole || ''),
    String(payload.targetType || ''),
    String(payload.targetId || ''),
    String(payload.action || ''),
    toJson(payload.before || {}),
    toJson(payload.after || {}),
    String(payload.reason || ''),
    nowIso()
  );
}

function classCounts(database, classId) {
  return {
    student_count: database.prepare('SELECT COUNT(*) AS count FROM class_students WHERE class_id = ?').get(classId).count,
    binding_count: database.prepare('SELECT COUNT(*) AS count FROM student_class_bindings WHERE class_id = ?').get(classId).count,
    pending_join_requests: database.prepare('SELECT COUNT(*) AS count FROM class_join_requests WHERE class_id = ? AND status = ?').get(classId, 'pending').count,
    active_invites: database.prepare('SELECT COUNT(*) AS count FROM class_invites WHERE class_id = ? AND status = ?').get(classId, 'active').count
  };
}

function latestInvite(database, classId) {
  return database.prepare(`
    SELECT *
    FROM class_invites
    WHERE class_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(classId) || null;
}

function attachLifecycle(database, row) {
  if (!row) return null;
  const invite = latestInvite(database, row.id);
  return {
    ...classBaseRow(row),
    ...classCounts(database, row.id),
    invite: invite ? {
      id: invite.id,
      invite_code: invite.invite_code,
      join_mode: invite.join_mode,
      max_uses: invite.max_uses,
      used_count: invite.used_count,
      expires_at: invite.expires_at || '',
      status: invite.status,
      created_at: invite.created_at,
      updated_at: invite.updated_at
    } : null,
    invite_url: invite ? `/student-mobile/join?token=${encodeURIComponent(invite.invite_token)}` : '',
    qr_svg: invite ? buildQrSvg(`/student-mobile/join?token=${encodeURIComponent(invite.invite_token)}`, row.name) : ''
  };
}

export function listLifecycleClasses(database = db, user, filters = {}) {
  const teacherId = getTeacherId(database, user);
  if (!teacherId) return { status: 403, message: '没有访问班级的权限', rows: [] };
  let rows = database.prepare(`
    SELECT *
    FROM classes
    WHERE teacher_id = ?
    ORDER BY updated_at DESC, id DESC
  `).all(teacherId).map((row) => attachLifecycle(database, row));
  if (filters.status) rows = rows.filter((row) => row.status === filters.status);
  if (filters.joinMode) rows = rows.filter((row) => row.join_mode === filters.joinMode);
  if (filters.keyword) rows = rows.filter((row) => `${row.name}${row.grade}${row.invite_code}`.includes(String(filters.keyword)));
  return { status: 200, rows };
}

export function createLifecycleClass(database = db, user, body = {}) {
  const teacherId = getTeacherId(database, user);
  if (!teacherId) return { status: 403, message: '请先创建教师账号后再创建班级' };

  const name = String(body.name || body.className || '').trim();
  if (!name) return { status: 400, message: '请填写班级名称' };
  const grade = String(body.grade || '').trim();
  const joinMode = String(body.join_mode || body.joinMode || 'approval').trim() || 'approval';
  const status = String(body.status || 'active').trim() || 'active';
  const maxStudents = Math.max(0, Number(body.max_students || body.maxStudents || 0));
  const inviteCode = buildInviteCode(grade || 'JOIN');
  const inviteToken = buildClassJoinToken();
  const now = nowIso();

  const result = database.prepare(`
    INSERT INTO classes (name, grade, teacher_id, invite_code, join_mode, status, max_students, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, grade, teacherId, inviteCode, joinMode, status, maxStudents, now, now);
  const classId = result.lastInsertRowid;
  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);

  database.prepare(`
    INSERT INTO class_invites (
      class_id, invite_code, invite_token, invite_token_hash, join_mode, max_uses, used_count, expires_at, status,
      created_by_user_id, created_by_role, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    classId,
    inviteCode,
    inviteToken,
    hashJoinToken(inviteToken),
    joinMode,
    Number(body.max_uses || body.maxUses || 0) || 0,
    0,
    body.invite_code_expires_at || body.inviteCodeExpiresAt || null,
    'active',
    String(user.id || ''),
    String(user.role || 'teacher'),
    now,
    now
  );
  ensureAudit(database, {
    operatorId: user.id,
    operatorRole: user.role,
    targetType: 'class',
    targetId: String(classId),
    action: 'class.create',
    after: klass,
    reason: 'teacher create class'
  });
  return { status: 200, class: attachLifecycle(database, klass), inviteToken };
}

export function updateLifecycleClass(database = db, user, classId, body = {}) {
  if (!teacherOwnsClass(database, user, classId)) return { status: 403, message: '没有管理该班级的权限' };
  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!klass) return { status: 404, message: '班级不存在' };
  const before = { ...klass };
  const next = {
    name: String(body.name ?? klass.name).trim() || klass.name,
    grade: String(body.grade ?? klass.grade ?? '').trim(),
    join_mode: String(body.join_mode ?? body.joinMode ?? klass.join_mode ?? 'approval').trim() || 'approval',
    status: String(body.status ?? klass.status ?? 'active').trim() || 'active',
    max_students: Math.max(0, Number(body.max_students ?? body.maxStudents ?? klass.max_students ?? 0)),
    invite_code_expires_at: body.invite_code_expires_at ?? body.inviteCodeExpiresAt ?? klass.invite_code_expires_at ?? null
  };
  database.prepare(`
    UPDATE classes
    SET name = ?, grade = ?, join_mode = ?, status = ?, max_students = ?, invite_code_expires_at = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(next.name, next.grade, next.join_mode, next.status, next.max_students, next.invite_code_expires_at, classId);
  const updated = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  ensureAudit(database, {
    operatorId: user.id,
    operatorRole: user.role,
    targetType: 'class',
    targetId: String(classId),
    action: 'class.update',
    before,
    after: updated,
    reason: 'teacher update class'
  });
  return { status: 200, class: attachLifecycle(database, updated) };
}

export function archiveLifecycleClass(database = db, user, classId) {
  if (!teacherOwnsClass(database, user, classId)) return { status: 403, message: '没有管理该班级的权限' };
  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!klass) return { status: 404, message: '班级不存在' };
  const before = { ...klass };
  database.prepare(`
    UPDATE classes
    SET status = ?, archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run('archived', classId);
  const updated = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  ensureAudit(database, {
    operatorId: user.id,
    operatorRole: user.role,
    targetType: 'class',
    targetId: String(classId),
    action: 'class.archive',
    before,
    after: updated,
    reason: 'teacher archive class'
  });
  return { status: 200, class: attachLifecycle(database, updated) };
}

export function restoreLifecycleClass(database = db, user, classId) {
  if (!teacherOwnsClass(database, user, classId)) return { status: 403, message: '没有管理该班级的权限' };
  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!klass) return { status: 404, message: '班级不存在' };
  const before = { ...klass };
  database.prepare(`
    UPDATE classes
    SET status = ?, archived_at = NULL, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run('active', classId);
  const updated = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  ensureAudit(database, {
    operatorId: user.id,
    operatorRole: user.role,
    targetType: 'class',
    targetId: String(classId),
    action: 'class.restore',
    before,
    after: updated,
    reason: 'teacher restore class'
  });
  return { status: 200, class: attachLifecycle(database, updated) };
}

export function rotateClassInvite(database = db, user, classId, body = {}) {
  if (!teacherOwnsClass(database, user, classId)) return { status: 403, message: '没有管理该班级的权限' };
  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!klass) return { status: 404, message: '班级不存在' };
  const now = nowIso();
  const inviteCode = buildInviteCode(klass.grade || 'JOIN');
  const inviteToken = buildClassJoinToken();
  database.prepare('UPDATE class_invites SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE class_id = ? AND status = ?').run('revoked', classId, 'active');
  database.prepare(`
    INSERT INTO class_invites (
      class_id, invite_code, invite_token, invite_token_hash, join_mode, max_uses, used_count, expires_at, status,
      created_by_user_id, created_by_role, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    classId,
    inviteCode,
    inviteToken,
    hashJoinToken(inviteToken),
    String(body.join_mode || body.joinMode || klass.join_mode || 'approval').trim() || 'approval',
    Math.max(0, Number(body.max_uses || body.maxUses || 0)),
    0,
    body.invite_code_expires_at || body.inviteCodeExpiresAt || klass.invite_code_expires_at || null,
    'active',
    String(user.id || ''),
    String(user.role || 'teacher'),
    now,
    now
  );
  database.prepare('UPDATE classes SET invite_code = ?, invite_code_expires_at = ?, join_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(inviteCode, body.invite_code_expires_at || body.inviteCodeExpiresAt || null, body.join_mode || body.joinMode || klass.join_mode || 'approval', classId);
  const updated = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  ensureAudit(database, {
    operatorId: user.id,
    operatorRole: user.role,
    targetType: 'class',
    targetId: String(classId),
    action: 'class.invite.rotate',
    before: klass,
    after: updated,
    reason: 'teacher rotate invite'
  });
  return { status: 200, class: attachLifecycle(database, updated), inviteToken };
}

export function getJoinPreview(database = db, token = '') {
  const invite = database.prepare('SELECT * FROM class_invites WHERE (invite_token = ? OR invite_token_hash = ?) AND status = ?').get(token, hashJoinToken(token), 'active');
  if (!invite) return { status: 404, message: '入班链接不存在或已失效' };
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return { status: 410, message: '入班链接已过期' };
  }
  const klass = database.prepare(`
    SELECT c.*, t.id AS teacher_internal_id, u.name AS teacher_name
    FROM classes c
    JOIN teachers t ON t.id = c.teacher_id
    JOIN users u ON u.id = t.user_id
    WHERE c.id = ?
  `).get(invite.class_id);
  if (!klass) return { status: 404, message: '班级不存在' };
  return {
    status: 200,
    class: {
      ...attachLifecycle(database, klass),
      teacher_name: klass.teacher_name || '',
    teacher_id: klass.teacher_internal_id || '',
    invite_code: invite.invite_code,
    invite_status: invite.status,
    invite_expires_at: invite.expires_at || '',
      invite_join_mode: invite.join_mode || 'approval',
      invite_url: `/student-mobile/join?token=${encodeURIComponent(invite.invite_token)}`
    }
  };
}

function findStudentByIdentity(database, payload = {}) {
  const studentNo = String(payload.studentNo || payload.student_no || '').trim();
  const name = String(payload.studentName || payload.student_name || payload.name || '').trim();
  if (studentNo) {
    const row = database.prepare(`
      SELECT s.*, u.name AS user_name
      FROM students s
      JOIN users u ON u.id = s.user_id
      WHERE s.student_no = ?
    `).get(studentNo);
    if (row) return row;
  }
  if (name) {
    return database.prepare(`
      SELECT s.*, u.name AS user_name
      FROM students s
      JOIN users u ON u.id = s.user_id
      WHERE u.name = ?
      ORDER BY s.id ASC
      LIMIT 1
    `).get(name);
  }
  return null;
}

function addMembership(database, studentId, classId, joinMode = 'approval') {
  database.prepare(`
    INSERT OR IGNORE INTO class_students (class_id, student_id, joined_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `).run(classId, studentId);
  database.prepare(`
    INSERT INTO student_class_bindings (student_id, class_id, join_mode, status, joined_at, updated_at)
    VALUES (?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(student_id, class_id) DO UPDATE SET
      join_mode = excluded.join_mode,
      status = 'active',
      left_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  `).run(studentId, classId, joinMode);
}

export function createJoinRequest(database = db, input = {}) {
  const token = String(input.token || input.inviteToken || '').trim();
  if (!token) return { status: 400, message: '缺少入班令牌' };
  const invite = database.prepare('SELECT * FROM class_invites WHERE (invite_token = ? OR invite_token_hash = ?) AND status = ?').get(token, hashJoinToken(token), 'active');
  if (!invite) return { status: 404, message: '入班链接不存在或已失效' };
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return { status: 410, message: '入班链接已过期' };
  }
  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(invite.class_id);
  if (!klass) return { status: 404, message: '班级不存在' };
  if (klass.status === 'archived' || klass.status === 'deleted') return { status: 409, message: '班级已不可加入' };
  if (klass.join_mode === 'closed') return { status: 409, message: '该班级暂不接受新成员' };
  const memberCount = database.prepare('SELECT COUNT(*) AS count FROM class_students WHERE class_id = ?').get(klass.id).count;
  if (Number(klass.max_students || 0) > 0 && Number(memberCount || 0) >= Number(klass.max_students || 0)) {
    return { status: 409, message: '班级人数已满' };
  }
  if (invite.max_uses > 0 && Number(invite.used_count || 0) >= Number(invite.max_uses || 0)) {
    return { status: 409, message: '入班名额已用完' };
  }

  const student = input.studentId ? database.prepare('SELECT * FROM students WHERE id = ?').get(input.studentId) : findStudentByIdentity(database, input);
  const studentName = String(input.studentName || input.name || student?.user_name || '').trim();
  if (!studentName) return { status: 400, message: '请填写学生姓名' };
  if (student && database.prepare('SELECT 1 FROM class_students WHERE class_id = ? AND student_id = ?').get(klass.id, student.id)) {
    return { status: 409, message: '该学生已经在这个班级中' };
  }

  const requestId = database.prepare(`
    INSERT INTO class_join_requests (
      class_id, student_id, student_name, student_no, source, status, invite_id, metadata, requested_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    klass.id,
    student?.id || null,
    studentName,
    String(input.studentNo || input.student_no || student?.student_no || ''),
    String(input.source || 'student-mobile'),
    klass.join_mode === 'open' && student ? 'approved' : 'pending',
    invite.id,
    toJson({ userAgent: String(input.userAgent || ''), referrer: String(input.referrer || '') })
  ).lastInsertRowid;

  if (klass.join_mode === 'open' && student) {
    addMembership(database, student.id, klass.id, invite.join_mode || klass.join_mode || 'approval');
    database.prepare('UPDATE class_join_requests SET reviewed_at = CURRENT_TIMESTAMP, reviewed_by_user_id = ?, review_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(String(input.reviewedByUserId || ''), 'auto approved', requestId);
    database.prepare('UPDATE class_invites SET used_count = used_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(invite.id);
  }

  ensureAudit(database, {
    operatorId: String(input.operatorId || student?.user_id || ''),
    operatorRole: String(input.operatorRole || 'student'),
    targetType: 'class',
    targetId: String(klass.id),
    action: 'class.join.request',
    before: {},
    after: { requestId, status: klass.join_mode === 'open' && student ? 'approved' : 'pending' },
    reason: 'student join request'
  });

  return {
    status: 200,
    request: database.prepare('SELECT * FROM class_join_requests WHERE id = ?').get(requestId)
  };
}

export function listJoinRequests(database = db, user, classId) {
  if (!teacherOwnsClass(database, user, classId)) return { status: 403, message: '没有管理该班级的权限', rows: [] };
  return {
    status: 200,
    rows: database.prepare(`
      SELECT *
      FROM class_join_requests
      WHERE class_id = ?
      ORDER BY requested_at DESC, id DESC
    `).all(classId)
  };
}

export function approveJoinRequest(database = db, user, classId, requestId) {
  if (!teacherOwnsClass(database, user, classId)) return { status: 403, message: '没有管理该班级的权限' };
  const request = database.prepare('SELECT * FROM class_join_requests WHERE id = ? AND class_id = ?').get(requestId, classId);
  if (!request) return { status: 404, message: '入班申请不存在' };
  const student = request.student_id ? database.prepare('SELECT * FROM students WHERE id = ?').get(request.student_id) : null;
  if (!student) return { status: 404, message: '学生档案不存在' };
  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!klass) return { status: 404, message: '班级不存在' };
  const memberCount = database.prepare('SELECT COUNT(*) AS count FROM class_students WHERE class_id = ?').get(classId).count;
  if (Number(klass.max_students || 0) > 0 && Number(memberCount || 0) >= Number(klass.max_students || 0)) {
    return { status: 409, message: '班级人数已满' };
  }
  const invite = request.invite_id ? database.prepare('SELECT * FROM class_invites WHERE id = ?').get(request.invite_id) : latestInvite(database, classId);
  addMembership(database, student.id, classId, invite?.join_mode || 'approval');
  database.prepare(`
    UPDATE class_join_requests
    SET status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by_user_id = ?, review_reason = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run('approved', String(user.id || ''), String(request.review_reason || ''), requestId);
  if (invite) {
    database.prepare('UPDATE class_invites SET used_count = used_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(invite.id);
  }
  ensureAudit(database, {
    operatorId: user.id,
    operatorRole: user.role,
    targetType: 'class',
    targetId: String(classId),
    action: 'class.join.approve',
    before: request,
    after: { ...request, status: 'approved' },
    reason: 'teacher approve join'
  });
  return { status: 200, request: database.prepare('SELECT * FROM class_join_requests WHERE id = ?').get(requestId) };
}

export function rejectJoinRequest(database = db, user, classId, requestId, reason = '') {
  if (!teacherOwnsClass(database, user, classId)) return { status: 403, message: '没有管理该班级的权限' };
  const request = database.prepare('SELECT * FROM class_join_requests WHERE id = ? AND class_id = ?').get(requestId, classId);
  if (!request) return { status: 404, message: '入班申请不存在' };
  database.prepare(`
    UPDATE class_join_requests
    SET status = ?, reviewed_at = CURRENT_TIMESTAMP, reviewed_by_user_id = ?, review_reason = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run('rejected', String(user.id || ''), String(reason || ''), requestId);
  ensureAudit(database, {
    operatorId: user.id,
    operatorRole: user.role,
    targetType: 'class',
    targetId: String(classId),
    action: 'class.join.reject',
    before: request,
    after: { ...request, status: 'rejected' },
    reason
  });
  return { status: 200, request: database.prepare('SELECT * FROM class_join_requests WHERE id = ?').get(requestId) };
}

export function listClassMembers(database = db, user, classId) {
  if (!teacherOwnsClass(database, user, classId)) return { status: 403, message: '没有管理该班级的权限', rows: [] };
  const rows = database.prepare(`
    SELECT s.id, s.student_no, u.name, u.username, b.status AS binding_status, b.joined_at, b.left_at
    FROM class_students cs
    JOIN students s ON s.id = cs.student_id
    JOIN users u ON u.id = s.user_id
    LEFT JOIN student_class_bindings b ON b.student_id = s.id AND b.class_id = cs.class_id
    WHERE cs.class_id = ?
    ORDER BY CAST(s.student_no AS INTEGER), s.student_no, u.name
  `).all(classId);
  return { status: 200, rows };
}

export function listStudentMobileClasses(database = db, user) {
  if (!user || user.role !== 'student') return { status: 403, message: '只有学生可以查看班级', rows: [] };
  const student = database.prepare('SELECT id FROM students WHERE user_id = ?').get(user.id);
  if (!student) return { status: 404, message: '学生档案不存在', rows: [] };
  const rows = database.prepare(`
    SELECT c.*, b.join_mode AS binding_join_mode, b.status AS binding_status, b.joined_at,
           t.id AS teacher_id, u.name AS teacher_name
    FROM class_students cs
    JOIN classes c ON c.id = cs.class_id
    JOIN teachers t ON t.id = c.teacher_id
    JOIN users u ON u.id = t.user_id
    LEFT JOIN student_class_bindings b ON b.student_id = cs.student_id AND b.class_id = cs.class_id
    WHERE cs.student_id = ?
    ORDER BY c.updated_at DESC, c.id DESC
  `).all(student.id).map((row) => ({
    id: row.id,
    name: row.name,
    grade: row.grade || '',
    status: row.status || 'active',
    join_mode: row.join_mode || 'approval',
    max_students: Number(row.max_students || 0),
    invite_code: row.invite_code || '',
    invite_code_expires_at: row.invite_code_expires_at || '',
    teacher_name: row.teacher_name || '',
    teacher_id: row.teacher_id || '',
    binding_join_mode: row.binding_join_mode || row.join_mode || 'approval',
    binding_status: row.binding_status || 'active',
    joined_at: row.joined_at || ''
  }));
  return { status: 200, rows };
}

export function listStudentMobileAssignments(database = db, user, classId = null) {
  if (!user || user.role !== 'student') return { status: 403, message: '只有学生可以查看任务', rows: [] };
  const student = database.prepare('SELECT id FROM students WHERE user_id = ?').get(user.id);
  if (!student) return { status: 404, message: '学生档案不存在', rows: [] };
  let rows = database.prepare(`
    SELECT a.*, c.name AS class_name, c.grade AS class_grade
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    JOIN class_students cs ON cs.class_id = c.id
    WHERE cs.student_id = ? AND c.status != 'deleted'
    ORDER BY a.created_at DESC, a.id DESC
  `).all(student.id);
  if (classId) rows = rows.filter((row) => String(row.class_id) === String(classId));
  return {
    status: 200,
    rows: rows.map((row) => ({
      ...row,
      word_count_range: [Number(row.min_words || 0), Number(row.max_words || 0)],
      submitted: false
    }))
  };
}
