import { Router } from 'express';
import { db } from '../db/connection.js';
import { requireUser, roleGuard } from '../middleware/auth.js';
import { deleteManagedEmptyClass, getClassRosterForUser, renameStudentForManagedClass } from '../services/class-access.js';
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
  const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(req.user.id);
  const rows = db.prepare(`
    SELECT c.*, COUNT(cs.student_id) AS student_count
    FROM classes c
    LEFT JOIN class_students cs ON cs.class_id = c.id
    WHERE c.teacher_id = ?
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all(teacher?.id || 0);
  res.json(rows);
});

classRouter.post('/', roleGuard('teacher'), (req, res) => {
  const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(req.user.id);
  const teacherId = teacher?.id;
  if (!teacherId) return res.status(400).json({ message: '请先创建教师账号后再创建班级' });
  const result = db.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)')
    .run(req.body.name, req.body.grade, teacherId);
  res.json(db.prepare('SELECT * FROM classes WHERE id = ?').get(result.lastInsertRowid));
});

classRouter.get('/import-template', (_req, res) => {
  res.type('text/csv').send('studentId,studentName,gender,className,grade,schoolYear\n20260301,学生姓名,男,3班,高二,2026\n');
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
  const addStudent = db.prepare('INSERT INTO students (user_id, student_no, grade, school) VALUES (?, ?, ?, ?)');
  const addRelation = db.prepare('INSERT OR IGNORE INTO class_students (class_id, student_id) VALUES (?, ?)');
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
      const studentId = addStudent.run(userId, studentNo || null, item.grade || null, item.school || null).lastInsertRowid;
      student = { id: studentId, student_no: studentNo, name, username };
      created.push({ ...student, initial_password: '123456' });
    }
    addRelation.run(req.params.id, student.id);
  }
  res.json({ ok: true, created });
});

classRouter.delete('/:classId/students/:studentId', roleGuard('teacher'), (req, res) => {
  if (!getManagedClass(req, req.params.classId)) return res.status(403).json({ message: '没有管理该班级的权限' });
  db.prepare('DELETE FROM class_students WHERE class_id = ? AND student_id = ?').run(req.params.classId, req.params.studentId);
  res.json({ ok: true });
});

classRouter.patch('/:classId/students/:studentId', roleGuard('teacher'), (req, res) => {
  const result = renameStudentForManagedClass(db, req.user, req.params.classId, req.params.studentId, req.body.name);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.student);
});
