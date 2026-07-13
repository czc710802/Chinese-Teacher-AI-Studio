import { Router } from 'express';
import { db } from '../db/connection.js';
import { requireUser, roleGuard } from '../middleware/auth.js';
import {
  createManagedAssignment,
  deleteManagedAssignment,
  getAssignmentPublicSummary,
  getAssignmentSubmissionStatus,
  listAssignmentsForUser,
  shareAssignmentToFeishu
} from '../services/assignment-access.js';

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
  const result = listAssignmentsForUser(db, req.user, { classId: req.query.classId });
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

assignmentRouter.delete('/:assignmentId', roleGuard('teacher'), (req, res) => {
  const result = deleteManagedAssignment(db, req.user, req.params.assignmentId);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json({ ok: true, assignment: result.assignment });
});
