import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildLegacyCleanupDryRun,
  ensureSystemTestFixture
} from '../src/services/legacy-cleanup.js';
import {
  getTeacherDashboard,
  listClasses,
  listStudents
} from '../src/services/teacher-management/teacher-management-service.js';

function tempAppDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-cleanup-'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function seedTeacherManagementStore(appDir) {
  writeJson(path.join(appDir, 'data/teacher-management/classes.json'), {
    version: '1.0',
    items: [
      {
        classKey: '2026_高三_旧班级A',
        className: '旧班级A',
        grade: '高三',
        schoolYear: '2026',
        studentCount: 0,
        essayCount: 0,
        averageScore: null,
        excellentRate: null,
        passingRate: null,
        latestSubmittedAt: '',
        status: 'active',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z'
      },
      {
        classKey: '2026_高三_旧班级B',
        className: '旧班级B',
        grade: '高三',
        schoolYear: '2026',
        studentCount: 1,
        essayCount: 1,
        averageScore: 48,
        excellentRate: 0,
        passingRate: 1,
        latestSubmittedAt: '2026-07-02T00:00:00.000Z',
        status: 'active',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z'
      }
    ]
  });
  writeJson(path.join(appDir, 'data/teacher-management/students.json'), {
    version: '1.0',
    items: [
      {
        studentKey: 'empty_student_旧学生A',
        studentId: 'EMPTY001',
        studentName: '旧学生A',
        classKey: '',
        className: '',
        grade: '高三',
        schoolYear: '2026',
        status: 'active',
        essayCount: 0,
        averageScore: null,
        latestScore: null,
        scoreTrend: '',
        weakestAbility: '',
        latestEssayAt: '',
        profileUpdatedAt: '',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        transferHistory: []
      },
      {
        studentKey: 'history_student_旧学生B',
        studentId: 'HIS001',
        studentName: '旧学生B',
        classKey: '2026_高三_旧班级B',
        className: '旧班级B',
        grade: '高三',
        schoolYear: '2026',
        status: 'active',
        essayCount: 2,
        averageScore: 48,
        latestScore: 48,
        scoreTrend: 'stable',
        weakestAbility: '',
        latestEssayAt: '2026-07-02T00:00:00.000Z',
        profileUpdatedAt: '2026-07-02T00:00:00.000Z',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
        transferHistory: []
      }
    ]
  });
  writeJson(path.join(appDir, 'data/teacher-management/essays.json'), {
    version: '1.0',
    items: [
      {
        archiveId: 'archive-history-001',
        classKey: '2026_高三_旧班级B',
        studentKey: 'history_student_旧学生B',
        studentId: 'HIS001',
        studentName: '旧学生B',
        className: '旧班级B',
        essayTitle: '历史作文',
        score: 48,
        maxScore: 60,
        normalizedScore: 80,
        level: '二类文',
        provider: 'deepseek',
        model: 'deepseek-chat',
        gradingStatus: 'graded',
        nasArchiveStatus: 'archived',
        profileStatus: 'updated',
        nasPath: 'Archive/旧班级B/HIS001_旧学生B/2026/2026-07/历史作文',
        latestSyncedAt: '2026-07-02T00:00:00.000Z',
        queueStatus: 'synced',
        submittedAt: '2026-07-02T00:00:00.000Z',
        wordCount: 120,
        downloadFiles: [],
        teacherReviewed: true,
        teacherCommentCount: 1,
        source: 'archive',
        feishuSource: ''
      }
    ]
  });
  writeJson(path.join(appDir, 'data/teacher-management/tasks.json'), {
    version: '1.0',
    items: [
      {
        taskId: 'task-history-001',
        archiveId: 'archive-history-001',
        studentKey: 'history_student_旧学生B',
        classKey: '2026_高三_旧班级B',
        essayTitle: '历史作文',
        status: 'completed',
        provider: 'deepseek',
        progress: 100,
        createdAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
        errorCode: null,
        retryCount: 0,
        nasPath: 'Archive/旧班级B/HIS001_旧学生B/2026/2026-07/历史作文'
      }
    ]
  });
  writeJson(path.join(appDir, 'data/teacher-management/teacher-comments.json'), {
    version: '1.0',
    items: [
      {
        commentId: 'comment-history-001',
        archiveId: 'archive-history-001',
        teacherId: 'teacher-test',
        teacherName: '测试教师',
        overallComment: '测试点评',
        revisedScore: 50,
        revisedLevel: '二类文',
        keyAnnotations: [],
        trainingAdvice: [],
        visibleToStudent: true,
        version: 1,
        history: [],
        feishuSendStatus: 'pending',
        createdAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z'
      }
    ]
  });
}

test('system test fixture can be reset without touching legacy data', () => {
  const appDir = tempAppDir();
  seedTeacherManagementStore(appDir);

  const result = ensureSystemTestFixture(appDir);
  assert.equal(result.ok, true);
  assert.equal(result.fixture.class.isTestData, true);
  assert.equal(result.fixture.student.isTestData, true);

  const classes = listClasses(appDir, { scope: 'system_test' });
  const students = listStudents(appDir, { scope: 'system_test' });
  assert.equal(classes.total, 1);
  assert.equal(students.total, 1);
  assert.equal(classes.items[0].className, '系统测试班');
  assert.equal(students.items[0].studentName, '测试学生');

  const dashboard = getTeacherDashboard({ appDir, aiStatus: { deepseekReady: true }, nasStatus: { connected: true } });
  assert.equal(dashboard.classes.visible, 1);
  assert.equal(dashboard.students.visible, 1);
});

test('legacy cleanup dry-run separates keep, archive, logical delete and physical delete candidates', () => {
  const appDir = tempAppDir();
  seedTeacherManagementStore(appDir);
  ensureSystemTestFixture(appDir);

  const report = buildLegacyCleanupDryRun({ appDir });
  assert.equal(report.teacherManagement.totals.testClasses >= 1, true);
  assert.equal(report.teacherManagement.totals.testStudents >= 1, true);
  assert.ok(report.keep.some((item) => item.name === '系统测试班'));
  assert.ok(report.archive.some((item) => item.className === '旧班级B'));
  assert.ok(report.logicalDelete.some((item) => item.studentName === '旧学生B'));
  assert.ok(report.physicalDelete.some((item) => item.name === '旧班级A' || item.className === '旧班级A'));
});
