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
    String(row.requirements || '').trim(),
    String(row.essay_type || '').trim(),
    Number(row.full_score || 0),
    Number(row.min_words || 0),
    Number(row.max_words || 0),
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

function normalizePublicOrigin(options = {}) {
  const raw = String(options.publicOrigin || process.env.PUBLIC_APP_ORIGIN || 'https://pi.zhenwanyue.icu').trim().replace(/\/+$/, '');
  try {
    const url = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(url.hostname)) return 'https://pi.zhenwanyue.icu';
    if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.)/.test(url.hostname)) return 'https://pi.zhenwanyue.icu';
    return url.origin;
  } catch {
    return 'https://pi.zhenwanyue.icu';
  }
}

function dateCode(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  const yyyy = safe.getFullYear();
  const mm = String(safe.getMonth() + 1).padStart(2, '0');
  const dd = String(safe.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function gradeCode(value, classId) {
  const raw = String(value || '').toUpperCase();
  const mapped = raw
    .replace(/高一|一年级|G1/g, 'G1')
    .replace(/高二|二年级|G2/g, 'G2')
    .replace(/高三|三年级|G3/g, 'G3')
    .replace(/[^A-Z0-9]/g, '');
  return mapped || `G${classId || 'X'}`;
}

export function buildSubmissionUrl(publicId, options = {}) {
  return `${normalizePublicOrigin(options)}/submit/${encodeURIComponent(String(publicId || ''))}`;
}

export function buildAssignmentQrSvg(url) {
  const safeUrl = String(url || '').replace(/[<>&"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[char]));
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" role="img" aria-label="作文提交二维码">',
    '<rect width="240" height="240" fill="#ffffff"/>',
    '<rect x="16" y="16" width="48" height="48" fill="#111827"/><rect x="28" y="28" width="24" height="24" fill="#ffffff"/>',
    '<rect x="176" y="16" width="48" height="48" fill="#111827"/><rect x="188" y="28" width="24" height="24" fill="#ffffff"/>',
    '<rect x="16" y="176" width="48" height="48" fill="#111827"/><rect x="28" y="188" width="24" height="24" fill="#ffffff"/>',
    '<path d="M88 32h16v16H88zm32 0h16v16h-16zm32 0h16v16h-16zM88 72h16v16H88zm48 0h16v16h-16zm-16 32h16v16h-16zm40 24h16v16h-16zm-72 32h16v16H88zm32 24h16v16h-16zm64-16h16v16h-16zm-32 32h16v16h-16z" fill="#111827"/>',
    `<text x="120" y="118" text-anchor="middle" font-size="12" fill="#111827">扫码提交作文</text>`,
    `<text x="120" y="138" text-anchor="middle" font-size="8" fill="#4b5563">${safeUrl.slice(0, 42)}</text>`,
    '</svg>'
  ].join('');
}

function createPublicId(database, klass, now = new Date()) {
  const prefix = `${gradeCode(klass.grade, klass.id)}-${dateCode(now)}`;
  const row = database.prepare(`
    SELECT public_id FROM assignments
    WHERE public_id LIKE ?
    ORDER BY public_id DESC
    LIMIT 1
  `).get(`${prefix}-%`);
  const last = Number(String(row?.public_id || '').split('-').pop() || 0);
  return `${prefix}-${String(last + 1).padStart(3, '0')}`;
}

function ensureAssignmentShareFields(database, assignment, options = {}) {
  if (!assignment) return assignment;
  let publicId = assignment.public_id;
  if (!publicId) {
    const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(assignment.class_id) || { id: assignment.class_id };
    publicId = createPublicId(database, { ...klass, grade: assignment.grade || klass.grade }, options.now);
  }
  const submissionUrl = buildSubmissionUrl(publicId, options);
  const qrSvg = assignment.qr_svg || buildAssignmentQrSvg(submissionUrl);
  if (!assignment.public_id || !assignment.share_url || !assignment.qr_svg) {
    database.prepare(`
      UPDATE assignments SET public_id = ?, share_url = ?, qr_svg = ?, published_at = COALESCE(published_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `).run(publicId, submissionUrl, qrSvg, assignment.id);
  }
  return { ...assignment, public_id: publicId, submission_url: submissionUrl, share_url: submissionUrl, qr_svg: qrSvg };
}

function withSubmissionStats(database, assignment, options = {}) {
  const shared = ensureAssignmentShareFields(database, assignment, options);
  const submitted = database.prepare(`
    SELECT COUNT(DISTINCT student_id) AS count
    FROM essays
    WHERE assignment_id = ?
  `).get(shared.id).count;
  const total = database.prepare('SELECT COUNT(*) AS count FROM class_students WHERE class_id = ?').get(shared.class_id).count;
  return {
    ...shared,
    submitted_count: Number(submitted || 0),
    missing_count: Math.max(0, Number(total || 0) - Number(submitted || 0)),
    total_students: Number(total || 0)
  };
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
    return { status: 200, rows: dedupeAssignments(rows).map((row) => withSubmissionStats(database, row)) };
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
    return { status: 200, rows: dedupeAssignments(rows).map((row) => withSubmissionStats(database, row)) };
  }

  return { status: 403, message: '没有查看作文任务的权限', rows: [] };
}

export function createManagedAssignment(database, user, body, options = {}) {
  const teacher = getTeacher(database, user);
  if (!teacher) return { status: 400, message: '请先创建教师账号后再发布任务' };

  const classId = Number(body.class_id || body.classId);
  const klass = database.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!klass) return { status: 404, message: '班级不存在' };
  if (klass.teacher_id !== teacher.id) return { status: 403, message: '没有管理该班级的权限' };

  const next = {
    class_id: classId,
    title: String(body.title || '').trim(),
    prompt: String(body.prompt || '').trim(),
    requirements: String(body.requirements || '').trim(),
    essay_type: String(body.essay_type || body.essayType || '材料作文').trim(),
    full_score: Number(body.full_score || body.fullScore || 60),
    grade: String(body.grade || klass.grade || '').trim(),
    min_words: Math.max(0, Number(body.min_words ?? body.minWords ?? 0)),
    max_words: Math.max(0, Number(body.max_words ?? body.maxWords ?? 0)),
    scoring_standard: String(body.scoring_standard || body.scoringStandard || '').trim(),
    deadline: String(body.deadline || '').trim(),
    status: String(body.status || 'published').trim() || 'published',
    allow_resubmit: body.allow_resubmit || body.allowResubmit ? 1 : 0,
    feishu_chat_id: String(body.feishu_chat_id || body.feishuChatId || '').trim()
  };
  if (!next.title) return { status: 400, message: '请填写作文题目' };
  if (!next.prompt) return { status: 400, message: '请填写作文材料或写作要求' };
  if (next.max_words && next.min_words && next.max_words < next.min_words) {
    return { status: 400, message: '最高字数不能小于最低字数' };
  }

  const existing = database.prepare(`
    SELECT a.*, COUNT(e.id) AS essay_count
    FROM assignments a
    LEFT JOIN essays e ON e.assignment_id = a.id
    WHERE a.class_id = ?
      AND TRIM(a.title) = TRIM(?)
      AND TRIM(a.prompt) = TRIM(?)
      AND COALESCE(TRIM(a.requirements), '') = COALESCE(TRIM(?), '')
      AND TRIM(a.essay_type) = TRIM(?)
      AND a.full_score = ?
      AND COALESCE(a.min_words, 0) = ?
      AND COALESCE(a.max_words, 0) = ?
      AND COALESCE(TRIM(a.deadline), '') = COALESCE(TRIM(?), '')
    GROUP BY a.id
    ORDER BY essay_count DESC, a.created_at DESC, a.id DESC
    LIMIT 1
  `).get(next.class_id, next.title, next.prompt, next.requirements, next.essay_type, next.full_score, next.min_words, next.max_words, next.deadline || '');
  if (existing) return { status: 200, assignment: withSubmissionStats(database, existing, options), reused: true };

  const publicId = createPublicId(database, { ...klass, grade: next.grade }, options.now);
  const submissionUrl = buildSubmissionUrl(publicId, options);
  const qrSvg = buildAssignmentQrSvg(submissionUrl);

  const result = database.prepare(`
    INSERT INTO assignments
      (class_id, public_id, title, prompt, requirements, essay_type, full_score, grade,
       min_words, max_words, scoring_standard, status, allow_resubmit, published_at,
       share_url, qr_svg, feishu_chat_id, deadline)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
  `).run(
    next.class_id, publicId, next.title, next.prompt, next.requirements, next.essay_type, next.full_score, next.grade,
    next.min_words, next.max_words, next.scoring_standard, next.status, next.allow_resubmit,
    submissionUrl, qrSvg, next.feishu_chat_id, next.deadline || null
  );
  return {
    status: 200,
    assignment: withSubmissionStats(database, database.prepare('SELECT * FROM assignments WHERE id = ?').get(result.lastInsertRowid), options)
  };
}

export function getAssignmentPublicSummary(database, assignmentId, options = {}) {
  const assignment = database.prepare(`
    SELECT a.*, c.name AS class_name
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    WHERE a.id = ? OR a.public_id = ?
  `).get(Number(assignmentId) || -1, String(assignmentId || ''));
  if (!assignment) return { status: 404, message: '作文作业不存在或链接已失效' };
  if (assignment.status && assignment.status !== 'published') return { status: 404, message: '作文作业尚未发布' };
  return { status: 200, assignment: withSubmissionStats(database, assignment, options) };
}

export function getAssignmentSubmissionStatus(database, user, assignmentId, options = {}) {
  const assignment = database.prepare(`
    SELECT a.*, c.name AS class_name, c.teacher_id
    FROM assignments a
    JOIN classes c ON c.id = a.class_id
    WHERE a.id = ? OR a.public_id = ?
  `).get(Number(assignmentId) || -1, String(assignmentId || ''));
  if (!assignment) return { status: 404, message: '作文作业不存在' };
  const teacher = getTeacher(database, user);
  if (teacher?.id !== assignment.teacher_id) return { status: 403, message: '没有查看该作业提交状态的权限' };

  const submissions = database.prepare(`
    SELECT e.id, e.student_id, e.title, e.status, e.grading_status, e.report_id, e.submit_round,
           e.word_count, e.submitted_at, e.created_at, u.name AS student_name, s.student_no
    FROM essays e
    JOIN students s ON s.id = e.student_id
    JOIN users u ON u.id = s.user_id
    WHERE e.assignment_id = ?
    ORDER BY e.created_at DESC, e.id DESC
  `).all(assignment.id);
  const submittedStudentIds = new Set(submissions.map((row) => Number(row.student_id)));
  const missing = database.prepare(`
    SELECT s.id AS student_id, s.student_no, u.name AS student_name
    FROM class_students cs
    JOIN students s ON s.id = cs.student_id
    JOIN users u ON u.id = s.user_id
    WHERE cs.class_id = ?
    ORDER BY CAST(s.student_no AS INTEGER), s.student_no, u.name
  `).all(assignment.class_id).filter((row) => !submittedStudentIds.has(Number(row.student_id)));

  return {
    status: 200,
    assignment: withSubmissionStats(database, assignment, options),
    submissions,
    missing
  };
}

export function buildAssignmentFeishuCard(assignment) {
  const deadline = assignment.deadline ? new Date(assignment.deadline).toLocaleString('zh-CN') : '未设置';
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '作文作业已发布' },
      subtitle: { tag: 'plain_text', content: 'Chinese Teacher AI Studio' }
    },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: `**作文标题**：${assignment.title}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**写作要求**：${assignment.requirements || assignment.prompt}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**截止时间**：${deadline}` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**提交进度**：${assignment.submitted_count || 0}/${assignment.total_students || 0}` } },
      {
        tag: 'action',
        actions: [
          {
            tag: 'button',
            type: 'primary',
            text: { tag: 'plain_text', content: '打开提交链接' },
            url: assignment.submission_url || assignment.share_url
          }
        ]
      }
    ]
  };
}

export async function shareAssignmentToFeishu({ database, user, assignmentId, feishuService, chatId, options = {} }) {
  const status = getAssignmentSubmissionStatus(database, user, assignmentId, options);
  if (status.status !== 200) return status;
  const targetChatId = String(chatId || status.assignment.feishu_chat_id || '').trim();
  const card = buildAssignmentFeishuCard(status.assignment);
  if (!targetChatId) return { status: 200, sent: false, message: '未配置飞书群 chatId，已生成分享卡片', card, assignment: status.assignment };
  if (!feishuService?.sendCard) return { status: 200, sent: false, message: '飞书发送服务不可用，已生成分享卡片', card, assignment: status.assignment };
  const result = await feishuService.sendCard(targetChatId, card);
  return { status: 200, sent: true, result, card, assignment: status.assignment };
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
