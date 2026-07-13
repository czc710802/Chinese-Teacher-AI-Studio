import { Router } from 'express';
import { db } from '../db/connection.js';
import { requireUser } from '../middleware/auth.js';

export const authRouter = Router();

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
  const user = db.prepare('SELECT id, username, role, name FROM users WHERE username = ? AND password = ?').get(username, password);
  if (!user) return res.status(401).json({ message: '账号或密码错误' });
  if (!['student', 'teacher', 'admin'].includes(user.role)) return res.status(403).json({ message: '该账号角色已停用' });
  const student = user.role === 'student' ? db.prepare('SELECT id FROM students WHERE user_id = ?').get(user.id) : null;
  const teacher = user.role === 'teacher' ? db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(user.id) : null;
  res.json({ user: { ...user, studentId: student?.id, teacherId: teacher?.id } });
});
