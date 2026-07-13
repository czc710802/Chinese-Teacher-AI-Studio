export function getClassRosterForUser(database, user, classId) {
  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!klass) return { status: 404, message: '班级不存在', rows: [] };

  let canRead = false;
  if (user.role === 'teacher') {
    const teacher = database.prepare('SELECT id FROM teachers WHERE user_id = ?').get(user.id);
    canRead = teacher?.id === klass.teacher_id;
  }
  if (user.role === 'student') {
    canRead = !!database.prepare(`
      SELECT 1
      FROM class_students cs
      JOIN students s ON s.id = cs.student_id
      WHERE cs.class_id = ? AND s.user_id = ?
    `).get(classId, user.id);
  }
  if (!canRead) return { status: 403, message: '没有查看该班级名单的权限', rows: [] };

  const rows = database.prepare(`
    SELECT s.id, s.student_no, u.name, u.username,
           CASE WHEN s.user_id = ? THEN 1 ELSE 0 END AS is_current_user
    FROM class_students cs
    JOIN students s ON s.id = cs.student_id
    JOIN users u ON u.id = s.user_id
    WHERE cs.class_id = ?
    ORDER BY CAST(s.student_no AS INTEGER), s.student_no, u.name
  `).all(user.id, classId).map((row) => (
    user.role === 'student' ? { ...row, username: undefined } : row
  ));

  return { status: 200, rows };
}

export function renameStudentForManagedClass(database, user, classId, studentId, name) {
  const nextName = String(name || '').trim();
  if (!nextName) return { status: 400, message: '学生姓名不能为空' };

  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!klass) return { status: 404, message: '班级不存在' };

  const teacher = database.prepare('SELECT id FROM teachers WHERE user_id = ?').get(user.id);
  if (teacher?.id !== klass.teacher_id) return { status: 403, message: '没有管理该班级的权限' };

  const student = database.prepare(`
    SELECT s.id, s.user_id, s.student_no, u.username
    FROM class_students cs
    JOIN students s ON s.id = cs.student_id
    JOIN users u ON u.id = s.user_id
    WHERE cs.class_id = ? AND s.id = ?
  `).get(classId, studentId);
  if (!student) return { status: 404, message: '该学生不在当前班级名单中' };

  database.prepare('UPDATE users SET name = ? WHERE id = ?').run(nextName, student.user_id);

  return {
    status: 200,
    student: {
      id: student.id,
      student_no: student.student_no,
      username: student.username,
      name: nextName
    }
  };
}

export function deleteManagedEmptyClass(database, user, classId) {
  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!klass) return { status: 404, message: '班级不存在' };

  const teacher = database.prepare('SELECT id FROM teachers WHERE user_id = ?').get(user.id);
  if (teacher?.id !== klass.teacher_id) return { status: 403, message: '没有管理该班级的权限' };

  const studentCount = database.prepare('SELECT COUNT(*) AS count FROM class_students WHERE class_id = ?').get(classId).count;
  const assignmentCount = database.prepare('SELECT COUNT(*) AS count FROM assignments WHERE class_id = ?').get(classId).count;
  if (studentCount > 0 || assignmentCount > 0) {
    return { status: 409, message: '请先删除学生名单和作文任务后再删除班级' };
  }

  database.prepare('DELETE FROM classes WHERE id = ?').run(classId);
  return { status: 200, class: klass };
}
