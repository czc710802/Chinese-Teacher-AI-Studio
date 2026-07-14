import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { schemaSql } from '../src/db/schema.js';
import {
  addTeacherComment,
  archiveClass,
  archiveStudent,
  createClass,
  createStudent,
  exportTeacherData,
  generateClassKey,
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
  transferStudent
} from '../src/services/teacher-management/teacher-management-service.js';
import { saveEssayReviewVersion, saveTeacherReview } from '../src/services/essay-grading/review-history.js';

function tempAppDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'teacher-management-'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function createReviewDb() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(schemaSql);
  const addUser = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
  const teacherUserId = addUser.run('teacher-review', 'unused', 'teacher', 'TEST 陈老师').lastInsertRowid;
  const studentUserId = addUser.run('student-review', 'unused', 'student', 'TEST 学生').lastInsertRowid;
  const teacherId = database.prepare('INSERT INTO teachers (user_id, title, school) VALUES (?, ?, ?)').run(teacherUserId, '高中语文教师', 'TEST 中学').lastInsertRowid;
  const studentId = database.prepare('INSERT INTO students (user_id, student_no, grade, school) VALUES (?, ?, ?, ?)').run(studentUserId, 'T1001', '高二', 'TEST 中学').lastInsertRowid;
  const classId = database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)').run('TEST 高二1班', '高二', teacherId).lastInsertRowid;
  database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(classId, studentId);
  const assignmentId = database.prepare('INSERT INTO assignments (class_id, title, prompt, essay_type, full_score) VALUES (?, ?, ?, ?, ?)').run(classId, 'TEST 责任', '请写作文', '材料作文', 60).lastInsertRowid;
  const essayId = database.prepare('INSERT INTO essays (assignment_id, student_id, title, original_text, grading_status, status) VALUES (?, ?, ?, ?, ?, ?)').run(assignmentId, studentId, 'TEST 作文', '正文', 'pending', 'submitted').lastInsertRowid;
  saveEssayReviewVersion(database, {
    essayId,
    review: {
      total_score: 48,
      level: '二类文',
      strengths: ['观点明确'],
      problems: ['论证不足'],
      suggestions: ['补充事例'],
      teacherReview: { status: 'draft', comment: '初稿', finalScore: 50 }
    },
    promptText: '请按 60 分制批改',
    promptMode: 'latest',
    reportVersion: '2.0',
    model: 'deepseek-chat',
    sourceType: 'web',
    createdByUserId: String(teacherUserId),
    createdByRole: 'teacher',
    gradingJobId: 'job-1'
  });
  return { database, essayId, teacherId };
}

function seedArchive(appDir) {
  writeJson(path.join(appDir, 'data/archive-records.json'), {
    version: 1,
    records: [
      {
        id: 'archive-1',
        studentId: '20260301',
        studentName: '许伟航',
        className: '3班',
        grade: '高二',
        schoolYear: '2026',
        essayTitle: '青年责任',
        createdAt: '2026-07-12T08:00:00.000Z',
        provider: 'deepseek',
        model: 'deepseek-chat',
        score: 48,
        maxScore: 60,
        gradeText: '二类文',
        archiveStatus: 'archived',
        nasPath: 'Archive/3班/20260301_许伟航/2026/2026-07/青年责任',
        files: [
          { name: 'report.md', remotePath: 'Archive/3班/20260301_许伟航/report.md', contentType: 'text/markdown' },
          { name: 'report.docx', remotePath: 'Archive/3班/20260301_许伟航/report.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
          { name: 'report.pdf', remotePath: 'Archive/3班/20260301_许伟航/report.pdf', contentType: 'application/pdf' }
        ]
      },
      {
        id: 'archive-2',
        studentId: '20260302',
        studentName: '许伟航',
        className: '3班',
        grade: '高二',
        schoolYear: '2026',
        essayTitle: '时代选择',
        createdAt: '2026-07-13T08:00:00.000Z',
        provider: 'deepseek',
        model: 'deepseek-chat',
        score: 54,
        maxScore: 60,
        level: '一类文',
        archiveStatus: 'archived',
        nasPath: 'Archive/3班/20260302_许伟航/2026/2026-07/时代选择',
        files: []
      }
    ]
  });
}

function seedProfiles(appDir) {
  const base = path.join(appDir, 'data/student-profiles/3班');
  writeJson(path.join(base, '20260301_许伟航/profile.json'), {
    studentKey: '20260301_许伟航',
    studentId: '20260301',
    studentName: '许伟航',
    className: '3班',
    grade: '高二',
    essayCount: 1,
    averageScore: 48,
    latestScore: 48,
    scoreTrend: 'up',
    weakestAbility: '逻辑论证',
    latestEssayAt: '2026-07-12T08:00:00.000Z',
    lastUpdatedAt: '2026-07-12T08:30:00.000Z'
  });
  writeJson(path.join(base, '20260301_许伟航/archive-index.json'), {
    items: [{ archiveId: 'archive-1', score: 48, maxScore: 60, essayTitle: '青年责任', createdAt: '2026-07-12T08:00:00.000Z' }]
  });
  writeJson(path.join(base, '20260302_许伟航/profile.json'), {
    studentKey: '20260302_许伟航',
    studentId: '20260302',
    studentName: '许伟航',
    className: '3班',
    grade: '高二',
    essayCount: 1,
    averageScore: 54,
    latestScore: 54,
    scoreTrend: 'stable',
    weakestAbility: '素材运用',
    latestEssayAt: '2026-07-13T08:00:00.000Z',
    lastUpdatedAt: '2026-07-13T08:30:00.000Z'
  });
}

test('teacher management rebuild links archives, profiles, classes and dashboard without duplicating records', async () => {
  const appDir = tempAppDir();
  seedArchive(appDir);
  seedProfiles(appDir);

  assert.equal(generateClassKey({ schoolYear: '2026', grade: '高二', className: '3班' }), '2026_高二_3班');
  const result = await rebuildTeacherManagement({ appDir });
  assert.equal(result.classesRebuilt, 1);
  assert.equal(result.studentsLinked, 2);
  assert.equal(result.essaysLinked, 2);
  assert.equal(result.recordsSkipped, 0);

  const classes = listClasses(appDir, { keyword: '3班' });
  assert.equal(classes.total, 1);
  assert.equal(classes.items[0].classKey, '2026_高二_3班');
  assert.equal(classes.items[0].studentCount, 2);
  assert.equal(classes.items[0].essayCount, 2);
  assert.equal(classes.items[0].averageScore, 51);

  const students = listStudents(appDir, { keyword: '许伟航' });
  assert.equal(students.total, 2);
  assert.notEqual(students.items[0].studentKey, students.items[1].studentKey);

  const dashboard = getTeacherDashboard({ appDir, aiStatus: { deepseekReady: true }, nasStatus: { connected: true } });
  assert.equal(dashboard.classes.total, 1);
  assert.equal(dashboard.students.total, 2);
  assert.equal(dashboard.essays.total, 2);
  assert.equal(dashboard.services.deepseek, 'healthy');
  assert.equal(dashboard.services.nas, 'healthy');
});

test('classes and students support create, archive, restore and transfer while keeping history', async () => {
  const appDir = tempAppDir();
  const klass = createClass(appDir, { schoolYear: '2026', grade: '高二', className: '4班', teacherId: 't1', teacherName: '陈老师' });
  assert.equal(klass.classKey, '2026_高二_4班');
  assert.throws(() => createClass(appDir, { schoolYear: '2026', grade: '高二', className: '4班' }), /班级已存在/);
  assert.equal(archiveClass(appDir, klass.classKey).status, 'archived');
  assert.equal(restoreClass(appDir, klass.classKey).status, 'active');

  const student = createStudent(appDir, { studentId: '20260401', studentName: '林同学', classKey: klass.classKey, className: '4班', grade: '高二', schoolYear: '2026' });
  assert.equal(student.studentKey, '20260401_林同学');
  const target = createClass(appDir, { schoolYear: '2026', grade: '高二', className: '5班' });
  const moved = transferStudent(appDir, student.studentKey, { targetClassKey: target.classKey, effectiveAt: '2026-07-15', reason: '转班' });
  assert.equal(moved.classKey, target.classKey);
  assert.equal(moved.transferHistory.length, 1);
  assert.equal(archiveStudent(appDir, student.studentKey).status, 'archived');
  assert.equal(restoreStudent(appDir, student.studentKey).status, 'active');
});

test('teacher import, comments, tasks, exports, audit and retry queue are safe and idempotent', async () => {
  const appDir = tempAppDir();
  seedArchive(appDir);
  seedProfiles(appDir);
  await rebuildTeacherManagement({ appDir });
  const classKey = '2026_高二_3班';

  const dryRun = importStudents(appDir, classKey, {
    dryRun: true,
    fileName: 'students.csv',
    content: 'studentId,studentName,gender,className,grade,schoolYear\n20260303,=危险公式,男,3班,高二,2026\n20260301,重复,女,3班,高二,2026\n,缺学号,女,3班,高二,2026'
  });
  assert.equal(dryRun.created, 0);
  assert.equal(dryRun.validRows, 1);
  assert.ok(dryRun.rows[0].studentName.startsWith("'="));
  assert.ok(dryRun.errors.some((item) => item.reason.includes('重复学号')));
  assert.ok(dryRun.errors.some((item) => item.reason.includes('studentId')));

  const imported = importStudents(appDir, classKey, {
    dryRun: false,
    fileName: 'students.csv',
    content: 'studentId,studentName,gender,className,grade,schoolYear\n20260303,吴同学,男,3班,高二,2026\n20260301,重复,女,3班,高二,2026'
  });
  assert.equal(imported.created, 1);
  assert.equal(listStudents(appDir, { classKey }).total, 3);

  const comment = addTeacherComment(appDir, 'archive-1', { teacherId: 't1', teacherName: '陈老师', overallComment: '保留优点，强化论证。', revisedScore: 50, visibleToStudent: true });
  const updated = addTeacherComment(appDir, 'archive-1', { commentId: comment.commentId, teacherId: 't1', overallComment: '第二版点评。' });
  assert.equal(updated.version, 2);
  assert.equal(listTeacherComments(appDir, 'archive-1').items.length, 1);

  const essays = listTeacherEssays(appDir, { classKey, scoreMin: 45, scoreMax: 60 });
  assert.equal(essays.total, 2);
  assert.equal(essays.items[0].nasArchiveStatus, 'archived');
  assert.ok(essays.items[0].downloadFiles.some((item) => item.name === 'report.md'));

  const tasks = listTeacherTasks(appDir, { status: 'completed' });
  assert.equal(tasks.items.length, 2);

  const csv = await exportTeacherData(appDir, { type: 'students', format: 'csv', classKey, actorId: 't1' });
  assert.equal(csv.format, 'csv');
  assert.ok(fs.existsSync(csv.filePath));
  const pdf = await exportTeacherData(appDir, { type: 'class_report', format: 'pdf', classKey, actorId: 't1' });
  assert.equal(pdf.format, 'pdf');
  assert.ok(fs.statSync(pdf.filePath).size > 1000);
  const docx = await exportTeacherData(appDir, { type: 'class_report', format: 'docx', classKey, actorId: 't1' });
  assert.equal(docx.format, 'docx');
  const xlsx = await exportTeacherData(appDir, { type: 'students', format: 'xlsx', classKey, actorId: 't1' });
  assert.equal(xlsx.format, 'xlsx');

  const retry = retryPendingManagementTasks(appDir);
  assert.equal(retry.pending, 0);
  const audit = fs.readFileSync(path.join(appDir, 'logs/audit.log'), 'utf8');
  assert.ok(audit.includes('teacher.comment.upsert'));
  assert.doesNotMatch(audit, /Bearer|sk-|password|Authorization/i);
});

test('teacher review draft and submit update the latest ai review and persist teacher comment history', () => {
  const { database, essayId, teacherId } = createReviewDb();
  const draft = saveTeacherReview(database, {
    essayId,
    teacherId: String(teacherId),
    teacherRole: 'teacher',
    teacherReview: {
      status: 'draft',
      finalScore: 52,
      comment: '保留结构，强化论证。',
      strengths: ['观点明确', '语言顺畅'],
      weaknesses: ['论证偏浅'],
      suggestions: ['补充反方分析']
    }
  });
  assert.equal(draft.raw_json.teacherReview.status, 'draft');
  assert.equal(draft.raw_json.teacherReview.finalScore, 52);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM teacher_comments WHERE essay_id = ?').get(essayId).count, 0);

  const submitted = saveTeacherReview(database, {
    essayId,
    teacherId: String(teacherId),
    teacherRole: 'teacher',
    teacherReview: {
      status: 'submitted',
      finalScore: 55,
      comment: '修改后更完整。',
      strengths: ['观点明确'],
      weaknesses: ['举例不足'],
      suggestions: ['补充具体案例']
    }
  });
  assert.equal(submitted.raw_json.teacherReview.status, 'submitted');
  assert.equal(submitted.raw_json.teacherReview.finalScore, 55);
  const commentRow = database.prepare('SELECT * FROM teacher_comments WHERE essay_id = ? ORDER BY id DESC LIMIT 1').get(essayId);
  assert.equal(commentRow.teacher_id, teacherId);
  assert.equal(commentRow.comment, '修改后更完整。');
  assert.equal(Number(commentRow.score_adjustment), 7);
});
