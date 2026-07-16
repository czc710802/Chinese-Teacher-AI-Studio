import { Router } from 'express';
import { db } from '../db/connection.js';
import { requireUser } from '../middleware/auth.js';

export const authRouter = Router();

export function resolveLoginUser(database, credential = '', password = '') {
  const loginInput = credential && typeof credential === 'object'
    ? credential.username ?? credential.studentNo ?? credential.student_no ?? credential.account ?? ''
    : credential;
  const secretInput = credential && typeof credential === 'object'
    ? credential.password ?? password ?? ''
    : password;
  const login = String(loginInput || '').trim();
  const secret = String(secretInput || '').trim();
  if (!login || !secret) return { status: 401, message: '账号或密码错误' };

  const byUsername = database.prepare('SELECT id, username, role, name FROM users WHERE username = ? AND password = ?').get(login, secret);
  if (byUsername) {
    const student = byUsername.role === 'student' ? database.prepare('SELECT id FROM students WHERE user_id = ?').get(byUsername.id) : null;
    const teacher = byUsername.role === 'teacher' ? database.prepare('SELECT id FROM teachers WHERE user_id = ?').get(byUsername.id) : null;
    return { status: 200, user: { ...byUsername, studentId: student?.id, teacherId: teacher?.id } };
  }

  const byStudentNo = database.prepare(`
    SELECT u.id, u.username, u.role, u.name, s.id AS student_id
    FROM students s
    JOIN users u ON u.id = s.user_id
    WHERE s.student_no = ? AND u.password = ? AND u.role = 'student'
    ORDER BY s.id DESC
    LIMIT 1
  `).get(login, secret);
  if (byStudentNo) {
    return {
      status: 200,
      user: {
        id: byStudentNo.id,
        username: byStudentNo.username,
        role: byStudentNo.role,
        name: byStudentNo.name,
        studentId: byStudentNo.student_id,
        teacherId: null
      }
    };
  }

  return { status: 401, message: '账号或密码错误' };
}

authRouter.post('/change-password', requireUser, (req, res) => {
  const currentPassword = String(req.body.current_password || '');
  const newPassword = String(req.body.new_password || '');
  if (newPassword.length < 6) return res.status(400).json({ message: '新密码至少需要 6 位' });
  if (currentPassword === newPassword) return res.status(400).json({ message: '新密码不能与当前密码相同' });
  const user = db.prepare('SELECT id FROM users WHERE id = ? AND password = ?').get(req.user.id, currentPassword);
  if (!user) return res.status(400).json({ message: '当前密码不正确' });
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(newPassword, req.user.id);
  res.json({ ok: true, message: '密码已更新' });
});

authRouter.post('/login', (req, res) => {
  const { username, password } = req.body;
  const result = resolveLoginUser(db, username, password);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  if (!['student', 'teacher', 'admin'].includes(result.user.role)) return res.status(403).json({ message: '该账号角色已停用' });
  res.json({ user: result.user });
});
