import { Router } from 'express';
import { requireUser, roleGuard } from '../middleware/auth.js';
import { getAiStatus } from '../services/openai.js';
import {
  addTeacherComment,
  archiveClass,
  archiveStudent,
  createClass,
  createStudent,
  exportTeacherData,
  getClass,
  getClassStatistics,
  getStudent,
  getTeacherDashboard,
  importStudents,
  listClasses,
  listStudents,
  listTeacherComments,
  listTeacherEssays,
  listTeacherTasks,
  rebuildTeacherManagement,
  restoreClass,
  restoreStudent,
  retryPendingManagementTasks,
  transferStudent,
  updateClass,
  updateStudent
} from '../services/teacher-management/teacher-management-service.js';
import { getStudentProfile } from '../services/student-profile/profile-service.js';
import { getArchiveRecord } from '../services/archive-pipeline.js';
import { buildArchiveDownloadLinks } from '../services/file-access.js';
import { buildEssayResultCard } from '../integrations/feishu/cards.js';
import { sendCardMessage } from '../integrations/feishu/client.js';

function actor(req) {
  return { actorId: String(req.user?.id || ''), actorRole: req.user?.role || '' };
}

function teacherOnly(req, res, next) {
  if (!['teacher', 'admin'].includes(req.user?.role)) return res.status(403).json({ message: '没有访问教师后台的权限' });
  next();
}

function nasStatus(req) {
  const client = req.app.locals.zspaceClient;
  if (client?.initError) return { connected: false };
  return { connected: Boolean(client?.config?.enabled), writable: Boolean(client?.config?.enabled) };
}

export const teacherManagementRouter = Router();
teacherManagementRouter.use(requireUser, teacherOnly);

teacherManagementRouter.get('/dashboard', (req, res) => {
  res.json(getTeacherDashboard({
    appDir: req.app.locals.appDir,
    aiStatus: getAiStatus(),
    nasStatus: nasStatus(req)
  }));
});

teacherManagementRouter.get('/classes', (req, res) => res.json(listClasses(req.app.locals.appDir, req.query)));
teacherManagementRouter.post('/classes', (req, res, next) => {
  try {
    res.json(createClass(req.app.locals.appDir, req.body, actor(req)));
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.get('/classes/import-template', (_req, res) => {
  res.type('text/csv').send('studentId,studentName,gender,className,grade,schoolYear\n20260301,学生姓名,男,3班,高二,2026\n');
});
teacherManagementRouter.get('/classes/:classKey', (req, res) => {
  const klass = getClass(req.app.locals.appDir, req.params.classKey);
  if (!klass) return res.status(404).json({ message: '班级不存在' });
  res.json(klass);
});
teacherManagementRouter.patch('/classes/:classKey', (req, res, next) => {
  try {
    res.json(updateClass(req.app.locals.appDir, req.params.classKey, req.body, actor(req)));
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.post('/classes/:classKey/archive', (req, res, next) => {
  try {
    res.json(archiveClass(req.app.locals.appDir, req.params.classKey, actor(req)));
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.post('/classes/:classKey/restore', (req, res, next) => {
  try {
    res.json(restoreClass(req.app.locals.appDir, req.params.classKey, actor(req)));
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.get('/classes/:classKey/statistics', (req, res) => res.json(getClassStatistics(req.app.locals.appDir, req.params.classKey)));
teacherManagementRouter.get('/classes/:classKey/students', (req, res) => res.json(listStudents(req.app.locals.appDir, { ...req.query, classKey: req.params.classKey })));
teacherManagementRouter.get('/classes/:classKey/essays', (req, res) => res.json(listTeacherEssays(req.app.locals.appDir, { ...req.query, classKey: req.params.classKey })));
teacherManagementRouter.post('/classes/:classKey/import-students', (req, res, next) => {
  try {
    res.json(importStudents(req.app.locals.appDir, req.params.classKey, { ...req.body, actorId: String(req.user.id) }));
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.get('/students', (req, res) => res.json(listStudents(req.app.locals.appDir, req.query)));
teacherManagementRouter.post('/students', (req, res, next) => {
  try {
    res.json(createStudent(req.app.locals.appDir, req.body, actor(req)));
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.get('/students/:studentKey', (req, res) => {
  const student = getStudent(req.app.locals.appDir, req.params.studentKey);
  if (!student) return res.status(404).json({ message: '学生不存在' });
  res.json(student);
});
teacherManagementRouter.patch('/students/:studentKey', (req, res, next) => {
  try {
    res.json(updateStudent(req.app.locals.appDir, req.params.studentKey, req.body, actor(req)));
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.post('/students/:studentKey/transfer', (req, res, next) => {
  try {
    res.json(transferStudent(req.app.locals.appDir, req.params.studentKey, req.body, actor(req)));
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.post('/students/:studentKey/archive', (req, res, next) => {
  try {
    res.json(archiveStudent(req.app.locals.appDir, req.params.studentKey, actor(req)));
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.post('/students/:studentKey/restore', (req, res, next) => {
  try {
    res.json(restoreStudent(req.app.locals.appDir, req.params.studentKey, actor(req)));
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.get('/students/:studentKey/essays', (req, res) => res.json(listTeacherEssays(req.app.locals.appDir, { studentKey: req.params.studentKey })));
teacherManagementRouter.get('/students/:studentKey/profile', (req, res) => {
  const profile = getStudentProfile(req.app.locals.appDir, req.params.studentKey);
  if (!profile) return res.status(404).json({ message: '学生成长档案不存在' });
  res.json(profile);
});

teacherManagementRouter.get('/essays', (req, res) => res.json(listTeacherEssays(req.app.locals.appDir, req.query)));
teacherManagementRouter.post('/essays/:archiveId/send-to-feishu', async (req, res, next) => {
  try {
    const record = getArchiveRecord(req.app.locals.appDir, req.params.archiveId);
    if (!record) return res.status(404).json({ message: '归档记录不存在' });
    const links = await buildArchiveDownloadLinks({
      appDir: req.app.locals.appDir,
      archiveId: req.params.archiveId,
      userId: `teacher-${req.user.id}`,
      env: req.app.locals.env || process.env,
      client: req.app.locals.zspaceClient
    });
    const result = {
      totalScore: record.score,
      fullScore: record.maxScore || 60,
      level: record.grade || record.level || '',
      coreAdvantages: [],
      mainProblems: [],
      nextTraining: []
    };
    const card = buildEssayResultCard(result, { links });
    let sent = false;
    if (req.body?.chatId) {
      const sendResult = await sendCardMessage({
        env: req.app.locals.env || process.env,
        receiveId: req.body.chatId,
        receiveIdType: req.body.receiveIdType || 'chat_id',
        card
      });
      sent = Boolean(sendResult.ok);
    }
    res.json({ ok: true, sent, archiveId: record.id, links, card });
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.post('/essays/:archiveId/comments', (req, res, next) => {
  try {
    res.json(addTeacherComment(req.app.locals.appDir, req.params.archiveId, req.body, actor(req)));
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.patch('/essays/:archiveId/comments/:commentId', (req, res, next) => {
  try {
    res.json(addTeacherComment(req.app.locals.appDir, req.params.archiveId, { ...req.body, commentId: req.params.commentId }, actor(req)));
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.get('/essays/:archiveId/comments', (req, res) => res.json(listTeacherComments(req.app.locals.appDir, req.params.archiveId)));
teacherManagementRouter.get('/tasks', (req, res) => res.json(listTeacherTasks(req.app.locals.appDir, req.query)));
teacherManagementRouter.post('/tasks/retry-pending', (req, res) => res.json(retryPendingManagementTasks(req.app.locals.appDir)));
teacherManagementRouter.post('/rebuild', async (req, res, next) => {
  try {
    res.json(await rebuildTeacherManagement({ appDir: req.app.locals.appDir, logger: req.app.locals.logger || console }));
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.get('/export', async (req, res, next) => {
  try {
    res.json(await exportTeacherData(req.app.locals.appDir, { ...req.query, actorId: String(req.user.id) }));
  } catch (error) {
    next(error);
  }
});

export const studentManagementRouter = Router();
studentManagementRouter.use(requireUser, teacherOnly);
studentManagementRouter.get('/', (req, res) => res.json(listStudents(req.app.locals.appDir, req.query)));
studentManagementRouter.post('/', (req, res, next) => {
  try {
    res.json(createStudent(req.app.locals.appDir, req.body, actor(req)));
  } catch (error) {
    next(error);
  }
});
studentManagementRouter.get('/:studentKey', (req, res) => {
  const student = getStudent(req.app.locals.appDir, req.params.studentKey);
  if (!student) return res.status(404).json({ message: '学生不存在' });
  res.json(student);
});
studentManagementRouter.post('/:studentKey/transfer', (req, res, next) => {
  try {
    res.json(transferStudent(req.app.locals.appDir, req.params.studentKey, req.body, actor(req)));
  } catch (error) {
    next(error);
  }
});
studentManagementRouter.post('/:studentKey/archive', (req, res, next) => {
  try {
    res.json(archiveStudent(req.app.locals.appDir, req.params.studentKey, actor(req)));
  } catch (error) {
    next(error);
  }
});
studentManagementRouter.post('/:studentKey/restore', (req, res, next) => {
  try {
    res.json(restoreStudent(req.app.locals.appDir, req.params.studentKey, actor(req)));
  } catch (error) {
    next(error);
  }
});
studentManagementRouter.get('/:studentKey/essays', (req, res) => res.json(listTeacherEssays(req.app.locals.appDir, { studentKey: req.params.studentKey })));
studentManagementRouter.get('/:studentKey/profile', (req, res) => {
  const profile = getStudentProfile(req.app.locals.appDir, req.params.studentKey);
  if (!profile) return res.status(404).json({ message: '学生成长档案不存在' });
  res.json(profile);
});
