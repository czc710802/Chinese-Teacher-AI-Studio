import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  buildLegacyCleanupDryRun,
  buildSystemTestCenterSnapshot,
  ensureSystemTestFixture
} from '../src/services/legacy-cleanup.js';
import { resetSystemTestEnvironment, getTestEnvironmentStatus } from '../src/services/test-environment.js';
import { schemaSql } from '../src/db/schema.js';
import { applyP3MobileClassLifecycleMigration } from '../src/db/migrations/20260715_p3_mobile_class_lifecycle.js';
import { listClasses, listStudents } from '../src/services/teacher-management/teacher-management-service.js';

function tempAppDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-cleanup-'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function seedTeacherManagementStore(appDir, { markAsTestData = false } = {}) {
  const scopeFields = markAsTestData ? { isTestData: true, dataScope: 'system_test', testScope: 'system' } : {};
  writeJson(path.join(appDir, 'data/teacher-management/classes.json'), {
    version: '1.0',
    items: [
      {
        classKey: '2026_高三_旧班级A',
        className: '旧班级A',
        grade: '高三',
        schoolYear: '2026',
        ...scopeFields,
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
        ...scopeFields,
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
        ...scopeFields,
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
        ...scopeFields,
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
        ...scopeFields,
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
        ...scopeFields,
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
        ...scopeFields,
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

function seedResetDatabase(appDir) {
  const databasePath = path.join(appDir, 'data/essay-review.sqlite');
  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(schemaSql);
  applyP3MobileClassLifecycleMigration(database);
  const addUser = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
  const teacherUserId = addUser.run('teacher-reset', '123456', 'teacher', '测试教师').lastInsertRowid;
  const studentUserId = addUser.run('student-reset', '123456', 'student', '测试学生').lastInsertRowid;
  const teacherId = database.prepare('INSERT INTO teachers (user_id, title, school) VALUES (?, ?, ?)').run(teacherUserId, '高中语文教师', '测试中学').lastInsertRowid;
  const studentId = database.prepare('INSERT INTO students (user_id, student_no, grade, school, data_scope) VALUES (?, ?, ?, ?, ?)').run(studentUserId, 'T001', '高二', '测试中学', 'system_test').lastInsertRowid;
  const classId = database.prepare('INSERT INTO classes (name, grade, teacher_id, data_scope, invite_code, join_mode, status, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
    .run('旧测试班', '高二', teacherId, 'system_test', 'TEST-OLD-001', 'approval', 'active').lastInsertRowid;
  database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(classId, studentId);
  const assignmentId = database.prepare('INSERT INTO assignments (class_id, title, prompt, essay_type, full_score, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(classId, '旧测试作文', '写作文', '材料作文', 60, 'published').lastInsertRowid;
  const essayId = database.prepare('INSERT INTO essays (assignment_id, student_id, title, original_text, grading_status, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(assignmentId, studentId, '旧测试作文', '正文', 'graded', 'submitted').lastInsertRowid;
  database.prepare('INSERT INTO ai_reviews (essay_id, total_score, level, dimension_scores, strengths, problems, paragraph_comments, editable_sentences, suggestions, upgraded_paragraph, good_sentences, next_training, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(essayId, 48, '二类文', '[]', '[]', '[]', '[]', '[]', '[]', '', '[]', '[]', '{}');
  database.close();
}

test('system test fixture can be reset without touching legacy data', () => {
  const appDir = tempAppDir();
  seedTeacherManagementStore(appDir);

  const result = ensureSystemTestFixture(appDir);
  assert.equal(result.ok, true);
  assert.equal(result.fixture.class.isTestData, true);
  assert.equal(result.fixture.student, null);

  const classes = listClasses(appDir, { scope: 'system_test' });
  const students = listStudents(appDir, { scope: 'system_test' });
  assert.equal(classes.total, 1);
  assert.equal(students.total, 0);
  assert.equal(classes.items[0].className, '系统测试班');
});

test('legacy cleanup dry-run separates keep, archive, logical delete and physical delete candidates', () => {
  const appDir = tempAppDir();
  seedTeacherManagementStore(appDir);
  ensureSystemTestFixture(appDir);

  const report = buildLegacyCleanupDryRun({ appDir });
  assert.equal(report.teacherManagement.totals.testClasses >= 1, true);
  assert.equal(report.teacherManagement.totals.testStudents, 0);
  assert.ok(report.keep.some((item) => item.name === '系统测试班'));
});

test('test environment reset clears legacy data and rebuilds an empty system test class', () => {
  const appDir = tempAppDir();
  seedTeacherManagementStore(appDir);
  seedResetDatabase(appDir);

  const database = new DatabaseSync(path.join(appDir, 'data/essay-review.sqlite'));
  database.exec('PRAGMA foreign_keys = ON');
  const result = resetSystemTestEnvironment({ appDir, database });
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.fixture.class.isTestData, true);
  assert.equal(result.snapshot.fixture.student, null);
  assert.equal(result.snapshot.report.teacherManagement.totals.testClasses >= 1, true);
  assert.equal(result.snapshot.report.teacherManagement.totals.testStudents, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM classes').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM students').get().count, 0);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM essays').get().count, 0);

  const status = getTestEnvironmentStatus({ appDir, database });
  assert.equal(status.snapshot.fixture.class.isTestData, true);
  database.close();
});

test('system test center snapshot reads the live invite from the database', () => {
  const appDir = tempAppDir();
  seedTeacherManagementStore(appDir);
  seedResetDatabase(appDir);

  const database = new DatabaseSync(path.join(appDir, 'data/essay-review.sqlite'));
  database.exec('PRAGMA foreign_keys = ON');
  const reset = resetSystemTestEnvironment({ appDir, database });
  assert.equal(reset.ok, true);
  const snapshot = buildSystemTestCenterSnapshot({ appDir, database });
  assert.equal(snapshot.fixture.class.isTestData, true);
  assert.equal(snapshot.fixture.class.studentCount, 0);
  assert.ok(snapshot.fixture.class.inviteCode);
  assert.match(snapshot.fixture.class.inviteUrl, /^https?:\/\/.+\/student-mobile\/join\?token=/);
  assert.match(snapshot.fixture.class.qrSvg, /<svg/);
  assert.doesNotMatch(snapshot.fixture.class.qrSvg, /\/student-mobile\/join\?token=/);
  const classId = snapshot.fixture.class.classId;
  assert.ok(classId);
  assert.match(snapshot.links.testClassDetail, new RegExp(`/teacher/classes/${classId}$`));
  assert.match(snapshot.links.testClassMembers, new RegExp(`/teacher/classes/${classId}/members$`));
  assert.match(snapshot.links.testClassRequests, new RegExp(`/teacher/join-requests\\?classId=${classId}$`));
  database.close();
});
