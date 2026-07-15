import { Router } from 'express';
import { db } from '../db/connection.js';
import { requireUser, roleGuard } from '../middleware/auth.js';
import {
  createManagedAssignment,
  deleteManagedAssignment,
  getAssignmentPublicSummary,
  getAssignmentSubmissionStatus,
  listAssignmentsForUser,
  revokeAssignmentFeishuPublish,
  shareAssignmentToFeishu,
  buildAssignmentFeishuCard
} from '../services/assignment-access.js';
import { remindMissingStudents } from '../services/feishu-assignment-bindings.js';
import { resolveStudentSubmissionStatus } from '../services/essay-access.js';

export const assignmentRouter = Router();

assignmentRouter.get('/public/:assignmentId', (req, res) => {
  const result = getAssignmentPublicSummary(db, req.params.assignmentId, {
    publicOrigin: req.app.locals.env?.PUBLIC_APP_ORIGIN
  });
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.assignment);
});

assignmentRouter.use(requireUser);

assignmentRouter.get('/', (req, res) => {
  const result = listAssignmentsForUser(db, req.user, { classId: req.query.classId, dataScope: req.query.dataScope });
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.rows);
});

assignmentRouter.post('/', roleGuard('teacher'), (req, res) => {
  const result = createManagedAssignment(db, req.user, req.body, {
    publicOrigin: req.app.locals.env?.PUBLIC_APP_ORIGIN
  });
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.assignment);
});

assignmentRouter.get('/:assignmentId/status', roleGuard('teacher'), (req, res) => {
  const result = getAssignmentSubmissionStatus(db, req.user, req.params.assignmentId, {
    publicOrigin: req.app.locals.env?.PUBLIC_APP_ORIGIN
  });
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json({ assignment: result.assignment, submissions: result.submissions, missing: result.missing });
});

assignmentRouter.get('/:assignmentId/my-status', roleGuard('student'), (req, res) => {
  const result = resolveStudentSubmissionStatus(db, req.user, req.params.assignmentId);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result);
});

assignmentRouter.get('/:assignmentId/share/feishu/preview', roleGuard('teacher'), (req, res) => {
  const result = getAssignmentSubmissionStatus(db, req.user, req.params.assignmentId, {
    publicOrigin: req.app.locals.env?.PUBLIC_APP_ORIGIN
  });
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json({ assignment: result.assignment, card: buildAssignmentFeishuCard(result.assignment) });
});

assignmentRouter.post('/:assignmentId/share/feishu', roleGuard('teacher'), async (req, res, next) => {
  try {
    const result = await shareAssignmentToFeishu({
      database: db,
      user: req.user,
      assignmentId: req.params.assignmentId,
      feishuService: req.app.locals.feishuService,
      chatId: req.body?.chatId,
      options: { publicOrigin: req.app.locals.env?.PUBLIC_APP_ORIGIN }
    });
    if (result.status !== 200) return res.status(result.status).json({ message: result.message });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

assignmentRouter.post('/:assignmentId/share/feishu/revoke', roleGuard('teacher'), (req, res) => {
  const result = revokeAssignmentFeishuPublish(db, req.user, req.params.assignmentId);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result);
});

assignmentRouter.post('/:assignmentId/remind-missing', roleGuard('teacher'), async (req, res, next) => {
  try {
    const result = await remindMissingStudents({
      database: db,
      user: req.user,
      assignmentId: req.params.assignmentId,
      feishuService: req.app.locals.feishuService,
      options: { publicOrigin: req.app.locals.env?.PUBLIC_APP_ORIGIN }
    });
    if (result.status !== 200) return res.status(result.status).json({ message: result.message });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

assignmentRouter.delete('/:assignmentId', roleGuard('teacher'), (req, res) => {
  const result = deleteManagedAssignment(db, req.user, req.params.assignmentId);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json({ ok: true, assignment: result.assignment });
});
