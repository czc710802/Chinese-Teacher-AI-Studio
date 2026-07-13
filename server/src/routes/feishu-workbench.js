import { Router } from 'express';

import { db } from '../db/connection.js';
import { requireUser, roleGuard } from '../middleware/auth.js';
import { sendTextMessage } from '../integrations/feishu/client.js';
import {
  bindClassToFeishuGroup,
  createTeacherBindingCode,
  getFeishuPermissionStatus,
  listTeacherBindings,
  listTeacherFeishuClasses,
  recordFeishuAction,
  updateClassBindingTestResult,
  updateTeacherBindingStatus
} from '../services/feishu-workbench.js';

function requestId(req, fallback = '') {
  return String(req.header('x-request-id') || req.body?.requestId || fallback || '').trim();
}

function safeBinding(row = {}) {
  if (!row) return row;
  return {
    ...row,
    feishu_open_id: row.feishu_open_id ? `${String(row.feishu_open_id).slice(0, 5)}***` : '',
    feishu_union_id: row.feishu_union_id ? `${String(row.feishu_union_id).slice(0, 5)}***` : '',
    feishu_chat_id: row.feishu_chat_id ? `${String(row.feishu_chat_id).slice(0, 5)}***` : row.feishu_chat_id
  };
}

export const adminFeishuRouter = Router();
adminFeishuRouter.use(requireUser, roleGuard('admin'));

adminFeishuRouter.get('/teachers', (req, res) => {
  const teachers = listTeacherBindings(db, { keyword: req.query.keyword }).map(safeBinding);
  const logs = db.prepare(`
    SELECT id, actor_type, actor_id, action, resource_type, resource_id, request_id, status, error_code, created_at
    FROM feishu_action_logs
    ORDER BY created_at DESC, id DESC
    LIMIT 30
  `).all();
  res.json({ teachers, logs });
});

adminFeishuRouter.post('/teachers/:teacherId/binding-code', (req, res) => {
  const result = createTeacherBindingCode(db, {
    teacherId: req.params.teacherId,
    createdBy: String(req.user.id),
    ttlSeconds: Number(req.body?.ttlSeconds || 900)
  });
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result);
});

adminFeishuRouter.post('/teacher-bindings/:bindingId/disable', (req, res) => {
  const result = updateTeacherBindingStatus(db, {
    bindingId: req.params.bindingId,
    status: 'disabled',
    actorId: String(req.user.id),
    requestId: requestId(req, `teacher-binding-disable:${req.params.bindingId}`)
  });
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json({ ok: true, binding: safeBinding(result.binding) });
});

adminFeishuRouter.post('/teacher-bindings/:bindingId/restore', (req, res) => {
  const result = updateTeacherBindingStatus(db, {
    bindingId: req.params.bindingId,
    status: 'active',
    actorId: String(req.user.id),
    requestId: requestId(req, `teacher-binding-restore:${req.params.bindingId}`)
  });
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json({ ok: true, binding: safeBinding(result.binding) });
});

adminFeishuRouter.post('/teacher-bindings/:bindingId/unbind', (req, res) => {
  const result = updateTeacherBindingStatus(db, {
    bindingId: req.params.bindingId,
    status: 'unbound',
    actorId: String(req.user.id),
    requestId: requestId(req, `teacher-binding-unbind:${req.params.bindingId}`)
  });
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json({ ok: true, binding: safeBinding(result.binding) });
});

export const teacherFeishuRouter = Router();
teacherFeishuRouter.use(requireUser, roleGuard('teacher', 'admin'));

teacherFeishuRouter.get('/classes', (req, res) => {
  const result = listTeacherFeishuClasses(db, req.user);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json({
    teacher: { id: result.teacher.id, name: result.teacher.teacher_name },
    rows: result.rows.map((row) => ({
      ...row,
      feishu_chat_id_masked: row.feishu_chat_id ? `${String(row.feishu_chat_id).slice(0, 5)}***` : ''
    })),
    permissions: getFeishuPermissionStatus()
  });
});

teacherFeishuRouter.get('/groups', (_req, res) => {
  res.json(getFeishuPermissionStatus());
});

teacherFeishuRouter.post('/classes/:classId/bind', (req, res) => {
  const result = bindClassToFeishuGroup(db, {
    user: req.user,
    classId: req.params.classId,
    feishuChatId: req.body?.feishuChatId,
    feishuChatName: req.body?.feishuChatName,
    tenantKey: req.body?.tenantKey || '',
    isPrimary: req.body?.isPrimary !== false,
    requestId: requestId(req, `class-bind:${req.params.classId}:${req.body?.feishuChatId || ''}`)
  });
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json({ ok: true, idempotent: Boolean(result.idempotent), binding: safeBinding(result.binding) });
});

teacherFeishuRouter.post('/classes/:classId/unbind', (req, res) => {
  const bindingId = Number(req.body?.bindingId || 0);
  const row = db.prepare(`
    SELECT b.*, c.teacher_id
    FROM feishu_class_bindings b
    JOIN classes c ON c.id = b.class_id
    JOIN teachers t ON t.id = c.teacher_id
    WHERE b.id = ? AND c.id = ? AND t.user_id = ?
  `).get(bindingId, Number(req.params.classId), Number(req.user.id));
  if (!row) return res.status(404).json({ message: '班级群绑定不存在或无权限' });
  db.prepare("UPDATE feishu_class_bindings SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(bindingId);
  recordFeishuAction(db, {
    actorType: 'teacher',
    actorId: String(row.teacher_id),
    action: 'class_group_unbind',
    resourceType: 'class_binding',
    resourceId: String(bindingId),
    requestId: requestId(req, `class-unbind:${bindingId}`),
    status: 'success'
  });
  res.json({ ok: true });
});

teacherFeishuRouter.post('/classes/:classId/test-message', async (req, res) => {
  const bindingId = Number(req.body?.bindingId || 0);
  const row = db.prepare(`
    SELECT b.*, c.teacher_id
    FROM feishu_class_bindings b
    JOIN classes c ON c.id = b.class_id
    JOIN teachers t ON t.id = c.teacher_id
    WHERE b.id = ? AND c.id = ? AND t.user_id = ? AND b.status = 'active'
  `).get(bindingId, Number(req.params.classId), Number(req.user.id));
  if (!row) return res.status(404).json({ message: '班级群绑定不存在或无权限' });
  try {
    const sendResult = await sendTextMessage({
      env: req.app.locals.env || process.env,
      receiveId: row.feishu_chat_id,
      receiveIdType: 'chat_id',
      text: '【系统测试】Chinese Teacher AI Studio 班级群绑定测试消息，不包含学生作文或敏感数据。'
    });
    updateClassBindingTestResult(db, {
      bindingId,
      ok: Boolean(sendResult?.ok),
      errorCode: sendResult?.ok ? '' : (sendResult?.reason || 'FEISHU_SEND_FAILED'),
      actorId: String(row.teacher_id),
      requestId: requestId(req, `class-test:${bindingId}`)
    });
    res.json({ ok: Boolean(sendResult?.ok), result: sendResult?.ok ? 'sent' : 'skipped', reason: sendResult?.reason || '' });
  } catch (error) {
    updateClassBindingTestResult(db, {
      bindingId,
      ok: false,
      errorCode: error?.status ? `HTTP_${error.status}` : 'FEISHU_SEND_FAILED',
      actorId: String(row.teacher_id),
      requestId: requestId(req, `class-test:${bindingId}`)
    });
    res.status(502).json({ message: '飞书测试消息发送失败', errorCode: error?.status ? `HTTP_${error.status}` : 'FEISHU_SEND_FAILED' });
  }
});
