export function getStudentForUser(database, user) {
  return database.prepare('SELECT id FROM students WHERE user_id = ?').get(user.id);
}

export function countEssayWords(text = '') {
  const value = String(text || '').trim();
  if (!value) return 0;
  const cjk = (value.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (value.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*/g) || []).length;
  return cjk + words;
}

export function getEssayLengthBand(text = '') {
  const wordCount = countEssayWords(text);
  if (wordCount <= 0) return 'empty';
  if (wordCount < 300) return 'short';
  if (wordCount < 800) return 'medium';
  if (wordCount <= 3000) return 'full';
  return 'long';
}

export function isStudentInClass(database, studentId, classId) {
  return !!database.prepare('SELECT 1 FROM class_students WHERE student_id = ? AND class_id = ?').get(studentId, classId);
}

export function isStudentActiveInClass(database, studentId, classId) {
  return !!database.prepare(`
    SELECT 1
    FROM class_students cs
    LEFT JOIN student_class_bindings b ON b.student_id = cs.student_id AND b.class_id = cs.class_id
    WHERE cs.student_id = ? AND cs.class_id = ? AND COALESCE(b.status, 'active') = 'active'
  `).get(studentId, classId);
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
  if (classId && !isStudentActiveInClass(database, student.id, classId)) {
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
  const assignmentKey = body.assignment_id ?? body.assignmentId;
  const numericAssignmentId = Number(assignmentKey);
  if ((!Number.isFinite(numericAssignmentId) || numericAssignmentId <= 0) && !String(assignmentKey || '').trim()) {
    return { status: 404, message: '作文任务不存在' };
  }

  const assignment = database.prepare('SELECT * FROM assignments WHERE id = ? OR public_id = ?')
    .get(Number.isFinite(numericAssignmentId) ? numericAssignmentId : -1, String(assignmentKey || '').trim());
  if (!assignment) return { status: 404, message: '作文任务不存在' };
  if (assignment.status && assignment.status !== 'published') return { status: 404, message: '作文任务尚未发布' };

  const resolved = resolveEssaySubmitStudentId(database, user, body);
  if (resolved.status !== 200) return resolved;
  if (!resolved.studentId) return { status: 400, message: '学生档案不存在' };

  if (user.role === 'student' && !isStudentActiveInClass(database, resolved.studentId, assignment.class_id)) {
    return { status: 403, message: '没有提交该作文任务的权限' };
  }

  return { status: 200, studentId: resolved.studentId, assignment };
}

export function resolveEssaySubmitTarget(database, user, body = {}) {
  const essayText = String(body.revised_text || body.original_text || '').trim();
  if (!essayText) return { status: 400, message: '请先粘贴或输入作文正文' };

  const resolved = resolveEssayAssignmentTarget(database, user, body);
  if (resolved.status !== 200) return resolved;

  const now = body.now ? new Date(body.now) : new Date();
  const deadline = resolved.assignment.deadline ? new Date(resolved.assignment.deadline) : null;
  const isPastDeadline = deadline && !Number.isNaN(deadline.getTime()) && now.getTime() > deadline.getTime();
  if (isPastDeadline && !Number(resolved.assignment.allow_late_submit || 0)) {
    return { status: 409, message: '作业已截止，不能提交' };
  }

  const wordCount = countEssayWords(essayText);
  const lengthBand = getEssayLengthBand(essayText);

  const existing = database.prepare(`
    SELECT MAX(submit_round) AS max_round, COUNT(*) AS count
    FROM essays
    WHERE assignment_id = ? AND student_id = ?
  `).get(resolved.assignment.id, resolved.studentId);
  if (Number(existing.count || 0) > 0 && !Number(resolved.assignment.allow_resubmit || 0)) {
    return { status: 409, message: '该作业已提交，请勿重复提交' };
  }

  return {
    ...resolved,
    essayText,
    wordCount,
    lengthBand,
    nextSubmitRound: Number(existing.max_round || 0) + 1,
    submissionStatus: isPastDeadline ? 'late_submitted' : 'submitted'
  };
}

export function saveSubmissionDraft(database, user, body = {}) {
  const resolved = resolveEssayAssignmentTarget(database, user, body);
  if (resolved.status !== 200) return resolved;
  if (user.role !== 'student') return { status: 403, message: '只有学生可以保存作文草稿' };

  const title = String(body.title || '').trim();
  const content = String(body.content || body.original_text || '').trim();
  const attachments = JSON.stringify(Array.isArray(body.attachments) ? body.attachments : []);
  const wordCount = countEssayWords(content);
  database.prepare(`
    INSERT INTO submission_drafts (assignment_id, student_id, title, content, attachments, word_count, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(assignment_id, student_id) DO UPDATE SET
      title = excluded.title,
      content = excluded.content,
      attachments = excluded.attachments,
      word_count = excluded.word_count,
      updated_at = CURRENT_TIMESTAMP
  `).run(resolved.assignment.id, resolved.studentId, title, content, attachments, wordCount);
  return {
    status: 200,
    draft: database.prepare('SELECT * FROM submission_drafts WHERE assignment_id = ? AND student_id = ?')
      .get(resolved.assignment.id, resolved.studentId)
  };
}

export function getSubmissionDraft(database, user, assignmentId) {
  if (user.role !== 'student') return { status: 403, message: '只有学生可以读取自己的作文草稿' };
  const resolved = resolveEssayAssignmentTarget(database, user, { assignment_id: assignmentId });
  if (resolved.status !== 200) return resolved;
  const draft = database.prepare('SELECT * FROM submission_drafts WHERE assignment_id = ? AND student_id = ?')
    .get(resolved.assignment.id, resolved.studentId);
  return { status: 200, draft: draft || null };
}

export function resolveStudentSubmissionStatus(database, user, assignmentId) {
  if (user.role !== 'student') return { status: 403, state: '无权限', message: '只有学生可以查看自己的提交状态' };
  const resolved = resolveEssayAssignmentTarget(database, user, { assignment_id: assignmentId });
  if (resolved.status !== 200) return { ...resolved, state: '不可用' };

  const essay = database.prepare(`
    SELECT *
    FROM essays
    WHERE assignment_id = ? AND student_id = ?
    ORDER BY submit_round DESC, submitted_at DESC, id DESC
    LIMIT 1
  `).get(resolved.assignment.id, resolved.studentId);
  if (essay) {
    if (essay.status === 'returned') return { status: 200, state: '已退回', essay };
    if (essay.status === 'waiting_revision') return { status: 200, state: '等待二稿', essay };
    if (essay.status === 'revision_submitted' || Number(essay.submit_round || 1) > 1) return { status: 200, state: '二稿已提交', essay };
    if (essay.status === 'report_published') return { status: 200, state: '已发布报告', essay };
    if (essay.status === 'late_submitted') return { status: 200, state: '迟交', essay };
    if (essay.grading_status === 'grading') return { status: 200, state: '批改中', essay };
    if (essay.grading_status === 'graded') return { status: 200, state: '待教师审核', essay };
    return { status: 200, state: '已提交', essay };
  }

  const draft = database.prepare(`
    SELECT *
    FROM submission_drafts
    WHERE assignment_id = ? AND student_id = ?
    ORDER BY updated_at DESC
    LIMIT 1
  `).get(resolved.assignment.id, resolved.studentId);
  if (draft) return { status: 200, state: '草稿', draft };
  return { status: 200, state: '未提交' };
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
