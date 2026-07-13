import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../server/src/config/env.js';
import {
  addTeacherComment,
  exportTeacherData,
  getClassStatistics,
  getTeacherDashboard,
  importStudents,
  listClasses,
  listStudents,
  listTeacherEssays,
  listTeacherTasks,
  rebuildTeacherManagement,
  retryPendingManagementTasks
} from '../../server/src/services/teacher-management/teacher-management-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '..', '..');

function bool(value) {
  return value ? 'true' : 'false';
}

try {
  await rebuildTeacherManagement({ appDir });
  const dashboard = getTeacherDashboard({
    appDir,
    aiStatus: { deepseekReady: true },
    nasStatus: { connected: true }
  });
  const classes = listClasses(appDir, { pageSize: 1000 });
  const allEssays = listTeacherEssays(appDir, { pageSize: 10000 });
  const classWithEssays = classes.items.find((item) => allEssays.items.some((essay) => essay.classKey === item.classKey));
  const classKey = classWithEssays?.classKey || classes.items[0]?.classKey || '';
  const students = listStudents(appDir, { classKey, pageSize: 1000 });
  const essays = listTeacherEssays(appDir, { classKey, pageSize: 1000 });
  const tasks = listTeacherTasks(appDir, { classKey, pageSize: 1000 });
  const statistics = classKey ? getClassStatistics(appDir, classKey) : null;
  const importDryRun = classKey ? importStudents(appDir, classKey, {
    dryRun: true,
    fileName: 'teacher-smoke.csv',
    content: `studentId,studentName,gender,className,grade,schoolYear\nSMOKE-${Date.now()},Smoke学生,男,${classes.items[0]?.className || 'Smoke班'},${classes.items[0]?.grade || '高二'},${classes.items[0]?.schoolYear || '2026'}\n`
  }) : null;
  const exportResult = classKey ? await exportTeacherData(appDir, { type: 'students', format: 'csv', classKey, actorId: 'teacher-smoke' }) : null;
  if (essays.items[0]?.archiveId) {
    addTeacherComment(appDir, essays.items[0].archiveId, {
      teacherId: 'teacher-smoke',
      teacherName: 'Smoke教师',
      overallComment: 'Smoke 教师点评',
      visibleToStudent: false
    });
  }
  const retry = retryPendingManagementTasks(appDir);
  const auditExists = fs.existsSync(path.join(appDir, 'logs', 'audit.log'));
  const nasLink = allEssays.items.some((item) => item.nasPath && item.nasArchiveStatus);
  const queueOk = retry.pending === 0 && dashboard.queues.managementPending === 0;

  console.log(`Dashboard=${bool(Boolean(dashboard?.updatedAt))}`);
  console.log(`Classes=${bool(classes.total >= 0)}`);
  console.log(`Students=${bool(students.total >= 0)}`);
  console.log(`Essays=${bool(essays.total >= 0)}`);
  console.log(`Tasks=${bool(tasks.total >= 0)}`);
  console.log(`Statistics=${bool(Boolean(statistics))}`);
  console.log(`ImportDryRun=${bool(Boolean(importDryRun && importDryRun.dryRun))}`);
  console.log(`Export=${bool(Boolean(exportResult && fs.existsSync(exportResult.filePath)))}`);
  console.log(`NASLink=${bool(nasLink)}`);
  console.log(`Audit=${bool(auditExists)}`);
  console.log(`Queue=${queueOk ? 'false' : 'true'}`);
  if (!queueOk || !statistics || !exportResult || !nasLink) process.exitCode = 1;
} catch (error) {
  console.error(`teacher:smoke failed: ${String(error?.message || error).slice(0, 300)}`);
  process.exitCode = 1;
}
