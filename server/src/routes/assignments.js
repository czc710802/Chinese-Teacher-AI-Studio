import { Router } from 'express';
import { db } from '../db/connection.js';
import { requireUser, roleGuard } from '../middleware/auth.js';
import { createManagedAssignment, deleteManagedAssignment, listAssignmentsForUser } from '../services/assignment-access.js';

export const assignmentRouter = Router();
assignmentRouter.use(requireUser);

assignmentRouter.get('/', (req, res) => {
  const result = listAssignmentsForUser(db, req.user, { classId: req.query.classId });
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.rows);
});

assignmentRouter.post('/', roleGuard('teacher'), (req, res) => {
  const result = createManagedAssignment(db, req.user, req.body);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json(result.assignment);
});

assignmentRouter.delete('/:assignmentId', roleGuard('teacher'), (req, res) => {
  const result = deleteManagedAssignment(db, req.user, req.params.assignmentId);
  if (result.status !== 200) return res.status(result.status).json({ message: result.message });
  res.json({ ok: true, assignment: result.assignment });
});
