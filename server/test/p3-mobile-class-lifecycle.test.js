import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { schemaSql } from '../src/db/schema.js';
import { applyP3MobileClassLifecycleMigration, getP3MobileClassLifecycleMigrationId } from '../src/db/migrations/20260715_p3_mobile_class_lifecycle.js';
import {
  archiveLifecycleClass,
  createJoinRequest,
  createJoinRequestByCode,
  createLifecycleClass,
  getJoinPreview,
  getJoinPreviewByCode,
  getJoinRequestStatus,
  listStudentMobileAssignments,
  listStudentMobileClasses,
  approveJoinRequest,
  pauseClassMember,
  removeClassMember,
  restoreLifecycleClass,
  restoreClassMember,
  transferClassMember
} from '../src/services/class-lifecycle.js';

function createFixtureDb() {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(schemaSql);
  applyP3MobileClassLifecycleMigration(database);

  const addUser = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)');
  const teacherUserId = addUser.run('teacher', '123456', 'teacher', '陈老师').lastInsertRowid;
  const studentUserId = addUser.run('student', '123456', 'student', '赵同学').lastInsertRowid;
  const teacherId = database.prepare('INSERT INTO teachers (user_id, title, school) VALUES (?, ?, ?)').run(teacherUserId, '高级教师', '惠安一中').lastInsertRowid;
  const studentId = database.prepare('INSERT INTO students (user_id, student_no, grade, school) VALUES (?, ?, ?, ?)').run(studentUserId, '2026001', '高二', '惠安一中').lastInsertRowid;
  const classId = database.prepare('INSERT INTO classes (name, grade, teacher_id, invite_code, join_mode, status, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)')
    .run('高二1班', '高二', teacherId, 'JOIN-AAAAAA', 'approval', 'active').lastInsertRowid;
  database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(classId, studentId);
  const assignmentId = database.prepare(`
    INSERT INTO assignments (class_id, public_id, title, prompt, requirements, essay_type, full_score, status, deadline)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(classId, 'G2-20260715-001', '青年选择与时代责任', '围绕青年选择与时代责任写作。', '观点明确。', '材料作文', 60, 'published', '2030-01-01T00:00:00').lastInsertRowid;

  return {
    database,
    teacherUser: { id: teacherUserId, role: 'teacher' },
    studentUser: { id: studentUserId, role: 'student' },
    teacherId,
    studentId,
    classId,
    assignmentId
  };
}

test('p3 mobile class lifecycle migration registers lifecycle tables and migration id', () => {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(schemaSql);
  applyP3MobileClassLifecycleMigration(database);

  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  assert.ok(tables.includes('student_class_bindings'));
  assert.ok(tables.includes('class_invites'));
  assert.ok(tables.includes('class_join_requests'));
  assert.ok(tables.includes('class_membership_audit_logs'));
  const migration = database.prepare('SELECT id FROM schema_migrations WHERE id = ?').get(getP3MobileClassLifecycleMigrationId());
  assert.ok(migration);
});

test('teacher class lifecycle creates an invite token that join preview and join requests can resolve', () => {
  const fixture = createFixtureDb();
  const created = createLifecycleClass(fixture.database, fixture.teacherUser, {
    name: '高二2班',
    grade: '高二',
    join_mode: 'approval',
    max_students: 45
  });

  assert.equal(created.status, 200);
  assert.match(created.class.invite_url, /\/student-mobile\/join\?token=/);
  assert.match(created.class.qr_svg, /student-mobile\/join\?token=/);
  assert.ok(created.inviteToken.startsWith('join_'));

  const preview = getJoinPreview(fixture.database, created.inviteToken);
  assert.equal(preview.status, 200);
  assert.equal(preview.class.name, '高二2班');
  assert.match(preview.class.invite_url, /\/student-mobile\/join\?token=/);

  const request = createJoinRequest(fixture.database, {
    token: created.inviteToken,
    studentName: '赵同学',
    studentNo: '2026001',
    source: 'student-mobile'
  });

  assert.equal(request.status, 200);
  assert.equal(request.request.status, 'pending');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM class_students WHERE class_id = ?').get(created.class.id).count, 0);
});

test('approval and archive restore flows preserve membership and student mobile visibility', () => {
  const fixture = createFixtureDb();
  const created = createLifecycleClass(fixture.database, fixture.teacherUser, {
    name: '高二3班',
    grade: '高二',
    join_mode: 'open',
    max_students: 40
  });

  const request = createJoinRequest(fixture.database, {
    token: created.inviteToken,
    studentName: '赵同学',
    studentNo: '2026001',
    source: 'student-mobile'
  });

  assert.equal(request.status, 200);
  assert.equal(request.request.status, 'approved');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM class_students WHERE class_id = ? AND student_id = ?').get(created.class.id, fixture.studentId).count, 1);

  const classesBeforeArchive = listStudentMobileClasses(fixture.database, fixture.studentUser).rows;
  assert.ok(classesBeforeArchive.some((row) => Number(row.id) === Number(created.class.id)));

  const assignmentRows = listStudentMobileAssignments(fixture.database, fixture.studentUser, created.class.id).rows;
  assert.equal(assignmentRows.length, 0);
  const joinedAssignmentId = fixture.database.prepare(`
    INSERT INTO assignments (class_id, public_id, title, prompt, requirements, essay_type, full_score, status, deadline)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(created.class.id, 'G2-20260715-002', '手机端任务', '围绕手机端学习闭环写作。', '提交后等待批改。', '材料作文', 60, 'published', '2030-01-01T00:00:00').lastInsertRowid;
  fixture.database.prepare('INSERT INTO essays (assignment_id, student_id, title, original_text) VALUES (?, ?, ?, ?)').run(joinedAssignmentId, fixture.studentId, '作文', '正文');
  assert.equal(listStudentMobileAssignments(fixture.database, fixture.studentUser, created.class.id).rows.length, 1);

  const archived = archiveLifecycleClass(fixture.database, fixture.teacherUser, created.class.id);
  assert.equal(archived.status, 200);
  assert.equal(archived.class.status, 'archived');

  const restored = restoreLifecycleClass(fixture.database, fixture.teacherUser, created.class.id);
  assert.equal(restored.status, 200);
  assert.equal(restored.class.status, 'active');
});

test('closed classes reject new join requests and avoid duplicate member bindings', () => {
  const fixture = createFixtureDb();
  const closed = createLifecycleClass(fixture.database, fixture.teacherUser, {
    name: '高二4班',
    grade: '高二',
    join_mode: 'closed',
    max_students: 30
  });

  const rejected = createJoinRequest(fixture.database, {
    token: closed.inviteToken,
    studentName: '赵同学',
    studentNo: '2026001',
    source: 'student-mobile'
  });

  assert.equal(rejected.status, 409);
  assert.match(rejected.message, /不接受新成员|不可加入/);
});

test('invite code join keeps a single pending request, supports status lookup and can be approved', () => {
  const fixture = createFixtureDb();
  const created = createLifecycleClass(fixture.database, fixture.teacherUser, {
    name: '高二5班',
    grade: '高二',
    join_mode: 'approval',
    max_students: 45
  });
  const invite = fixture.database.prepare('SELECT * FROM class_invites WHERE class_id = ? ORDER BY id DESC LIMIT 1').get(created.class.id);

  const preview = getJoinPreviewByCode(fixture.database, invite.invite_code);
  assert.equal(preview.status, 200);
  assert.equal(preview.class.name, '高二5班');

  const request = createJoinRequestByCode(fixture.database, {
    code: invite.invite_code,
    studentName: '赵同学',
    studentNo: '2026001',
    source: 'student-mobile'
  });
  assert.equal(request.status, 200);
  assert.equal(request.request.status, 'pending');

  const duplicate = createJoinRequestByCode(fixture.database, {
    code: invite.invite_code,
    studentName: '赵同学',
    studentNo: '2026001',
    source: 'student-mobile'
  });
  assert.equal(duplicate.status, 409);

  const status = getJoinRequestStatus(fixture.database, fixture.studentUser, request.request.id);
  assert.equal(status.status, 200);
  assert.equal(status.request.status, 'pending');

  const approved = approveJoinRequest(fixture.database, fixture.teacherUser, created.class.id, request.request.id);
  assert.equal(approved.status, 200);
  assert.equal(approved.request.status, 'approved');
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM student_class_bindings WHERE class_id = ? AND student_id = ? AND status = ?').get(created.class.id, fixture.studentId, 'active').count, 1);
});

test('teacher can pause, restore, remove and transfer memberships without deleting historical bindings', () => {
  const fixture = createFixtureDb();
  const source = createLifecycleClass(fixture.database, fixture.teacherUser, {
    name: '高二6班',
    grade: '高二',
    join_mode: 'approval',
    max_students: 45
  });
  const target = createLifecycleClass(fixture.database, fixture.teacherUser, {
    name: '高二7班',
    grade: '高二',
    join_mode: 'open',
    max_students: 45
  });
  const sourceInvite = fixture.database.prepare('SELECT * FROM class_invites WHERE class_id = ? ORDER BY id DESC LIMIT 1').get(source.class.id);

  createJoinRequestByCode(fixture.database, {
    code: sourceInvite.invite_code,
    studentName: '赵同学',
    studentNo: '2026001',
    source: 'student-mobile'
  });
  const sourceRequest = fixture.database.prepare('SELECT * FROM class_join_requests WHERE class_id = ? ORDER BY id DESC LIMIT 1').get(source.class.id);
  approveJoinRequest(fixture.database, fixture.teacherUser, source.class.id, sourceRequest.id);
  fixture.database.prepare(`
    INSERT INTO assignments (class_id, public_id, title, prompt, requirements, essay_type, full_score, status, deadline)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(source.class.id, 'G2-20260715-010', '班级任务', '写作要求', '要求', '材料作文', 60, 'published', '2030-01-01T00:00:00');

  assert.ok(listStudentMobileClasses(fixture.database, fixture.studentUser).rows.some((row) => Number(row.id) === Number(source.class.id)));

  const paused = pauseClassMember(fixture.database, fixture.teacherUser, source.class.id, fixture.studentId, '临时停用');
  assert.equal(paused.status, 200);
  assert.equal(fixture.database.prepare('SELECT status FROM student_class_bindings WHERE class_id = ? AND student_id = ?').get(source.class.id, fixture.studentId).status, 'paused');
  assert.ok(!listStudentMobileClasses(fixture.database, fixture.studentUser).rows.some((row) => Number(row.id) === Number(source.class.id)));

  const restored = restoreClassMember(fixture.database, fixture.teacherUser, source.class.id, fixture.studentId, '恢复');
  assert.equal(restored.status, 200);
  assert.equal(fixture.database.prepare('SELECT status FROM student_class_bindings WHERE class_id = ? AND student_id = ?').get(source.class.id, fixture.studentId).status, 'active');
  assert.ok(listStudentMobileClasses(fixture.database, fixture.studentUser).rows.some((row) => Number(row.id) === Number(source.class.id)));

  const removed = removeClassMember(fixture.database, fixture.teacherUser, source.class.id, fixture.studentId, '移出班级');
  assert.equal(removed.status, 200);
  assert.equal(fixture.database.prepare('SELECT status FROM student_class_bindings WHERE class_id = ? AND student_id = ?').get(source.class.id, fixture.studentId).status, 'removed');
  assert.ok(!listStudentMobileClasses(fixture.database, fixture.studentUser).rows.some((row) => Number(row.id) === Number(source.class.id)));

  const transferred = transferClassMember(fixture.database, fixture.teacherUser, source.class.id, fixture.studentId, target.class.id, { reason: '转班', keepSourceMembership: false });
  assert.equal(transferred.status, 200);
  assert.equal(fixture.database.prepare('SELECT status FROM student_class_bindings WHERE class_id = ? AND student_id = ?').get(target.class.id, fixture.studentId).status, 'active');
  assert.equal(fixture.database.prepare('SELECT status FROM student_class_bindings WHERE class_id = ? AND student_id = ?').get(source.class.id, fixture.studentId).status, 'transferred');
  assert.ok(listStudentMobileClasses(fixture.database, fixture.studentUser).rows.some((row) => Number(row.id) === Number(target.class.id)));
  assert.ok(!listStudentMobileClasses(fixture.database, fixture.studentUser).rows.some((row) => Number(row.id) === Number(source.class.id)));

  const assignmentRows = listStudentMobileAssignments(fixture.database, fixture.studentUser).rows;
  assert.ok(!assignmentRows.some((row) => Number(row.class_id) === Number(source.class.id)));
  assert.ok(assignmentRows.every((row) => Number(row.class_id) !== Number(source.class.id)));
  assert.equal(fixture.database.prepare('SELECT COUNT(*) AS count FROM class_students WHERE class_id = ? AND student_id = ?').get(source.class.id, fixture.studentId).count, 1);
});
