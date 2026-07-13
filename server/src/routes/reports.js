import { Router } from 'express';
import { requireUser } from '../middleware/auth.js';
import { exportAssignmentEssays, exportClassReport, exportEssayReport, exportExcellentEssays, exportReviewedEssays, exportStudentProfile } from '../services/exporter.js';
import { classAnalytics } from './analytics.js';

export const reportRouter = Router();
reportRouter.use(requireUser);

reportRouter.post('/essay/:essayId/:format', async (req, res, next) => {
  try {
    res.json(await exportEssayReport({ essayId: req.params.essayId, format: req.params.format, userId: req.user.id, storageService: req.app.locals.storageService }));
  } catch (error) {
    next(error);
  }
});

reportRouter.post('/assignment/:assignmentId/:format', async (req, res, next) => {
  try {
    res.json(await exportAssignmentEssays({ assignmentId: req.params.assignmentId, format: req.params.format, userId: req.user.id, storageService: req.app.locals.storageService }));
  } catch (error) {
    next(error);
  }
});

reportRouter.post('/reviewed/:format', async (req, res, next) => {
  try {
    res.json(await exportReviewedEssays({ classId: req.query.classId, format: req.params.format, userId: req.user.id, storageService: req.app.locals.storageService }));
  } catch (error) {
    next(error);
  }
});

reportRouter.post('/student/:studentId/:format', async (req, res, next) => {
  try {
    res.json(await exportStudentProfile({ studentId: req.params.studentId, format: req.params.format, userId: req.user.id, storageService: req.app.locals.storageService }));
  } catch (error) {
    next(error);
  }
});

reportRouter.post('/class/:classId/:format', async (req, res, next) => {
  try {
    const analytics = classAnalytics(req.params.classId, req.body.assignmentId);
    res.json(await exportClassReport({ classId: req.params.classId, format: req.params.format, userId: req.user.id, analytics, storageService: req.app.locals.storageService }));
  } catch (error) {
    next(error);
  }
});

reportRouter.post('/class/:classId/excellent/:format', async (req, res, next) => {
  try {
    res.json(await exportExcellentEssays({ classId: req.params.classId, format: req.params.format, userId: req.user.id, storageService: req.app.locals.storageService }));
  } catch (error) {
    next(error);
  }
});
