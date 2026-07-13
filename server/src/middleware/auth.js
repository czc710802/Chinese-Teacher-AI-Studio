import { db } from '../db/connection.js';

export function requireUser(req, res, next) {
  const userId = Number(req.header('x-user-id'));
  if (!userId) return res.status(401).json({ message: '请先登录' });
  const user = db.prepare('SELECT id, username, role, name FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(401).json({ message: '用户不存在' });
  req.user = user;
  next();
}

export function roleGuard(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ message: '没有访问权限' });
    next();
  };
}
