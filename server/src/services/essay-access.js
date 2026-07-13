export function getStudentForUser(database, user) {
  return database.prepare('SELECT id FROM students WHERE user_id = ?').get(user.id);
}

export function isStudentInClass(database, studentId, classId) {
  return !!database.prepare('SELECT 1 FROM class_students WHERE student_id = ? AND class_id = ?').get(studentId, classId);
}

export function resolveEssayListScope(database, user, query = {}) {
  if (user.role !== 'student') {
    return {
      status: 200,
      studentId: query.studentId || null,
      classId: query.classId || null
    };
  }

  const student = getStudentForUser(database, user);
  if (!student) return { status: 404, message: '学生档案不存在' };

  const classId = query.classId || null;
  if (classId && !isStudentInClass(database, student.id, classId)) {
    return { status: 403, message: '没有查看该班级作文的权限' };
  }

  return { status: 200, studentId: student.id, classId };
}

export function resolveEssaySubmitStudentId(database, user, body = {}) {
  if (user.role !== 'student') {
    return { status: 200, studentId: body.student_id || null };
  }

  const student = getStudentForUser(database, user);
  if (!student) return { status: 404, message: '学生档案不存在' };
  return { status: 200, studentId: student.id };
}

export function resolveEssayAssignmentTarget(database, user, body = {}) {
  const assignmentId = Number(body.assignment_id);
  if (!Number.isFinite(assignmentId) || assignmentId <= 0) return { status: 404, message: '作文任务不存在' };

  const assignment = database.prepare('SELECT * FROM assignments WHERE id = ?').get(assignmentId);
  if (!assignment) return { status: 404, message: '作文任务不存在' };

  const resolved = resolveEssaySubmitStudentId(database, user, body);
  if (resolved.status !== 200) return resolved;
  if (!resolved.studentId) return { status: 400, message: '学生档案不存在' };

  if (user.role === 'student' && !isStudentInClass(database, resolved.studentId, assignment.class_id)) {
    return { status: 403, message: '没有提交该作文任务的权限' };
  }

  return { status: 200, studentId: resolved.studentId, assignment };
}

export function resolveEssaySubmitTarget(database, user, body = {}) {
  const essayText = String(body.revised_text || body.original_text || '').trim();
  if (!essayText) return { status: 400, message: '请先粘贴或输入作文正文' };

  const resolved = resolveEssayAssignmentTarget(database, user, body);
  if (resolved.status !== 200) return resolved;

  return { ...resolved, essayText };
}

export function canReadEssay(database, user, essayId) {
  if (user.role === 'student') {
    const student = getStudentForUser(database, user);
    if (!student) return false;
    return !!database.prepare('SELECT 1 FROM essays WHERE id = ? AND student_id = ?').get(essayId, student.id);
  }

  if (user.role === 'teacher') {
    const teacher = database.prepare('SELECT id FROM teachers WHERE user_id = ?').get(user.id);
    if (!teacher) return false;
    return !!database.prepare(`
      SELECT 1
      FROM essays e
      JOIN assignments a ON a.id = e.assignment_id
      JOIN classes c ON c.id = a.class_id
      WHERE e.id = ? AND c.teacher_id = ?
    `).get(essayId, teacher.id);
  }

  return false;
}
