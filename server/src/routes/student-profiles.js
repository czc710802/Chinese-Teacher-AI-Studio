import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { db } from '../db/connection.js';
import { requireUser } from '../middleware/auth.js';
import {
  getStudentProfile,
  listStudentProfiles,
  rebuildStudentProfile,
  rebuildStudentProfiles,
  retryPendingProfileUpdates,
  createDefaultProfileClient
} from '../services/student-profile/profile-service.js';
import { sectionsToDocxBuffer, sectionsToPdfBuffer } from '../services/exporter.js';

export const studentProfileRouter = Router();
studentProfileRouter.use(requireUser);

function profileOwnerUserId(profile) {
  if (!profile?.studentId) return null;
  const row = db.prepare('SELECT user_id FROM students WHERE student_no = ? OR id = ? ORDER BY student_no = ? DESC LIMIT 1')
    .get(profile.studentId, Number(profile.studentId) || -1, profile.studentId);
  return row?.user_id || null;
}

function canViewProfile(user, profile) {
  if (!profile) return false;
  if (user.role === 'teacher') return true;
  return String(profileOwnerUserId(profile)) === String(user.id);
}

function markdownSections(markdown = '') {
  return markdown.split(/\n## /).map((block, index) => {
    if (index === 0) return { title: '学生成长档案', content: block.replace(/^# 学生成长档案/, '').trim() || ' ' };
    const [title, ...rest] = block.split('\n');
    return { title, content: rest.join('\n').trim() || ' ' };
  });
}

studentProfileRouter.get('/', (req, res) => {
  let result = listStudentProfiles(req.app.locals.appDir, req.query);
  if (req.user.role === 'student') {
    result = { ...result, items: result.items.filter((profile) => canViewProfile(req.user, profile)) };
    result.total = result.items.length;
  }
  res.json(result);
});

studentProfileRouter.get('/:studentKey', (req, res) => {
  const data = getStudentProfile(req.app.locals.appDir, req.params.studentKey);
  if (!canViewProfile(req.user, data?.profile)) return res.status(404).json({ message: '未找到学生成长档案' });
  res.json(data);
});

studentProfileRouter.get('/:studentKey/essays', (req, res) => {
  const data = getStudentProfile(req.app.locals.appDir, req.params.studentKey);
  if (!canViewProfile(req.user, data?.profile)) return res.status(404).json({ message: '未找到学生成长档案' });
  res.json({ items: data.archiveIndex?.items || [] });
});

studentProfileRouter.post('/:studentKey/rebuild', async (req, res, next) => {
  try {
    if (req.user.role !== 'teacher') return res.status(403).json({ message: '没有重建档案权限' });
    const client = req.app.locals.zspaceClient || createDefaultProfileClient();
    res.json(await rebuildStudentProfile({ appDir: req.app.locals.appDir, studentKey: req.params.studentKey, client, logger: req.app.locals.logger || console }));
  } catch (error) {
    next(error);
  }
});

studentProfileRouter.post('/retry-pending', async (req, res, next) => {
  try {
    if (req.user.role !== 'teacher') return res.status(403).json({ message: '没有重试队列权限' });
    const client = req.app.locals.zspaceClient || createDefaultProfileClient();
    res.json(await retryPendingProfileUpdates({ appDir: req.app.locals.appDir, client, logger: req.app.locals.logger || console }));
  } catch (error) {
    next(error);
  }
});

studentProfileRouter.get('/:studentKey/export', async (req, res, next) => {
  try {
    const data = getStudentProfile(req.app.locals.appDir, req.params.studentKey);
    if (!canViewProfile(req.user, data?.profile)) return res.status(404).json({ message: '未找到学生成长档案' });
    const format = ['md', 'docx', 'pdf'].includes(req.query.format) ? req.query.format : 'md';
    const filename = `${req.params.studentKey}-growth-report.${format}`;
    if (format === 'md') {
      res.setHeader('content-type', 'text/markdown; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(data.summaryMarkdown || '');
      return;
    }
    const sections = markdownSections(data.summaryMarkdown || '');
    const buffer = format === 'docx'
      ? await sectionsToDocxBuffer('学生成长档案', sections)
      : await sectionsToPdfBuffer('学生成长档案', sections);
    res.setHeader('content-type', format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  } catch (error) {
    next(error);
  }
});

studentProfileRouter.post('/rebuild-all', async (req, res, next) => {
  try {
    if (req.user.role !== 'teacher') return res.status(403).json({ message: '没有重建档案权限' });
    const client = req.app.locals.zspaceClient || createDefaultProfileClient();
    res.json(await rebuildStudentProfiles({ appDir: req.app.locals.appDir, client, logger: req.app.locals.logger || console }));
  } catch (error) {
    next(error);
  }
});
