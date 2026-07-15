import { Router } from 'express';
import { db } from '../db/connection.js';
import { requireUser } from '../middleware/auth.js';
import { getAiStatus } from '../services/openai.js';
import { gradeEssay } from '../services/essay-grading/grading-service.js';
import { buildReviewHistoryComparison, getLatestEssayReview, listEssayReviewHistory, saveEssayReviewVersion, saveTeacherReview } from '../services/essay-grading/review-history.js';
import { archiveEssayToNASAsync } from '../services/archive-pipeline.js';
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
  updateStudent,
  writeAuditLog
} from '../services/teacher-management/teacher-management-service.js';
import { getStudentProfile } from '../services/student-profile/profile-service.js';
import { getArchiveRecord } from '../services/archive-pipeline.js';
import { buildArchiveDownloadLinks } from '../services/file-access.js';
import { buildFeishuBusinessMigrationNotice, isFeishuBusinessEnabled } from '../integrations/feishu/config.js';
import { buildEssayResultCard } from '../integrations/feishu/cards.js';
import { sendCardMessage } from '../integrations/feishu/client.js';
import { refreshStudentProfile } from '../services/profile.js';
import { recordReviewArtifact } from '../services/storage-artifacts.js';
import { archiveEssayToZSpaceAsync } from '../services/zspace-storage.js';
import { buildLegacyCleanupDryRun, buildSystemTestCenterSnapshot, writeLegacyCleanupReport } from '../services/legacy-cleanup.js';
import { resetSystemTestEnvironment } from '../services/test-environment.js';
import { buildQrSvg } from '../services/class-lifecycle.js';
import { buildPublicUrl } from '../services/public-access.js';

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

function currentPublicOrigin(req) {
  return String(req.app.locals.env?.PUBLIC_APP_ORIGIN || req.app.locals.env?.FEISHU_REPORT_PUBLIC_BASE_URL || 'https://pi.zhenwanyue.icu').replace(/\/+$/, '');
}

function appendQuery(url = '', params = {}) {
  const target = String(url || '').trim();
  if (!target) return '';
  try {
    const parsed = new URL(target);
    for (const [key, value] of Object.entries(params || {})) {
      if (value == null || value === '') continue;
      parsed.searchParams.set(key, String(value));
    }
    return parsed.toString();
  } catch {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params || {})) {
      if (value == null || value === '') continue;
      search.set(key, String(value));
    }
    const query = search.toString();
    return query ? `${target}${target.includes('?') ? '&' : '?'}${query}` : target;
  }
}

function canAccessEssayRecord(req, essay) {
  if (!essay) return false;
  if (req.user?.role === 'admin') return true;
  if (req.user?.role !== 'teacher') return false;
  const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(req.user.id);
  if (!teacher) return false;
  const klass = db.prepare('SELECT teacher_id FROM classes WHERE id = ?').get(Number(essay.class_id || 0));
  return Number(klass?.teacher_id || 0) === Number(teacher.id);
}

async function loadTeacherEssayDetail(req, essayId) {
  const essay = db.prepare(`
    SELECT
      e.*,
      a.title AS assignment_title,
      a.prompt AS assignment_prompt,
      a.requirements,
      a.scoring_standard,
      a.essay_type,
      a.full_score,
      a.class_id,
      c.name AS class_name,
      c.grade AS class_grade,
      s.id AS student_internal_id,
      s.student_no,
      u.id AS student_user_id,
      u.name AS student_name
    FROM essays e
    JOIN assignments a ON a.id = e.assignment_id
    JOIN classes c ON c.id = a.class_id
      JOIN students s ON s.id = e.student_id
      JOIN users u ON u.id = s.user_id
      WHERE e.id = ?
  `).get(essayId);
  if (!essay) return null;
  if (!canAccessEssayRecord(req, essay)) return { status: 403, message: '没有查看该作文的权限' };
  const review = getLatestEssayReview(db, essayId);
  const history = listEssayReviewHistory(db, essayId);
  const comments = db.prepare('SELECT * FROM teacher_comments WHERE essay_id = ? ORDER BY created_at DESC').all(essayId);
  const teacherReview = review?.raw_json?.teacherReview || {
    status: 'draft',
    comment: '',
    finalScore: null,
    strengths: [],
    weaknesses: [],
    suggestions: []
  };
  const archiveId = `essay-${essayId}`;
  const archiveRecord = getArchiveRecord(req.app.locals.appDir, archiveId);
  const downloadLinks = archiveRecord
    ? await buildArchiveDownloadLinks({
        appDir: req.app.locals.appDir,
        archiveId,
        userId: `teacher-${req.user.id}`,
        env: req.app.locals.env || process.env,
        client: req.app.locals.zspaceClient
      })
    : { archiveId, available: false, reportUrl: '', markdownUrl: '', docxUrl: '', pdfUrl: '', files: {} };
  const teacherEssayUrl = `${currentPublicOrigin(req)}/teacher/essays/${essayId}`;
  return {
    status: 200,
    essay,
    review,
    history,
    comparison: buildReviewHistoryComparison(history),
    comments,
    teacherReview,
    archive: archiveRecord,
    links: {
      ...downloadLinks,
      archiveUrl: downloadLinks.reportUrl || '',
      teacherEssayUrl,
      teacherReviewUrl: appendQuery(teacherEssayUrl, { reportId: review?.id || '', action: 'review' }),
      regradeUrl: appendQuery(teacherEssayUrl, { reportId: review?.id || '', action: 'regrade' }),
      studentReportUrl: `${currentPublicOrigin(req)}/student/essays/${essayId}/report?reportId=${encodeURIComponent(String(review?.id || ''))}`,
      reportUrl: downloadLinks.reportUrl || `${currentPublicOrigin(req)}/student/essays/${essayId}/report?reportId=${encodeURIComponent(String(review?.id || ''))}`,
      pdfUrl: downloadLinks.pdfUrl || '',
      docxUrl: downloadLinks.docxUrl || ''
    }
  };
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

teacherManagementRouter.get('/test-center', (req, res) => {
  const snapshot = buildSystemTestCenterSnapshot({
    appDir: req.app.locals.appDir,
    database: db
  });
  try {
    const klass = db.prepare(`
      SELECT c.*, t.user_id AS teacher_user_id, u.name AS teacher_name
      FROM classes c
      LEFT JOIN teachers t ON t.id = c.teacher_id
      LEFT JOIN users u ON u.id = t.user_id
      WHERE LOWER(COALESCE(c.data_scope, 'production')) = 'system_test'
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT 1
    `).get() || null;
    if (klass) {
      const invite = db.prepare(`
        SELECT *
        FROM class_invites
        WHERE class_id = ? AND status = 'active'
        ORDER BY id DESC
        LIMIT 1
      `).get(klass.id) || null;
      const studentCount = Number(db.prepare(`
        SELECT COUNT(*) AS count
        FROM class_students cs
        LEFT JOIN student_class_bindings b ON b.student_id = cs.student_id AND b.class_id = cs.class_id
        WHERE cs.class_id = ? AND COALESCE(b.status, 'active') = 'active'
      `).get(klass.id)?.count || 0);
      const pendingJoinRequests = Number(db.prepare(`
        SELECT COUNT(*) AS count
        FROM class_join_requests
        WHERE class_id = ? AND status = 'pending'
      `).get(klass.id)?.count || 0);
      const classKey = `${new Date().getFullYear()}_测试_系统测试班`;
      const inviteUrl = invite?.invite_token ? buildPublicUrl(`/student-mobile/join?token=${encodeURIComponent(invite.invite_token)}`) : snapshot.fixture?.class?.inviteUrl || '';
        snapshot.fixture = {
        class: {
          ...snapshot.fixture?.class,
          classId: String(klass.id || snapshot.fixture?.class?.classId || ''),
          classKey,
          className: klass.name || '系统测试班',
          grade: klass.grade || '测试',
          teacherId: String(klass.teacher_id || ''),
          teacherName: klass.teacher_name || '',
          studentCount,
          pendingJoinRequests,
          pending_join_requests: pendingJoinRequests,
          joinMode: klass.join_mode || 'approval',
          inviteCode: invite?.invite_code || klass.invite_code || snapshot.fixture?.class?.inviteCode || 'SYSTEM-TEST-001',
          inviteCodeExpiresAt: invite?.expires_at || klass.invite_code_expires_at || '',
          inviteStatus: invite?.status || klass.status || snapshot.fixture?.class?.inviteStatus || 'active',
          inviteUrl,
          qrSvg: invite?.invite_token ? buildQrSvg(inviteUrl, klass.name || '系统测试班') : snapshot.fixture?.class?.qrSvg || '',
          maxStudents: Number(klass.max_students || snapshot.fixture?.class?.maxStudents || 60),
          status: klass.status || snapshot.fixture?.class?.status || 'active',
          dataScope: 'system_test',
          isTestData: true
        },
        student: snapshot.fixture?.student || null
      };
      if (snapshot?.report?.teacherManagement?.totals) {
        snapshot.report.teacherManagement.totals.pendingRequests = pendingJoinRequests;
        snapshot.report.teacherManagement.totals.requests = pendingJoinRequests;
      }
      snapshot.links = {
        ...snapshot.links,
        studentJoin: snapshot.fixture.class.inviteUrl || snapshot.links?.studentJoin || buildPublicUrl('/student-mobile/join/code'),
        testClassDetail: `/teacher/classes/${encodeURIComponent(klass.id)}`,
        testClassMembers: `/teacher/classes/${encodeURIComponent(klass.id)}/members`,
        testClassRequests: `/teacher/join-requests?classId=${encodeURIComponent(klass.id)}`
      };
    }
  } catch (error) {
    req.app.locals.logger?.warn?.('test-center live snapshot merge failed', { message: error?.message || String(error) });
  }
  res.json(snapshot);
});

teacherManagementRouter.post('/test-center/reset-fixture', (req, res) => {
  const result = resetSystemTestEnvironment({
    appDir: req.app.locals.appDir,
    database: db,
    logger: req.app.locals.logger || console
  });
  res.json(result);
});

teacherManagementRouter.get('/cleanup/legacy/dry-run', (req, res) => {
  const report = buildLegacyCleanupDryRun({
    appDir: req.app.locals.appDir,
    database: db
  });
  const files = writeLegacyCleanupReport(req.app.locals.appDir, report);
  res.json({
    ok: true,
    report,
    files
  });
});

teacherManagementRouter.get('/classes', (req, res) => res.json(listClasses(req.app.locals.appDir, req.query, db)));
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
    const teacherEssayId = String(record.essayId || '').trim();
    const teacherEssayUrl = teacherEssayId ? `${currentPublicOrigin(req)}/teacher/essays/${encodeURIComponent(teacherEssayId)}` : '';
    let sent = false;
    if (req.body?.chatId && isFeishuBusinessEnabled(req.app.locals.env || process.env)) {
      const sendResult = await sendCardMessage({
        env: req.app.locals.env || process.env,
        receiveId: req.body.chatId,
        receiveIdType: req.body.receiveIdType || 'chat_id',
        card: buildEssayResultCard(result, {
          links: {
            ...links,
            audience: 'teacher',
            archiveUrl: links.reportUrl || '',
            teacherEssayUrl,
            teacherReviewUrl: appendQuery(teacherEssayUrl, { reportId: record.reportId || '', action: 'review' }),
            regradeUrl: appendQuery(teacherEssayUrl, { reportId: record.reportId || '', action: 'regrade' })
          }
        })
      });
      sent = Boolean(sendResult.ok);
    }
    res.json({
      ok: true,
      sent,
      paused: !isFeishuBusinessEnabled(req.app.locals.env || process.env),
      message: !isFeishuBusinessEnabled(req.app.locals.env || process.env) ? buildFeishuBusinessMigrationNotice(req.app.locals.env || process.env) : '',
      archiveId: record.id,
      links: { ...links, audience: 'teacher', archiveUrl: links.reportUrl || '', teacherEssayUrl },
      card
    });
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.get('/essays/:essayId/detail', async (req, res, next) => {
  try {
    const detail = await loadTeacherEssayDetail(req, req.params.essayId);
    if (!detail) return res.status(404).json({ message: '作文不存在' });
    if (detail.status && detail.status !== 200) return res.status(detail.status).json({ message: detail.message || '没有查看该作文的权限' });
    res.json(detail);
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.get('/essays/:essayId/history', async (req, res, next) => {
  try {
    const detail = await loadTeacherEssayDetail(req, req.params.essayId);
    if (!detail) return res.status(404).json({ message: '作文不存在' });
    if (detail.status && detail.status !== 200) return res.status(detail.status).json({ message: detail.message || '没有查看该作文的权限' });
    res.json({ items: detail.history || [], total: (detail.history || []).length, comparison: detail.comparison || null });
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.post('/essays/:essayId/rerun', async (req, res, next) => {
  try {
    const detail = await loadTeacherEssayDetail(req, req.params.essayId);
    if (!detail) return res.status(404).json({ message: '作文不存在' });
    if (detail.status && detail.status !== 200) return res.status(detail.status).json({ message: detail.message || '没有重新批改该作文的权限' });
    const essay = detail.essay;
    const currentReview = detail.review || getLatestEssayReview(db, essay.id);
    const promptMode = String(req.body?.promptMode || 'latest').trim();
    const promptText = String(req.body?.promptText || '').trim();
    const rerunReason = String(req.body?.rerunReason || '').trim();
    let resolvedPrompt = essay.assignment_prompt || '';
    if (promptMode === 'keep_original') {
      resolvedPrompt = currentReview?.prompt_text || essay.assignment_prompt || '';
    } else if (promptMode === 'update') {
      resolvedPrompt = promptText || essay.assignment_prompt || '';
    } else {
      resolvedPrompt = essay.assignment_prompt || promptText || '';
    }
    if (!resolvedPrompt) return res.status(400).json({ message: '重新批改需要有效的批改提示词' });

    const gradingJobId = `teacher-rerun-${req.params.essayId}-${Date.now()}`;
    db.prepare('UPDATE essays SET grading_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('grading', essay.id);
    const review = await gradeEssay({
      essayId: essay.id,
      studentId: essay.student_id,
      studentName: essay.student_name,
      classId: essay.class_id,
      grade: essay.class_grade || '',
      title: essay.title || essay.assignment_title || '',
      prompt: resolvedPrompt,
      essayText: essay.revised_text || essay.original_text || '',
      sourceType: 'teacher',
      scoringStandard: essay.scoring_standard || '',
      maxScore: essay.full_score || 60,
      model: currentReview?.model || '',
      teacherRequirements: essay.requirements || ''
    });
    const latest = saveEssayReviewVersion(db, {
      essayId: essay.id,
      review,
      promptText: resolvedPrompt,
      promptMode,
      reportVersion: review.reportVersion || review.metadata?.reportVersion || '2.0',
      model: review.metadata?.model || review.ai_meta?.model || currentReview?.model || '',
      sourceType: 'teacher',
      rerunReason,
      createdByUserId: String(req.user?.id || ''),
      createdByRole: String(req.user?.role || ''),
      gradingJobId
    });
    await recordReviewArtifact({ storageService: req.app.locals.storageService, database: db, essayId: essay.id, review, logger: req.app.locals.logger || console });
    archiveEssayToZSpaceAsync({
      appDir: req.app.locals.appDir || process.cwd(),
      database: db,
      essayId: essay.id,
      client: req.app.locals.zspaceClient,
      logger: req.app.locals.logger || console
    });
    archiveEssayToNASAsync({
      appDir: req.app.locals.appDir || process.cwd(),
      database: db,
      essayId: essay.id,
      client: req.app.locals.zspaceClient,
      logger: req.app.locals.logger || console
    });
    try {
      refreshStudentProfile(essay.student_id, { storageService: req.app.locals.storageService, logger: req.app.locals.logger || console });
    } catch (error) {
      (req.app.locals.logger || console).warn?.('refreshStudentProfile failed after teacher rerun', error?.message || error);
    }
    writeAuditLog(req.app.locals.appDir, {
      actorId: String(req.user?.id || ''),
      actorRole: String(req.user?.role || 'teacher'),
      action: 'teacher.essay.rerun',
      targetType: 'essay',
      targetId: String(essay.id),
      details: { gradingJobId, promptMode, reportVersion: latest?.report_version || '2.0' }
    });
    const updated = await loadTeacherEssayDetail(req, req.params.essayId);
    res.json({ ok: true, gradingJobId, review: latest, detail: updated });
  } catch (error) {
    next(error);
  }
});
teacherManagementRouter.post('/essays/:essayId/teacher-review', async (req, res, next) => {
  try {
    const detail = await loadTeacherEssayDetail(req, req.params.essayId);
    if (!detail) return res.status(404).json({ message: '作文不存在' });
    if (detail.status && detail.status !== 200) return res.status(detail.status).json({ message: detail.message || '没有保存该作文教师评分的权限' });
    const essay = detail.essay;
    const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(req.user?.id);
    const status = String(req.body?.status || 'draft').trim() === 'submitted' ? 'submitted' : 'draft';
    const latest = saveTeacherReview(db, {
      essayId: essay.id,
      reviewId: req.body?.reviewId || '',
      versionNumber: req.body?.versionNumber,
      teacherId: String(teacher?.id || ''),
      teacherRole: String(req.user?.role || 'teacher'),
      teacherReview: {
        status,
        finalScore: req.body?.finalScore ?? null,
        comment: String(req.body?.comment || ''),
        strengths: Array.isArray(req.body?.strengths) ? req.body.strengths : String(req.body?.strengths || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        weaknesses: Array.isArray(req.body?.weaknesses) ? req.body.weaknesses : String(req.body?.weaknesses || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        suggestions: Array.isArray(req.body?.suggestions) ? req.body.suggestions : String(req.body?.suggestions || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
        draftSavedAt: status === 'draft' ? new Date().toISOString() : detail.teacherReview?.draftSavedAt || null,
        submittedAt: status === 'submitted' ? new Date().toISOString() : detail.teacherReview?.submittedAt || null
      }
    });
    const updated = await loadTeacherEssayDetail(req, req.params.essayId);
    writeAuditLog(req.app.locals.appDir, {
      actorId: String(req.user?.id || ''),
      actorRole: String(req.user?.role || 'teacher'),
      action: status === 'submitted' ? 'teacher.essay.review.submit' : 'teacher.essay.review.draft',
      targetType: 'essay',
      targetId: String(essay.id),
      details: {
        finalScore: req.body?.finalScore ?? null,
        status,
        reportVersion: latest?.report_version || '2.0'
      }
    });
    res.json({ ok: true, review: latest, detail: updated });
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
