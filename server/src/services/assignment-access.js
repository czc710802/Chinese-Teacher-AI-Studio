function getTeacher(database, user) {
  return database.prepare('SELECT id FROM teachers WHERE user_id = ?').get(user.id);
}

function getStudent(database, user) {
  return database.prepare('SELECT id FROM students WHERE user_id = ?').get(user.id);
}

function assignmentKey(row) {
  return [
    row.class_id,
    String(row.title || '').trim(),
    String(row.prompt || '').trim(),
    String(row.essay_type || '').trim(),
    Number(row.full_score || 0),
    String(row.deadline || '').trim()
  ].join('\u001f');
}

function preferAssignment(candidate, current) {
  if (!current) return candidate;
  const candidateEssays = Number(candidate.essay_count || 0);
  const currentEssays = Number(current.essay_count || 0);
  if (candidateEssays !== currentEssays) return candidateEssays > currentEssays ? candidate : current;
  if (String(candidate.created_at || '') !== String(current.created_at || '')) {
    return String(candidate.created_at || '') > String(current.created_at || '') ? candidate : current;
  }
  return Number(candidate.id || 0) > Number(current.id || 0) ? candidate : current;
}

function dedupeAssignments(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = assignmentKey(row);
    byKey.set(key, preferAssignment(row, byKey.get(key)));
  }
  return [...byKey.values()].sort((a, b) => {
    const created = String(b.created_at || '').localeCompare(String(a.created_at || ''));
    if (created !== 0) return created;
    return Number(b.id || 0) - Number(a.id || 0);
  });
}

export function listAssignmentsForUser(database, user, { classId } = {}) {
  const scopedClassId = classId ? String(classId) : null;

  if (user.role === 'teacher') {
    const teacher = getTeacher(database, user);
    const rows = database.prepare(`
      SELECT a.*, c.name AS class_name, COUNT(e.id) AS essay_count
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      LEFT JOIN essays e ON e.assignment_id = a.id
      WHERE c.teacher_id = ? AND (? IS NULL OR a.class_id = ?)
      GROUP BY a.id
      ORDER BY a.created_at DESC, a.id DESC
    `).all(teacher?.id || 0, scopedClassId, scopedClassId);
    return { status: 200, rows: dedupeAssignments(rows) };
  }

  if (user.role === 'student') {
    const student = getStudent(database, user);
    if (!student) return { status: 403, message: '没有查看作文任务的权限', rows: [] };
    const rows = database.prepare(`
      SELECT a.*, c.name AS class_name, COUNT(e.id) AS essay_count
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      JOIN class_students cs ON cs.class_id = c.id
      LEFT JOIN essays e ON e.assignment_id = a.id
      WHERE cs.student_id = ? AND (? IS NULL OR a.class_id = ?)
      GROUP BY a.id
      ORDER BY a.created_at DESC, a.id DESC
    `).all(student.id, scopedClassId, scopedClassId);
    return { status: 200, rows: dedupeAssignments(rows) };
  }

  return { status: 403, message: '没有查看作文任务的权限', rows: [] };
}

export function createManagedAssignment(database, user, body) {
  const teacher = getTeacher(database, user);
  if (!teacher) return { status: 400, message: '请先创建教师账号后再发布任务' };

  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(body.class_id);
  if (!klass) return { status: 404, message: '班级不存在' };
  if (klass.teacher_id !== teacher.id) return { status: 403, message: '没有管理该班级的权限' };

  const existing = database.prepare(`
    SELECT a.*, COUNT(e.id) AS essay_count
    FROM assignments a
    LEFT JOIN essays e ON e.assignment_id = a.id
    WHERE a.class_id = ?
      AND TRIM(a.title) = TRIM(?)
      AND TRIM(a.prompt) = TRIM(?)
      AND TRIM(a.essay_type) = TRIM(?)
      AND a.full_score = ?
      AND COALESCE(TRIM(a.deadline), '') = COALESCE(TRIM(?), '')
    GROUP BY a.id
    ORDER BY essay_count DESC, a.created_at DESC, a.id DESC
    LIMIT 1
  `).get(body.class_id, body.title, body.prompt, body.essay_type, body.full_score, body.deadline || '');
  if (existing) return { status: 200, assignment: existing, reused: true };

  const result = database.prepare(`
    INSERT INTO assignments (class_id, title, prompt, essay_type, full_score, deadline)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(body.class_id, body.title, body.prompt, body.essay_type, body.full_score, body.deadline);
  return {
    status: 200,
    assignment: database.prepare('SELECT * FROM assignments WHERE id = ?').get(result.lastInsertRowid)
  };
}

export function deleteManagedAssignment(database, user, assignmentId) {
  const assignment = database.prepare(`
    SELECT a.*, c.teacher_id, c.name AS class_name
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    WHERE a.id = ?
  `).get(assignmentId);
  if (!assignment) return { status: 404, message: '作文任务不存在' };

  const teacher = getTeacher(database, user);
  if (teacher?.id !== assignment.teacher_id) return { status: 403, message: '没有管理该任务的权限' };

  database.prepare('DELETE FROM assignments WHERE id = ?').run(assignmentId);
  return { status: 200, assignment };
}
