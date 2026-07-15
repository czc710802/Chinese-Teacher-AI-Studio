import { Router } from 'express';
import { db } from '../db/connection.js';
import { requireUser, roleGuard } from '../middleware/auth.js';
import { deleteManagedEmptyClass, getClassRosterForUser, renameStudentForManagedClass } from '../services/class-access.js';
import { bindFeishuClass, bindFeishuStudent, listFeishuClassBindings } from '../services/feishu-assignment-bindings.js';
import {
  approveJoinRequest,
  archiveLifecycleClass,
  buildQrSvg,
  createLifecycleClass,
  listClassMembers,
  listJoinRequests,
  listLifecycleClasses,
  pauseClassMember,
  rejectJoinRequest,
  restoreLifecycleClass,
  restoreClassMember,
  rotateClassInvite,
  removeClassMember,
  transferClassMember,
  updateLifecycleClass
} from '../services/class-lifecycle.js';
import {
  archiveClass,
  getClass,
  getClassStatistics,
  importStudents,
  listTeacherEssays,
  listStudents as listManagedStudents,
  restoreClass,
  updateClass
} from '../services/teacher-management/teacher-management-service.js';

export const classRouter = Router();
classRouter.use(requireUser);

function getManagedClass(req, classId) {
  const klass = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!klass) return null;
  const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(req.user.id);
  return teacher?.id === klass.teacher_id ? klass : null;
}

classRouter.get('/', (req, res) => {
  if (req.user.role === 'student') {
    const rows = db.prepare(`
      SELECT c.* FROM classes c
      JOIN class_students cs ON cs.class_id = c.id
      JOIN students s ON s.id = cs.student_id
      WHERE s.user_id = ?
    `).all(req.user.id);
    return res.json(rows);
  }
  const result = listLifecycleClasses(db, req.user, req.query);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.rows);
});

classRouter.post('/', roleGuard('teacher'), (req, res) => {
  const result = createLifecycleClass(db, req.user, req.body);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.class);
});

classRouter.get('/import-template', (_req, res) => {
  res.type('text/csv').send('studentId,studentName,gender,className,grade,schoolYear\n20260301,学生姓名,男,3班,高二,2026\n');
});

classRouter.get('/:id/feishu-binding', roleGuard('teacher'), (req, res) => {
  const result = listFeishuClassBindings(db, req.user, { classId: req.params.id });
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.rows);
});

classRouter.get('/:id/invite', roleGuard('teacher'), (req, res) => {
  const result = listJoinRequests(db, req.user, req.params.id);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  const klass = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
  if (!klass) return res.status(404).json({ message: '班级不存在' });
  const invite = db.prepare('SELECT * FROM class_invites WHERE class_id = ? AND status = ? ORDER BY id DESC LIMIT 1').get(req.params.id, 'active');
  res.json({
    class: klass,
    invite,
    invite_url: invite ? `/student-mobile/join?token=${encodeURIComponent(invite.invite_token)}` : '',
    qr_svg: invite ? buildQrSvg(`/student-mobile/join?token=${encodeURIComponent(invite.invite_token)}`, klass.name) : '',
    requests: result.rows
  });
});

classRouter.post('/:id/invite/rotate', roleGuard('teacher'), (req, res) => {
  const result = rotateClassInvite(db, req.user, req.params.id, req.body);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.class);
});

classRouter.get('/:id', roleGuard('teacher'), (req, res) => {
  const klass = db.prepare('SELECT * FROM classes WHERE id = ?').get(req.params.id);
  if (!klass) return res.status(404).json({ message: '班级不存在' });
  if (!getManagedClass(req, req.params.id)) return res.status(403).json({ message: '没有管理该班级的权限' });
  const invite = db.prepare('SELECT * FROM class_invites WHERE class_id = ? AND status = ? ORDER BY id DESC LIMIT 1').get(req.params.id, 'active');
  res.json({
    ...klass,
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
    } : null
  });
});

classRouter.patch('/:id/lifecycle', roleGuard('teacher'), (req, res) => {
  const result = updateLifecycleClass(db, req.user, req.params.id, req.body);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.class);
});

classRouter.post('/:id/archive', roleGuard('teacher'), (req, res) => {
  const result = archiveLifecycleClass(db, req.user, req.params.id);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.class);
});

classRouter.post('/:id/restore', roleGuard('teacher'), (req, res) => {
  const result = restoreLifecycleClass(db, req.user, req.params.id);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.class);
});

classRouter.get('/:id/join-requests', roleGuard('teacher'), (req, res) => {
  const result = listJoinRequests(db, req.user, req.params.id);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.rows);
});

classRouter.post('/:id/join-requests/:requestId/approve', roleGuard('teacher'), (req, res) => {
  const result = approveJoinRequest(db, req.user, req.params.id, req.params.requestId);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.request);
});

classRouter.post('/:id/join-requests/:requestId/reject', roleGuard('teacher'), (req, res) => {
  const result = rejectJoinRequest(db, req.user, req.params.id, req.params.requestId, req.body.reason || '');
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.request);
});

classRouter.get('/:id/members', roleGuard('teacher'), (req, res) => {
  const result = listClassMembers(db, req.user, req.params.id);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.rows);
});

classRouter.delete('/:id/students/:studentId', roleGuard('teacher'), (req, res) => {
  const result = removeClassMember(db, req.user, req.params.id, req.params.studentId, req.body?.reason || '');
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.member);
});

classRouter.post('/:id/students/:studentId/pause', roleGuard('teacher'), (req, res) => {
  const result = pauseClassMember(db, req.user, req.params.id, req.params.studentId, req.body?.reason || '');
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.member);
});

classRouter.post('/:id/students/:studentId/restore', roleGuard('teacher'), (req, res) => {
  const result = restoreClassMember(db, req.user, req.params.id, req.params.studentId, req.body?.reason || '');
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.member);
});

classRouter.post('/:id/students/:studentId/transfer', roleGuard('teacher'), (req, res) => {
  const result = transferClassMember(db, req.user, req.params.id, req.params.studentId, req.body?.targetClassId || req.body?.target_class_id, req.body || {});
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result);
});

classRouter.post('/:id/feishu-binding', roleGuard('teacher'), (req, res) => {
  const result = bindFeishuClass(db, req.user, {
    ...req.body,
    classId: req.params.id
  });
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.binding);
});

classRouter.post('/:id/students/:studentId/feishu-binding', roleGuard('teacher'), (req, res) => {
  const result = bindFeishuStudent(db, req.user, {
    ...req.body,
    classId: req.params.id,
    studentId: req.params.studentId
  });
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.binding);
});

classRouter.get('/:classKey/statistics', roleGuard('teacher'), (req, res) => {
  res.json(getClassStatistics(req.app.locals.appDir, req.params.classKey));
});

classRouter.get('/:classKey/essays', roleGuard('teacher'), (req, res) => {
  res.json(listTeacherEssays(req.app.locals.appDir, { ...req.query, classKey: req.params.classKey }));
});

classRouter.post('/:classKey/archive', roleGuard('teacher'), (req, res, next) => {
  try {
    res.json(archiveClass(req.app.locals.appDir, req.params.classKey, { actorId: String(req.user.id), actorRole: req.user.role }));
  } catch (error) {
    next(error);
  }
});

classRouter.post('/:classKey/restore', roleGuard('teacher'), (req, res, next) => {
  try {
    res.json(restoreClass(req.app.locals.appDir, req.params.classKey, { actorId: String(req.user.id), actorRole: req.user.role }));
  } catch (error) {
    next(error);
  }
});

classRouter.post('/:classKey/import-students', roleGuard('teacher'), (req, res, next) => {
  try {
    res.json(importStudents(req.app.locals.appDir, req.params.classKey, { ...req.body, actorId: String(req.user.id) }));
  } catch (error) {
    next(error);
  }
});

classRouter.get('/:classKey', roleGuard('teacher'), (req, res, next) => {
  if (/^\d+$/.test(req.params.classKey)) return next();
  const klass = getClass(req.app.locals.appDir, req.params.classKey);
  if (!klass) return res.status(404).json({ message: '班级不存在' });
  res.json(klass);
});

classRouter.patch('/:classKey', roleGuard('teacher'), (req, res, next) => {
  if (/^\d+$/.test(req.params.classKey)) return next();
  try {
    res.json(updateClass(req.app.locals.appDir, req.params.classKey, req.body, { actorId: String(req.user.id), actorRole: req.user.role }));
  } catch (error) {
    next(error);
  }
});

classRouter.delete('/:classId', roleGuard('teacher'), (req, res) => {
  const result = deleteManagedEmptyClass(db, req.user, req.params.classId);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json({ ok: true, class: result.class });
});

classRouter.get('/:id/students', (req, res) => {
  if (!/^\d+$/.test(req.params.id)) {
    return res.json(listManagedStudents(req.app.locals.appDir, { ...req.query, classKey: req.params.id }));
  }
  const result = getClassRosterForUser(db, req.user, req.params.id);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.rows);
});

classRouter.post('/:id/students', roleGuard('teacher'), (req, res) => {
  if (!getManagedClass(req, req.params.id)) return res.status(403).json({ message: '没有管理该班级的权限' });
  const students = Array.isArray(req.body.students) ? req.body.students : [];
  if (!students.length) return res.status(400).json({ message: '请至少填写一名学生' });

  const addUser = db.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
  const addStudent = db.prepare('INSERT INTO students (user_id, student_no, grade, school, data_scope) VALUES (?, ?, ?, ?, ?)');
  const addRelation = db.prepare('INSERT OR IGNORE INTO class_students (class_id, student_id) VALUES (?, ?)');
  const addBinding = db.prepare(`
    INSERT INTO student_class_bindings (student_id, class_id, join_mode, status, joined_at, updated_at)
    VALUES (?, ?, 'approval', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(student_id, class_id) DO UPDATE SET
      join_mode = excluded.join_mode,
      status = 'active',
      left_at = NULL,
      updated_at = CURRENT_TIMESTAMP
  `);
  const created = [];

  for (const item of students) {
    const name = String(item.name || '').trim();
    const studentNo = String(item.student_no || '').trim();
    if (!name) continue;
    let student = studentNo
      ? db.prepare('SELECT * FROM students WHERE student_no = ?').get(studentNo)
      : null;
    let username;
    if (!student) {
      const base = `s${(studentNo || name).replace(/[^a-zA-Z0-9]/g, '') || Date.now()}`.slice(0, 28);
      username = base;
      let suffix = 1;
      while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
        username = `${base}${suffix++}`;
      }
      const userId = addUser.run(username, '123456', 'student', name).lastInsertRowid;
      const studentId = addStudent.run(userId, studentNo || null, item.grade || null, item.school || null, String(item.dataScope || item.data_scope || 'production')).lastInsertRowid;
      student = { id: studentId, student_no: studentNo, name, username };
      created.push({ ...student, initial_password: '123456' });
    }
    addRelation.run(req.params.id, student.id);
    addBinding.run(student.id, Number(req.params.id));
  }
  res.json({ ok: true, created });
});

classRouter.patch('/:classId/students/:studentId', roleGuard('teacher'), (req, res) => {
  const result = renameStudentForManagedClass(db, req.user, req.params.classId, req.params.studentId, req.body.name);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.student);
});
