import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { schemaSql } from '../src/db/schema.js';
import {
  applyP2FeishuWorkbenchMigration,
  rollbackP2FeishuWorkbenchMigration
} from '../src/db/migrations/20260713_p2_feishu_workbench.js';
import {
  bindClassToFeishuGroup,
  bindTeacherWithCode,
  createTeacherBindingCode,
  getTeacherWorkbenchSummary,
  recordFeishuAction,
  recordFeishuCardInteraction
} from '../src/services/feishu-workbench.js';
import { buildTeacherBindingRequiredCard, buildTeacherWorkbenchCard } from '../src/integrations/feishu/cards.js';
import { parseFeishuCommand } from '../src/integrations/feishu/commands.js';

function createFixtureDb() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(schemaSql);
  applyP2FeishuWorkbenchMigration(database);

  const addUser = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
  const adminUserId = addUser.run('admin-test', 'unused', 'admin', 'TEST 管理员').lastInsertRowid;
  const teacherUserId = addUser.run('teacher-test', 'unused', 'teacher', 'TEST 陈老师').lastInsertRowid;
  const otherTeacherUserId = addUser.run('teacher-other', 'unused', 'teacher', 'TEST 李老师').lastInsertRowid;
  const studentUserIds = [
    addUser.run('student-a', 'unused', 'student', 'TEST 学生A').lastInsertRowid,
    addUser.run('student-b', 'unused', 'student', 'TEST 学生B').lastInsertRowid,
    addUser.run('student-c', 'unused', 'student', 'TEST 学生C').lastInsertRowid
  ];

  const teacherId = database.prepare('INSERT INTO teachers (user_id, title, school) VALUES (?, ?, ?)').run(teacherUserId, '高中语文教师', 'TEST 中学').lastInsertRowid;
  const otherTeacherId = database.prepare('INSERT INTO teachers (user_id, title, school) VALUES (?, ?, ?)').run(otherTeacherUserId, '高中语文教师', 'TEST 中学').lastInsertRowid;
  const classId = database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)').run('TEST 高二1班', '高二', teacherId).lastInsertRowid;
  const otherClassId = database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)').run('TEST 高二2班', '高二', otherTeacherId).lastInsertRowid;
  const studentIds = studentUserIds.map((userId, index) => {
    const id = database.prepare('INSERT INTO students (user_id, student_no, grade, school) VALUES (?, ?, ?, ?)').run(userId, `T00${index + 1}`, '高二', 'TEST 中学').lastInsertRowid;
    database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(classId, id);
    return id;
  });
  const today = new Date().toISOString().slice(0, 10);
  const assignmentId = database.prepare(`
    INSERT INTO assignments
      (class_id, public_id, title, prompt, essay_type, full_score, deadline, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(classId, 'TEST-G2-001', 'TEST 青年责任', '写一篇关于青年责任的作文。', '材料作文', 60, `${today}T20:00:00`, 'published').lastInsertRowid;
  database.prepare(`
    INSERT INTO essays (assignment_id, student_id, title, original_text, grading_status, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(assignmentId, studentIds[0], '待批改作文', '正文', 'pending', 'submitted');
  database.prepare(`
    INSERT INTO essays (assignment_id, student_id, title, original_text, grading_status, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(assignmentId, studentIds[1], '待审核作文', '正文', 'graded', 'submitted');

  return {
    database,
    adminUser: { id: adminUserId, role: 'admin', name: 'TEST 管理员' },
    teacherUser: { id: teacherUserId, role: 'teacher', name: 'TEST 陈老师' },
    studentUser: { id: studentUserIds[0], role: 'student', name: 'TEST 学生A' },
    teacherId,
    otherTeacherId,
    classId,
    otherClassId,
    assignmentId
  };
}

test('P2 Feishu workbench migration creates required tables and can roll back P2-only tables', () => {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(schemaSql);

  applyP2FeishuWorkbenchMigration(database);

  for (const tableName of [
    'schema_migrations',
    'feishu_teacher_bindings',
    'feishu_action_logs',
    'feishu_message_logs',
    'feishu_card_interactions',
    'feishu_teacher_binding_codes'
  ]) {
    const row = database.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', tableName);
    assert.equal(row?.name, tableName);
  }

  const classColumns = database.prepare("PRAGMA table_info('feishu_class_bindings')").all().map((column) => column.name);
  assert.ok(classColumns.includes('tenant_key'));
  assert.ok(classColumns.includes('last_tested_at'));
  assert.ok(classColumns.includes('last_test_status'));

  const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name);
  assert.ok(indexes.includes('idx_feishu_teacher_bindings_open_id'));
  assert.ok(indexes.includes('idx_feishu_action_logs_request_id'));
  assert.ok(indexes.includes('idx_feishu_card_interactions_event_id'));

  rollbackP2FeishuWorkbenchMigration(database);

  const removed = database.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', 'feishu_teacher_bindings');
  assert.equal(removed, undefined);
  const legacy = database.prepare('SELECT name FROM sqlite_master WHERE type = ? AND name = ?').get('table', 'feishu_class_bindings');
  assert.equal(legacy?.name, 'feishu_class_bindings');
});

test('teacher binding code is one-time hashed short-lived and creates active binding', () => {
  const fixture = createFixtureDb();
  const created = createTeacherBindingCode(fixture.database, {
    teacherId: fixture.teacherId,
    createdBy: String(fixture.adminUser.id),
    now: '2026-07-13T08:00:00.000Z'
  });

  assert.match(created.code, /^TCH-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const saved = fixture.database.prepare('SELECT * FROM feishu_teacher_binding_codes WHERE id = ?').get(created.id);
  assert.notEqual(saved.code_hash, created.code);
  assert.equal(saved.used_at, null);

  const invalid = bindTeacherWithCode(fixture.database, {
    code: 'TCH-XXXX-XXXX',
    feishuOpenId: 'ou_teacher',
    feishuUnionId: 'on_teacher',
    tenantKey: 'tenant-a',
    now: '2026-07-13T08:01:00.000Z'
  });
  assert.equal(invalid.status, 400);

  const bound = bindTeacherWithCode(fixture.database, {
    code: created.code,
    feishuOpenId: 'ou_teacher',
    feishuUnionId: 'on_teacher',
    tenantKey: 'tenant-a',
    now: '2026-07-13T08:02:00.000Z'
  });
  assert.equal(bound.status, 200);
  assert.equal(bound.binding.teacher_id, fixture.teacherId);
  assert.equal(bound.binding.status, 'active');

  const reused = bindTeacherWithCode(fixture.database, {
    code: created.code,
    feishuOpenId: 'ou_teacher_2',
    feishuUnionId: 'on_teacher_2',
    tenantKey: 'tenant-a',
    now: '2026-07-13T08:03:00.000Z'
  });
  assert.equal(reused.status, 409);
});

test('class Feishu group binding enforces teacher ownership, primary group and audit idempotency', () => {
  const fixture = createFixtureDb();

  const first = bindClassToFeishuGroup(fixture.database, {
    user: fixture.teacherUser,
    classId: fixture.classId,
    feishuChatId: 'oc_test_primary',
    feishuChatName: 'TEST 高二1班作文群',
    tenantKey: 'tenant-a',
    isPrimary: true,
    requestId: 'req-bind-1'
  });
  assert.equal(first.status, 200);
  assert.equal(first.binding.is_primary, 1);

  const repeated = bindClassToFeishuGroup(fixture.database, {
    user: fixture.teacherUser,
    classId: fixture.classId,
    feishuChatId: 'oc_test_primary',
    feishuChatName: 'TEST 高二1班作文群',
    tenantKey: 'tenant-a',
    isPrimary: true,
    requestId: 'req-bind-1'
  });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.idempotent, true);

  const second = bindClassToFeishuGroup(fixture.database, {
    user: fixture.teacherUser,
    classId: fixture.classId,
    feishuChatId: 'oc_test_backup',
    feishuChatName: 'TEST 高二1班备用群',
    tenantKey: 'tenant-a',
    isPrimary: true,
    requestId: 'req-bind-2'
  });
  assert.equal(second.status, 200);
  const oldPrimary = fixture.database.prepare('SELECT is_primary FROM feishu_class_bindings WHERE feishu_chat_id = ?').get('oc_test_primary');
  assert.equal(oldPrimary.is_primary, 0);

  const forbidden = bindClassToFeishuGroup(fixture.database, {
    user: fixture.teacherUser,
    classId: fixture.otherClassId,
    feishuChatId: 'oc_other',
    feishuChatName: 'TEST 其他班群',
    tenantKey: 'tenant-a',
    requestId: 'req-bind-3'
  });
  assert.equal(forbidden.status, 403);

  const actionCount = fixture.database.prepare('SELECT COUNT(*) AS count FROM feishu_action_logs WHERE action = ?').get('class_group_bind').count;
  assert.equal(actionCount, 2);
});

test('workbench summary and card use real teacher data without leaking internal ids', () => {
  const fixture = createFixtureDb();
  bindClassToFeishuGroup(fixture.database, {
    user: fixture.teacherUser,
    classId: fixture.classId,
    feishuChatId: 'oc_test_primary',
    feishuChatName: 'TEST 高二1班作文群',
    tenantKey: 'tenant-a',
    isPrimary: true,
    requestId: 'req-workbench-bind'
  });
  fixture.database.prepare(`
    INSERT INTO feishu_teacher_bindings
      (teacher_id, feishu_open_id, feishu_union_id, tenant_key, status, verified_at)
    VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP)
  `).run(fixture.teacherId, 'ou_teacher', 'on_teacher', 'tenant-a');

  const summary = getTeacherWorkbenchSummary(fixture.database, {
    feishuOpenId: 'ou_teacher',
    tenantKey: 'tenant-a'
  });
  assert.equal(summary.status, 200);
  assert.equal(summary.teacherName, 'TEST 陈老师');
  assert.equal(summary.classCount, 1);
  assert.equal(summary.boundGroupCount, 1);
  assert.equal(summary.todayDueAssignments, 1);
  assert.equal(summary.pendingGradingCount, 1);
  assert.equal(summary.pendingReviewCount, 1);
  assert.equal(summary.missingStudentCount, 1);

  const card = buildTeacherWorkbenchCard(summary, { publicOrigin: 'https://pi.zhenwanyue.icu' });
  const text = JSON.stringify(card);
  assert.match(text, /教师工作台/);
  assert.match(text, /TEST 陈老师/);
  assert.match(text, /新建作文任务/);
  assert.match(text, /我的班级/);
  assert.match(text, /提交进度/);
  assert.match(text, /待审核报告/);
  assert.match(text, /AI 备课：建设中/);
  assert.doesNotMatch(text, /teacher_id|feishu_open_id|\/Users\/|App Secret|Access Token/);
});

test('unbound teacher workbench returns binding-required card and card interactions are idempotent', () => {
  const fixture = createFixtureDb();
  const summary = getTeacherWorkbenchSummary(fixture.database, {
    feishuOpenId: 'ou_unbound',
    tenantKey: 'tenant-a'
  });
  assert.equal(summary.status, 401);

  const card = buildTeacherBindingRequiredCard({ publicOrigin: 'https://pi.zhenwanyue.icu' });
  assert.match(JSON.stringify(card), /绑定教师身份/);
  assert.match(JSON.stringify(card), /一次性教师绑定码/);

  const first = recordFeishuCardInteraction(fixture.database, {
    eventId: 'evt-card-1',
    operatorOpenId: 'ou_unbound',
    actionName: 'open_workbench',
    resourceType: 'workbench',
    resourceId: 'teacher',
    idempotencyKey: 'card:evt-card-1:open_workbench'
  });
  const repeated = recordFeishuCardInteraction(fixture.database, {
    eventId: 'evt-card-1',
    operatorOpenId: 'ou_unbound',
    actionName: 'open_workbench',
    resourceType: 'workbench',
    resourceId: 'teacher',
    idempotencyKey: 'card:evt-card-1:open_workbench'
  });
  assert.equal(first.id, repeated.id);
});

test('/workbench and natural language workbench commands are recognized', () => {
  assert.equal(parseFeishuCommand('/workbench').key, 'workbench');
  assert.equal(parseFeishuCommand('教师工作台').key, 'workbench');
  assert.equal(parseFeishuCommand('打开教师工作台').key, 'workbench');
  assert.equal(parseFeishuCommand('我的工作台').key, 'workbench');
  assert.equal(parseFeishuCommand('查看我的班级').key, 'workbench');
});

test('action logs are idempotent by request id and keep only sanitized details', () => {
  const fixture = createFixtureDb();
  const first = recordFeishuAction(fixture.database, {
    actorType: 'teacher',
    actorId: String(fixture.teacherId),
    feishuOpenId: 'ou_teacher',
    action: 'open_workbench',
    resourceType: 'workbench',
    resourceId: 'teacher',
    requestId: 'req-workbench-1',
    status: 'success',
    details: { note: 'ok', appSecret: 'should-not-save', essayText: '完整作文不应保存' }
  });
  const repeated = recordFeishuAction(fixture.database, {
    actorType: 'teacher',
    actorId: String(fixture.teacherId),
    feishuOpenId: 'ou_teacher',
    action: 'open_workbench',
    resourceType: 'workbench',
    resourceId: 'teacher',
    requestId: 'req-workbench-1',
    status: 'success'
  });

  assert.equal(first.id, repeated.id);
  const saved = fixture.database.prepare('SELECT details FROM feishu_action_logs WHERE id = ?').get(first.id);
  assert.doesNotMatch(saved.details, /should-not-save|完整作文不应保存/);
});
