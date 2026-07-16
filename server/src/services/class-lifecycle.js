import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { db } from '../db/connection.js';
import { assertAbsoluteHttpUrl, buildPublicUrl } from './public-access.js';
import { listVisibleAssignmentsForStudent } from './assignment-access.js';

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
  const inviteUrl = assertAbsoluteHttpUrl(url, '二维码内容');
  const pythonCandidates = [
    process.env.CODEX_PYTHON,
    '/Users/chenxiansheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3',
    '/Users/chenxiansheng/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python',
    '/usr/bin/python3'
  ].filter(Boolean);
  const script = String.raw`
import sys
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderSVG

url = sys.argv[1]
widget = qr.QrCodeWidget(url)
b = widget.getBounds()
size = 280
side = max(b[2] - b[0], b[3] - b[1]) or 1
scale = size / side
drawing = Drawing(size, size, transform=[scale, 0, 0, scale, 0, 0])
drawing.add(widget)
sys.stdout.write(renderSVG.drawToString(drawing))
`;
  for (const python of pythonCandidates) {
    const result = spawnSync(python, ['-c', script, inviteUrl, String(title || '')], { encoding: 'utf8' });
    if (!result.error && result.status === 0 && result.stdout) {
      return result.stdout.replace(/<\?xml[^>]*>\s*/i, '').replace(/<!DOCTYPE[^>]*>\s*/i, '');
    }
  }
  return '';
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
    data_scope: row.data_scope || 'production',
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
    student_count: database.prepare(`
      SELECT COUNT(*) AS count
      FROM class_students cs
      LEFT JOIN student_class_bindings b ON b.student_id = cs.student_id AND b.class_id = cs.class_id
      WHERE cs.class_id = ? AND COALESCE(b.status, 'active') = 'active'
    `).get(classId).count,
    binding_count: database.prepare('SELECT COUNT(*) AS count FROM student_class_bindings WHERE class_id = ?').get(classId).count,
    assignment_count: database.prepare('SELECT COUNT(*) AS count FROM assignments WHERE class_id = ?').get(classId).count,
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

function activeInvite(database, classId) {
  return database.prepare(`
    SELECT *
    FROM class_invites
    WHERE class_id = ? AND status = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(classId, 'active') || latestInvite(database, classId);
}

function resolveInviteFromJoinInput(database, input = {}) {
  const token = String(input.token || input.inviteToken || '').trim();
  if (token) {
    return database.prepare('SELECT * FROM class_invites WHERE (invite_token = ? OR invite_token_hash = ?) AND status = ?').get(token, hashJoinToken(token), 'active') || null;
  }
  const code = String(input.code || input.inviteCode || '').trim();
  if (code) {
    return database.prepare('SELECT * FROM class_invites WHERE invite_code = ? AND status = ? ORDER BY id DESC LIMIT 1').get(code, 'active') || null;
  }
  return null;
}

function buildJoinPreview(database, invite) {
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
      invite_url: buildPublicUrl(`/student-mobile/join?token=${encodeURIComponent(invite.invite_token)}`)
    }
  };
}

function membershipStatusLabel(status = '') {
  const normalized = String(status || '').trim();
  return normalized || 'active';
}

function attachLifecycle(database, row) {
  if (!row) return null;
  const invite = activeInvite(database, row.id);
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
    invite_url: invite ? buildPublicUrl(`/student-mobile/join?token=${encodeURIComponent(invite.invite_token)}`) : '',
    qr_svg: invite ? buildQrSvg(buildPublicUrl(`/student-mobile/join?token=${encodeURIComponent(invite.invite_token)}`), row.name) : ''
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
  if (filters.scope === 'system_test') rows = rows.filter((row) => String(row.data_scope || '').toLowerCase() === 'system_test');
  else if (filters.scope === 'production') rows = rows.filter((row) => String(row.data_scope || 'production').toLowerCase() === 'production');
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
  const dataScope = String(body.data_scope || body.dataScope || 'production').trim() || 'production';
  const inviteCode = buildInviteCode(grade || 'JOIN');
  const inviteToken = buildClassJoinToken();
  const now = nowIso();

  const result = database.prepare(`
    INSERT INTO classes (name, grade, teacher_id, data_scope, invite_code, join_mode, status, max_students, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, grade, teacherId, dataScope, inviteCode, joinMode, status, maxStudents, now, now);
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
  return {
    status: 200,
    class: {
      ...attachLifecycle(database, klass),
      invite_url: buildPublicUrl(`/student-mobile/join?token=${encodeURIComponent(inviteToken)}`),
      qr_svg: buildQrSvg(buildPublicUrl(`/student-mobile/join?token=${encodeURIComponent(inviteToken)}`), klass.name || name)
    },
    inviteToken
  };
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
  return {
    status: 200,
    class: {
      ...attachLifecycle(database, updated),
      invite_url: buildPublicUrl(`/student-mobile/join?token=${encodeURIComponent(inviteToken)}`),
      qr_svg: buildQrSvg(buildPublicUrl(`/student-mobile/join?token=${encodeURIComponent(inviteToken)}`), updated.name || klass.name || '班级邀请')
    },
    inviteToken
  };
}

export function getJoinPreview(database = db, token = '') {
  const invite = database.prepare('SELECT * FROM class_invites WHERE (invite_token = ? OR invite_token_hash = ?) AND status = ?').get(token, hashJoinToken(token), 'active');
  return buildJoinPreview(database, invite);
}

export function getJoinPreviewByCode(database = db, code = '') {
  const invite = database.prepare('SELECT * FROM class_invites WHERE invite_code = ? AND status = ? ORDER BY id DESC LIMIT 1').get(String(code || '').trim(), 'active');
  return buildJoinPreview(database, invite);
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

export function buildStudentLoginUsername(database, studentNo, studentName) {
  const normalizedStudentNo = String(studentNo || '').trim();
  if (normalizedStudentNo) {
    const existing = database.prepare('SELECT id, role FROM users WHERE username = ?').get(normalizedStudentNo);
    if (!existing || existing.role === 'student') return normalizedStudentNo;
  }
  const baseRaw = studentName || normalizedStudentNo || `student_${Date.now()}`;
  const base = `student_${String(baseRaw).replace(/[^a-zA-Z0-9]/g, '').slice(0, 18) || Date.now()}`;
  let username = base;
  let index = 1;
  while (database.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    username = `${base}${index++}`;
  }
  return username;
}

function createStudentIdentity(database, klass, payload = {}) {
  const studentName = String(payload.studentName || payload.student_name || payload.name || '').trim();
  if (!studentName) return null;
  const studentNo = String(payload.studentNo || payload.student_no || '').trim();
  const existing = findStudentByIdentity(database, payload);
  if (existing) return existing;
  const username = buildStudentLoginUsername(database, studentNo, studentName);
  const password = '123456';
  const addUser = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
  const addStudent = database.prepare('INSERT INTO students (user_id, student_no, grade, school, data_scope) VALUES (?, ?, ?, ?, ?)');
  const userId = addUser.run(username, password, 'student', studentName).lastInsertRowid;
  const studentId = addStudent.run(
    userId,
    studentNo || null,
    String(payload.grade || klass?.grade || ''),
    String(payload.school || klass?.school || ''),
    String(payload.dataScope || klass?.data_scope || klass?.dataScope || 'production')
  ).lastInsertRowid;
  return database.prepare(`
    SELECT s.*, u.name AS user_name
    FROM students s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `).get(studentId);
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

function upsertJoinRequest(database, input, invite, student, studentName, status) {
  const studentNo = String(input.studentNo || input.student_no || student?.student_no || '').trim();
  const existing = database.prepare(`
    SELECT id
    FROM class_join_requests
    WHERE class_id = ?
      AND status = 'pending'
      AND (
        (student_id IS NOT NULL AND student_id = ?)
        OR (student_id IS NULL AND student_name = ? AND student_no = ?)
      )
    ORDER BY id DESC
    LIMIT 1
  `).get(invite.class_id, student?.id || -1, studentName, studentNo);
  if (existing) return { status: 409, message: '该申请正在等待处理' };

  const requestId = database.prepare(`
    INSERT INTO class_join_requests (
      class_id, student_id, student_name, student_no, source, status, invite_id, metadata, requested_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    invite.class_id,
    student?.id || null,
    studentName,
    studentNo,
    String(input.source || 'student-mobile'),
    status,
    invite.id,
    toJson({
      userAgent: String(input.userAgent || ''),
      referrer: String(input.referrer || ''),
      inviteCode: String(invite?.invite_code || ''),
      studentMatched: Boolean(student)
    })
  ).lastInsertRowid;

  return { status: 200, requestId };
}

export function createJoinRequest(database = db, input = {}) {
  const invite = resolveInviteFromJoinInput(database, input);
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
  if (student) {
    const existingBinding = database.prepare('SELECT status FROM student_class_bindings WHERE class_id = ? AND student_id = ?').get(klass.id, student.id);
    if (existingBinding?.status === 'active') {
      return { status: 409, message: '该学生已经在这个班级中' };
    }
    if (existingBinding && existingBinding.status !== 'active') {
      return { status: 409, message: '该学生已被移出或停用，请联系教师处理' };
    }
  }

  const requestStatus = klass.join_mode === 'open' && student ? 'approved' : 'pending';
  const inserted = upsertJoinRequest(database, input, invite, student, studentName, requestStatus);
  if (inserted.status !== 200) return inserted;
  const requestId = inserted.requestId;

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

export function createJoinRequestByCode(database = db, input = {}) {
  return createJoinRequest(database, { ...input, code: input.code || input.inviteCode || '' });
}

export function listJoinRequests(database = db, user, classId) {
  if (!teacherOwnsClass(database, user, classId)) return { status: 403, message: '没有管理该班级的权限', rows: [] };
  return {
    status: 200,
    rows: database.prepare(`
      SELECT r.*, c.name AS class_name, c.grade AS class_grade, i.invite_code, i.join_mode AS invite_join_mode,
             s.id AS linked_student_id, u.name AS linked_student_name, s.student_no AS linked_student_no,
             COALESCE(b.status, '') AS membership_status
      FROM class_join_requests r
      LEFT JOIN classes c ON c.id = r.class_id
      LEFT JOIN class_invites i ON i.id = r.invite_id
      LEFT JOIN students s ON s.id = r.student_id
      LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN student_class_bindings b ON b.student_id = r.student_id AND b.class_id = r.class_id
      WHERE r.class_id = ?
      ORDER BY r.requested_at DESC, r.id DESC
    `).all(classId)
  };
}

export function listTeacherJoinRequests(database = db, user, filters = {}) {
  const teacherId = getTeacherId(database, user);
  if (!teacherId) return { status: 403, message: '没有管理班级的权限', rows: [] };

  const classId = String(filters.classId || '').trim();
  const status = String(filters.status || 'pending').trim().toLowerCase();
  if (classId) {
    if (!teacherOwnsClass(database, user, classId)) return { status: 403, message: '没有管理该班级的权限', rows: [] };
    return listJoinRequests(database, user, classId);
  }

  const conditions = ['c.teacher_id = ?'];
  const params = [teacherId];
  if (status && status !== 'all') {
    conditions.push('LOWER(COALESCE(r.status, \'\')) = ?');
    params.push(status);
  }

  return {
    status: 200,
    rows: database.prepare(`
      SELECT r.*, c.name AS class_name, c.grade AS class_grade, c.teacher_id, c.data_scope AS class_data_scope,
             i.invite_code, i.join_mode AS invite_join_mode,
             s.id AS linked_student_id, u.name AS linked_student_name, s.student_no AS linked_student_no,
             COALESCE(b.status, '') AS membership_status
      FROM class_join_requests r
      JOIN classes c ON c.id = r.class_id
      LEFT JOIN class_invites i ON i.id = r.invite_id
      LEFT JOIN students s ON s.id = r.student_id
      LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN student_class_bindings b ON b.student_id = r.student_id AND b.class_id = r.class_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.requested_at DESC, r.id DESC
    `).all(...params)
  };
}

export function approveJoinRequest(database = db, user, classId, requestId) {
  if (!teacherOwnsClass(database, user, classId)) return { status: 403, message: '没有管理该班级的权限' };
  const request = database.prepare('SELECT * FROM class_join_requests WHERE id = ? AND class_id = ?').get(requestId, classId);
  if (!request) return { status: 404, message: '入班申请不存在' };
  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!klass) return { status: 404, message: '班级不存在' };
  const student = request.student_id
    ? database.prepare('SELECT * FROM students WHERE id = ?').get(request.student_id)
    : createStudentIdentity(database, klass, {
        studentName: request.student_name,
        studentNo: request.student_no,
        dataScope: klass.data_scope || 'production'
      });
  if (!student) return { status: 404, message: '学生档案不存在' };
  if (!request.student_id) {
    database.prepare('UPDATE class_join_requests SET student_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(student.id, requestId);
  }
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
    SELECT s.id, s.student_no, u.name, u.username,
           COALESCE(b.status, 'active') AS binding_status,
           b.join_mode AS binding_join_mode,
           b.joined_at,
           b.left_at,
           CASE WHEN COALESCE(b.status, 'active') = 'active' THEN 1 ELSE 0 END AS is_active,
           COALESCE((
             SELECT COUNT(*)
             FROM essays e
             JOIN assignments a ON a.id = e.assignment_id
             WHERE e.student_id = s.id AND a.class_id = cs.class_id
           ), 0) AS essay_count,
           (
             SELECT e2.id
             FROM essays e2
             JOIN assignments a2 ON a2.id = e2.assignment_id
             WHERE e2.student_id = s.id AND a2.class_id = cs.class_id
             ORDER BY COALESCE(e2.submitted_at, e2.created_at) DESC, e2.id DESC
             LIMIT 1
           ) AS latest_essay_id,
           (
             SELECT e2.report_id
             FROM essays e2
             JOIN assignments a2 ON a2.id = e2.assignment_id
             WHERE e2.student_id = s.id AND a2.class_id = cs.class_id
             ORDER BY COALESCE(e2.submitted_at, e2.created_at) DESC, e2.id DESC
             LIMIT 1
           ) AS latest_report_id,
           (
             SELECT e2.grading_status
             FROM essays e2
             JOIN assignments a2 ON a2.id = e2.assignment_id
             WHERE e2.student_id = s.id AND a2.class_id = cs.class_id
             ORDER BY COALESCE(e2.submitted_at, e2.created_at) DESC, e2.id DESC
             LIMIT 1
           ) AS latest_grading_status,
           (
             SELECT COALESCE(e2.submitted_at, e2.created_at)
             FROM essays e2
             JOIN assignments a2 ON a2.id = e2.assignment_id
             WHERE e2.student_id = s.id AND a2.class_id = cs.class_id
             ORDER BY COALESCE(e2.submitted_at, e2.created_at) DESC, e2.id DESC
             LIMIT 1
           ) AS latest_submitted_at
    FROM class_students cs
    JOIN students s ON s.id = cs.student_id
    JOIN users u ON u.id = s.user_id
    LEFT JOIN student_class_bindings b ON b.student_id = s.id AND b.class_id = cs.class_id
    WHERE cs.class_id = ?
    ORDER BY CAST(s.student_no AS INTEGER), s.student_no, u.name
  `).all(classId);
  return { status: 200, rows };
}

export function deleteLifecycleClassCascade(database = db, user, classId, input = {}) {
  if (!teacherOwnsClass(database, user, classId)) return { status: 403, message: '没有管理该班级的权限' };
  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!klass) return { status: 404, message: '班级不存在' };
  const confirmName = String(input.confirmName || input.confirm_name || '').trim();
  if (confirmName && confirmName !== String(klass.name || '').trim()) {
    return { status: 400, message: '班级名称确认不匹配' };
  }
  const cascade = Boolean(input.cascade || input.cascadeDelete || input.forceDelete);
  if (!cascade) {
    const studentCount = database.prepare('SELECT COUNT(*) AS count FROM class_students WHERE class_id = ?').get(classId).count;
    const assignmentCount = database.prepare('SELECT COUNT(*) AS count FROM assignments WHERE class_id = ?').get(classId).count;
    if (studentCount > 0 || assignmentCount > 0) {
      return { status: 409, message: '请先删除学生名单和作文任务后再删除班级' };
    }
    database.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    return { status: 200, class: klass, cascade: false, deletedStudents: 0, deletedUsers: 0 };
  }

  const members = database.prepare(`
    SELECT DISTINCT s.id AS student_id, s.user_id, s.student_no, u.username, u.name
    FROM class_students cs
    JOIN students s ON s.id = cs.student_id
    JOIN users u ON u.id = s.user_id
    WHERE cs.class_id = ?
  `).all(classId);
  const deletableUsers = [];
  for (const student of members) {
    const otherClassCount = database.prepare(`
      SELECT COUNT(*) AS count
      FROM class_students
      WHERE student_id = ? AND class_id != ?
    `).get(student.student_id, classId).count;
    const otherEssayCount = database.prepare(`
      SELECT COUNT(*) AS count
      FROM essays e
      JOIN assignments a ON a.id = e.assignment_id
      WHERE e.student_id = ? AND a.class_id != ?
    `).get(student.student_id, classId).count;
    if (Number(otherClassCount || 0) === 0 && Number(otherEssayCount || 0) === 0) {
      deletableUsers.push(student.user_id);
    }
  }

  const before = {
    class: klass,
    members,
    deletableUsers
  };

  database.exec('BEGIN IMMEDIATE');
  try {
    database.prepare('DELETE FROM classes WHERE id = ?').run(classId);
    for (const userId of deletableUsers) {
      database.prepare('DELETE FROM users WHERE id = ?').run(userId);
    }
    ensureAudit(database, {
      operatorId: user.id,
      operatorRole: user.role,
      targetType: 'class',
      targetId: String(classId),
      action: 'class.delete.cascade',
      before,
      after: {
        classId: Number(classId),
        deletedUsers: deletableUsers.length,
        removedMembers: members.length
      },
      reason: String(input.reason || 'teacher delete class cascade')
    });
    database.exec('COMMIT');
    return {
      status: 200,
      class: klass,
      cascade: true,
      deletedStudents: members.length,
      deletedUsers: deletableUsers.length
    };
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch {}
    return { status: 500, message: error?.message || '删除班级失败' };
  }
}

export function getJoinRequestStatus(database = db, user, requestId) {
  if (!user || user.role !== 'student') return { status: 403, message: '只有学生可以查看申请状态' };
  const student = database.prepare('SELECT id, user_id FROM students WHERE user_id = ?').get(user.id);
  if (!student) return { status: 404, message: '学生档案不存在' };
  const request = database.prepare(`
    SELECT r.*, c.name AS class_name, c.grade AS class_grade, c.status AS class_status,
           i.invite_code, i.join_mode AS invite_join_mode, i.expires_at AS invite_expires_at
    FROM class_join_requests r
    JOIN classes c ON c.id = r.class_id
    LEFT JOIN class_invites i ON i.id = r.invite_id
    WHERE r.id = ?
  `).get(requestId);
  if (!request) return { status: 404, message: '入班申请不存在' };
  if (request.student_id && Number(request.student_id) !== Number(student.id)) {
    return { status: 403, message: '没有查看该申请的权限' };
  }
  return { status: 200, request };
}

export function updateClassMemberStatus(database = db, user, classId, studentId, status, input = {}) {
  if (!teacherOwnsClass(database, user, classId)) return { status: 403, message: '没有管理该班级的权限' };
  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!klass) return { status: 404, message: '班级不存在' };
  const student = database.prepare(`
    SELECT s.id, s.student_no, u.name, u.username, s.user_id
    FROM class_students cs
    JOIN students s ON s.id = cs.student_id
    JOIN users u ON u.id = s.user_id
    WHERE cs.class_id = ? AND s.id = ?
  `).get(classId, studentId);
  if (!student) return { status: 404, message: '学生不在当前班级中' };

  const before = database.prepare('SELECT * FROM student_class_bindings WHERE class_id = ? AND student_id = ?').get(classId, studentId) || {
    class_id: Number(classId),
    student_id: Number(studentId),
    status: 'active'
  };
  const nextStatus = membershipStatusLabel(status);
  database.prepare(`
    INSERT INTO student_class_bindings (student_id, class_id, join_mode, status, joined_at, left_at, updated_at)
    VALUES (?, ?, ?, ?, COALESCE((SELECT joined_at FROM student_class_bindings WHERE class_id = ? AND student_id = ?), CURRENT_TIMESTAMP),
            CASE WHEN ? = 'active' THEN NULL ELSE CURRENT_TIMESTAMP END, CURRENT_TIMESTAMP)
    ON CONFLICT(student_id, class_id) DO UPDATE SET
      join_mode = excluded.join_mode,
      status = excluded.status,
      left_at = excluded.left_at,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    studentId,
    classId,
    String(input.joinMode || before.join_mode || klass.join_mode || 'approval'),
    nextStatus,
    classId,
    studentId,
    nextStatus
  );

  const after = database.prepare('SELECT * FROM student_class_bindings WHERE class_id = ? AND student_id = ?').get(classId, studentId);
  ensureAudit(database, {
    operatorId: user.id,
    operatorRole: user.role,
    targetType: 'membership',
    targetId: `${classId}:${studentId}`,
    action: `membership.${nextStatus}`,
    before,
    after,
    reason: String(input.reason || '')
  });

  return {
    status: 200,
    member: database.prepare(`
      SELECT s.id, s.student_no, u.name, u.username,
             COALESCE(b.status, 'active') AS binding_status,
             b.joined_at, b.left_at, b.join_mode
      FROM students s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN student_class_bindings b ON b.student_id = s.id AND b.class_id = ?
      WHERE s.id = ?
    `).get(classId, studentId)
  };
}

export function removeClassMember(database = db, user, classId, studentId, reason = '') {
  return updateClassMemberStatus(database, user, classId, studentId, 'removed', { reason });
}

export function pauseClassMember(database = db, user, classId, studentId, reason = '') {
  return updateClassMemberStatus(database, user, classId, studentId, 'paused', { reason });
}

export function restoreClassMember(database = db, user, classId, studentId, reason = '') {
  return updateClassMemberStatus(database, user, classId, studentId, 'active', { reason });
}

export function transferClassMember(database = db, user, classId, studentId, targetClassId, input = {}) {
  if (!teacherOwnsClass(database, user, classId)) return { status: 403, message: '没有管理该班级的权限' };
  if (!teacherOwnsClass(database, user, targetClassId)) return { status: 403, message: '没有管理目标班级的权限' };
  const source = database.prepare(`
    SELECT s.id, s.student_no, u.name, u.username, b.status AS binding_status, b.join_mode
    FROM class_students cs
    JOIN students s ON s.id = cs.student_id
    JOIN users u ON u.id = s.user_id
    LEFT JOIN student_class_bindings b ON b.student_id = s.id AND b.class_id = cs.class_id
    WHERE cs.class_id = ? AND s.id = ?
  `).get(classId, studentId);
  if (!source) return { status: 404, message: '学生不在当前班级中' };
  const keepSource = Boolean(input.keepSourceMembership);
  const reason = String(input.reason || '');
  const before = database.prepare('SELECT * FROM student_class_bindings WHERE class_id = ? AND student_id = ?').get(classId, studentId) || {};
  if (!keepSource) {
    database.prepare(`
      INSERT INTO student_class_bindings (student_id, class_id, join_mode, status, joined_at, left_at, updated_at)
      VALUES (?, ?, ?, 'transferred', COALESCE((SELECT joined_at FROM student_class_bindings WHERE class_id = ? AND student_id = ?), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(student_id, class_id) DO UPDATE SET
        join_mode = excluded.join_mode,
        status = 'transferred',
        left_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `).run(studentId, classId, String(input.joinMode || before.join_mode || 'approval'), classId, studentId);
  }
  addMembership(database, studentId, targetClassId, String(input.joinMode || before.join_mode || 'approval'));
  ensureAudit(database, {
    operatorId: user.id,
    operatorRole: user.role,
    targetType: 'membership',
    targetId: `${classId}:${studentId}`,
    action: 'membership.transfer',
    before,
    after: {
      sourceClassId: Number(classId),
      targetClassId: Number(targetClassId),
      keepSourceMembership: keepSource
    },
    reason
  });
  return {
    status: 200,
    source: database.prepare('SELECT * FROM student_class_bindings WHERE class_id = ? AND student_id = ?').get(classId, studentId),
    target: database.prepare('SELECT * FROM student_class_bindings WHERE class_id = ? AND student_id = ?').get(targetClassId, studentId)
  };
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
      AND COALESCE(b.status, 'active') = 'active'
      AND c.status != 'deleted'
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
  return listVisibleAssignmentsForStudent(database, student.id, { classId });
}
