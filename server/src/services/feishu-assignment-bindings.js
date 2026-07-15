import { buildFeishuBusinessMigrationNotice, isFeishuBusinessEnabled } from '../integrations/feishu/config.js';

function getTeacher(database, user) {
  return database.prepare('SELECT id FROM teachers WHERE user_id = ?').get(user.id);
}

function ensureManagedClass(database, user, classId) {
  const teacher = getTeacher(database, user);
  if (!teacher) return { status: 403, message: '没有管理班级的权限' };
  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(Number(classId));
  if (!klass) return { status: 404, message: '班级不存在' };
  if (Number(klass.teacher_id) !== Number(teacher.id)) return { status: 403, message: '没有管理该班级的权限' };
  return { status: 200, teacher, klass };
}

function getStudentInClass(database, studentId, classId) {
  return database.prepare(`
    SELECT s.id AS student_id, s.student_no, u.name AS student_name
    FROM class_students cs
    JOIN students s ON s.id = cs.student_id
    JOIN users u ON u.id = s.user_id
    WHERE cs.student_id = ? AND cs.class_id = ?
  `).get(Number(studentId), Number(classId));
}

export function bindFeishuClass(database, user, body = {}) {
  const classId = Number(body.classId || body.class_id);
  const managed = ensureManagedClass(database, user, classId);
  if (managed.status !== 200) return managed;

  const feishuChatId = String(body.feishuChatId || body.feishu_chat_id || '').trim();
  const feishuChatName = String(body.feishuChatName || body.feishu_chat_name || '').trim();
  if (!feishuChatId) return { status: 400, message: '请填写飞书群 chatId' };

  const isPrimary = body.isPrimary === false || body.is_primary === 0 ? 0 : 1;
  if (isPrimary) {
    database.prepare('UPDATE feishu_class_bindings SET is_primary = 0, updated_at = CURRENT_TIMESTAMP WHERE class_id = ?')
      .run(classId);
  }

  database.prepare(`
    INSERT INTO feishu_class_bindings
      (teacher_id, class_id, feishu_chat_id, feishu_chat_name, status, is_primary, updated_at)
    VALUES (?, ?, ?, ?, 'active', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(class_id, feishu_chat_id) DO UPDATE SET
      teacher_id = excluded.teacher_id,
      feishu_chat_name = excluded.feishu_chat_name,
      status = 'active',
      is_primary = excluded.is_primary,
      updated_at = CURRENT_TIMESTAMP
  `).run(managed.teacher.id, classId, feishuChatId, feishuChatName, isPrimary);

  return {
    status: 200,
    binding: database.prepare(`
      SELECT * FROM feishu_class_bindings
      WHERE class_id = ? AND feishu_chat_id = ?
    `).get(classId, feishuChatId)
  };
}

export function listFeishuClassBindings(database, user, { classId } = {}) {
  const managed = ensureManagedClass(database, user, classId);
  if (managed.status !== 200) return { ...managed, rows: [] };
  const rows = database.prepare(`
    SELECT * FROM feishu_class_bindings
    WHERE class_id = ? AND status = 'active'
    ORDER BY is_primary DESC, updated_at DESC, id DESC
  `).all(Number(classId));
  return { status: 200, rows };
}

export function getPrimaryFeishuClassBinding(database, classId) {
  return database.prepare(`
    SELECT * FROM feishu_class_bindings
    WHERE class_id = ? AND status = 'active'
    ORDER BY is_primary DESC, updated_at DESC, id DESC
    LIMIT 1
  `).get(Number(classId));
}

export function bindFeishuStudent(database, user, body = {}) {
  const classId = Number(body.classId || body.class_id);
  const studentId = Number(body.studentId || body.student_id);
  const managed = ensureManagedClass(database, user, classId);
  if (managed.status !== 200) return managed;
  const student = getStudentInClass(database, studentId, classId);
  if (!student) return { status: 404, message: '学生不在该班级中' };

  const feishuOpenId = String(body.feishuOpenId || body.feishu_open_id || '').trim();
  const feishuUnionId = String(body.feishuUnionId || body.feishu_union_id || '').trim();
  if (!feishuOpenId) return { status: 400, message: '请填写飞书 openId' };

  database.prepare(`
    INSERT INTO feishu_student_bindings
      (student_id, class_id, feishu_open_id, feishu_union_id, verified_at, status, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'active', CURRENT_TIMESTAMP)
    ON CONFLICT(student_id, class_id) DO UPDATE SET
      feishu_open_id = excluded.feishu_open_id,
      feishu_union_id = excluded.feishu_union_id,
      verified_at = CURRENT_TIMESTAMP,
      status = 'active',
      updated_at = CURRENT_TIMESTAMP
  `).run(studentId, classId, feishuOpenId, feishuUnionId);

  return {
    status: 200,
    binding: database.prepare(`
      SELECT * FROM feishu_student_bindings
      WHERE student_id = ? AND class_id = ?
    `).get(studentId, classId)
  };
}

export function getActiveStudentBinding(database, studentId, classId) {
  return database.prepare(`
    SELECT * FROM feishu_student_bindings
    WHERE student_id = ? AND class_id = ? AND status = 'active'
  `).get(Number(studentId), Number(classId));
}

export function recordFeishuAssignmentMessage(database, {
  assignmentId,
  classId,
  feishuChatId,
  messageId = '',
  messageType = 'assignment_publish',
  status = 'sent',
  idempotencyKey
}) {
  database.prepare(`
    INSERT INTO feishu_assignment_messages
      (assignment_id, class_id, feishu_chat_id, message_id, message_type, status, idempotency_key, sent_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(idempotency_key) DO UPDATE SET
      message_id = COALESCE(NULLIF(excluded.message_id, ''), feishu_assignment_messages.message_id),
      status = excluded.status,
      updated_at = CURRENT_TIMESTAMP
  `).run(assignmentId, classId, feishuChatId, messageId, messageType, status, idempotencyKey);

  return database.prepare('SELECT * FROM feishu_assignment_messages WHERE idempotency_key = ?').get(idempotencyKey);
}

export function markAssignmentMessageRevoked(database, user, assignmentId) {
  const assignment = database.prepare(`
    SELECT a.*, c.teacher_id
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    WHERE a.id = ? OR a.public_id = ?
  `).get(Number(assignmentId) || -1, String(assignmentId || ''));
  if (!assignment) return { status: 404, message: '作文作业不存在' };
  const teacher = getTeacher(database, user);
  if (Number(teacher?.id || 0) !== Number(assignment.teacher_id)) return { status: 403, message: '没有管理该作业的权限' };
  const changes = database.prepare(`
    UPDATE feishu_assignment_messages
    SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE assignment_id = ? AND message_type = 'assignment_publish' AND status = 'sent'
  `).run(assignment.id).changes;
  return { status: 200, revoked: changes, message: changes ? '已标记撤回，请在飞书侧同步撤回原消息' : '没有可撤回的飞书发布记录' };
}

export async function remindMissingStudents({ database, user, assignmentId, feishuService, options = {} }) {
  const { getAssignmentSubmissionStatus, buildAssignmentReminderCard } = await import('./assignment-access.js');
  const status = getAssignmentSubmissionStatus(database, user, assignmentId, options);
  if (status.status !== 200) return status;
  if (!isFeishuBusinessEnabled(options.env || process.env)) {
    return {
      status: 200,
      sent: 0,
      skipped: status.missing.length,
      paused: true,
      message: buildFeishuBusinessMigrationNotice(options.env || process.env),
      assignment: status.assignment
    };
  }
  if (!Number(status.assignment.reminder_enabled ?? 1)) return { status: 200, sent: 0, skipped: status.missing.length, message: '该作业已关闭自动提醒' };
  const card = buildAssignmentReminderCard(status.assignment);
  let sent = 0;
  let skipped = 0;
  for (const student of status.missing) {
    const binding = getActiveStudentBinding(database, student.student_id, status.assignment.class_id);
    if (!binding?.feishu_open_id || !feishuService?.sendCard) {
      skipped += 1;
      continue;
    }
    const idempotencyKey = `assignment:${status.assignment.id}:missing-reminder:${student.student_id}`;
    const existing = database.prepare('SELECT id FROM feishu_assignment_messages WHERE idempotency_key = ?').get(idempotencyKey);
    if (existing) {
      skipped += 1;
      continue;
    }
    const result = await feishuService.sendCard(binding.feishu_open_id, card);
    recordFeishuAssignmentMessage(database, {
      assignmentId: status.assignment.id,
      classId: status.assignment.class_id,
      feishuChatId: binding.feishu_open_id,
      messageId: result?.message_id || result?.data?.message_id || '',
      messageType: 'missing_reminder',
      status: 'sent',
      idempotencyKey
    });
    sent += 1;
  }
  return { status: 200, sent, skipped, assignment: status.assignment };
}
