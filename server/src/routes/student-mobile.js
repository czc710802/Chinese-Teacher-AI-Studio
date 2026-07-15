import { Router } from 'express';
import { db } from '../db/connection.js';
import { requireUser } from '../middleware/auth.js';
import { createJoinRequest, createJoinRequestByCode, getJoinPreview, getJoinPreviewByCode, getJoinRequestStatus, listStudentMobileAssignments, listStudentMobileClasses } from '../services/class-lifecycle.js';
import { getVisibleAssignmentForStudent } from '../services/assignment-access.js';

export const studentMobileRouter = Router();

studentMobileRouter.get('/join/:token', (req, res) => {
  const result = getJoinPreview(db, req.params.token);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.class);
});

studentMobileRouter.post('/join/:token', (req, res) => {
  const result = createJoinRequest(db, { ...req.body, token: req.params.token, source: 'student-mobile' });
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.request);
});

studentMobileRouter.get('/join/code/:code', (req, res) => {
  const result = getJoinPreviewByCode(db, req.params.code);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.class);
});

studentMobileRouter.post('/join/code', (req, res) => {
  const result = createJoinRequestByCode(db, { ...req.body, source: 'student-mobile' });
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.request);
});

studentMobileRouter.use(requireUser);

studentMobileRouter.get('/join/requests/:requestId', (req, res) => {
  const result = getJoinRequestStatus(db, req.user, req.params.requestId);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.request);
});

studentMobileRouter.get('/classes', (req, res) => {
  const result = listStudentMobileClasses(db, req.user);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.rows);
});

studentMobileRouter.get('/tasks', (req, res) => {
  const result = listStudentMobileAssignments(db, req.user, req.query.classId || null);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.rows);
});

studentMobileRouter.get('/tasks/:assignmentId', (req, res) => {
  const student = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id);
  if (!student) return res.status(404).json({ message: '学生档案不存在' });
  const result = getVisibleAssignmentForStudent(db, student.id, req.params.assignmentId);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.assignment);
});

studentMobileRouter.get('/profile', (req, res) => {
  const student = db.prepare(`
    SELECT s.id, s.student_no, s.grade, s.school, u.name, u.username, sp.score_trend, sp.common_problems, sp.growth_report, sp.personalized_suggestions
    FROM students s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN student_profiles sp ON sp.student_id = s.id
    WHERE u.id = ?
  `).get(req.user.id);
  if (!student) return res.status(404).json({ message: '学生档案不存在' });
  res.json(student);
});
