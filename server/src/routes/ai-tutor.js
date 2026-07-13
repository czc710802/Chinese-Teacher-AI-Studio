import { Router } from 'express';
import { db } from '../db/connection.js';
import { requireUser } from '../middleware/auth.js';
import { safeJson } from '../utils/json.js';
import { tutorChat, generateWritingExercise, upgradeEssay, mockMark, arbitrateMark, generateDailyBriefing, generateClassInsight } from '../services/ai-tutor.js';
import { uploadFormalArtifactAsync } from '../services/zspace-storage.js';

export const aiTutorRouter = Router();
aiTutorRouter.use(requireUser);

function archiveTeacherReport(req, reportType, reportData) {
  uploadFormalArtifactAsync({
    appDir: req.app.locals.appDir,
    client: req.app.locals.zspaceClient,
    category: 'teacherPrep',
    filename: `${new Date().toISOString().slice(0, 10)}-${reportType}-${Date.now()}.json`,
    data: {
      reportType,
      reportData,
      archivedAt: new Date().toISOString(),
      storageProvider: 'zspace-webdav'
    },
    logger: req.app.locals.logger || console
  });
}

// ===== AI 辅导老师 =====
aiTutorRouter.post('/tutor/chat', async (req, res, next) => {
  try {
    const { essay_id, question, history } = req.body;
    const student = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id);
    if (!student) return res.status(403).json({ message: '仅学生可使用' });
    if (!essay_id) return res.status(400).json({ message: '请先打开一篇已提交的作文，再向辅导老师提问' });
    if (typeof question !== 'string' || !question.trim()) return res.status(400).json({ message: '请输入想咨询的问题' });

    const essay = db.prepare(`
      SELECT e.*, a.title AS assignment_title, a.essay_type
      FROM essays e JOIN assignments a ON a.id = e.assignment_id WHERE e.id = ?
    `).get(essay_id);
    if (!essay || essay.student_id !== student.id) return res.status(404).json({ message: '未找到可辅导的作文' });
    const review = essay ? db.prepare('SELECT * FROM ai_reviews WHERE essay_id = ? ORDER BY id DESC LIMIT 1').get(essay_id) : null;
    const reviewObj = review ? { ...review, problems: JSON.parse(review.problems || '[]'), strengths: JSON.parse(review.strengths || '[]') } : null;

    const answer = await tutorChat({ essay, review: reviewObj, studentQuestion: question.trim(), history: Array.isArray(history) ? history.slice(-6) : [] });

    db.prepare('INSERT INTO ai_tutor_conversations (student_id, essay_id, role, message) VALUES (?, ?, ?, ?)')
      .run(student.id, essay_id, 'student', question.trim());
    db.prepare('INSERT INTO ai_tutor_conversations (student_id, essay_id, role, message) VALUES (?, ?, ?, ?)')
      .run(student.id, essay_id, 'ai', answer);

    res.json({ answer, essay_id });
  } catch (error) { next(error); }
});

aiTutorRouter.get('/tutor/history/:essayId', (req, res) => {
  const student = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id);
  if (!student) return res.status(403).json({ message: '仅学生可查看' });
  const history = db.prepare(`
    SELECT role, message, created_at FROM ai_tutor_conversations
    WHERE student_id = ? AND essay_id = ? ORDER BY created_at ASC
  `).all(student.id, req.params.essayId);
  res.json(history);
});

// ===== AI 仿写训练 =====
aiTutorRouter.post('/writing-exercise/generate', async (req, res, next) => {
  try {
    const { source_text, exercise_type } = req.body;
    if (!source_text || !exercise_type) return res.status(400).json({ message: '请提供范文和训练类型' });
    const exercise = await generateWritingExercise({ sourceText: source_text, exerciseType: exercise_type });

    const student = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id);
    if (student) {
      db.prepare('INSERT INTO ai_writing_exercises (student_id, source_type, source_text, exercise_type, exercise_prompt) VALUES (?, ?, ?, ?, ?)')
        .run(student.id, 'manual', source_text, exercise_type, JSON.stringify(exercise));
    }
    res.json(exercise);
  } catch (error) { next(error); }
});

aiTutorRouter.post('/writing-exercise/submit', async (req, res, next) => {
  try {
    const { exercise_id, answer } = req.body;
    const student = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id);
    if (!student) return res.status(403).json({ message: '仅学生可提交' });

    db.prepare('UPDATE ai_writing_exercises SET student_answer = ?, completed = 1 WHERE id = ? AND student_id = ?')
      .run(answer, exercise_id, student.id);

    const exercise = db.prepare('SELECT * FROM ai_writing_exercises WHERE id = ?').get(exercise_id);
    const prompt = `你是一位高中语文教师。请对学生的仿写练习进行点评和评分（满分100分）。

【练习要求】${exercise.exercise_prompt}
【学生回答】${answer}

请给出简短的点评（100字以内）和分数。输出 JSON：{"feedback": "...", "score": 数字}`;

    const { callTextModel, parseAIJsonObject } = await import('../services/openai.js');
    const text = await callTextModel(prompt, { taskType: 'quick_feedback', jsonMode: true });
    const result = parseAIJsonObject(text);

    db.prepare('UPDATE ai_writing_exercises SET ai_feedback = ?, score = ? WHERE id = ?')
      .run(result.feedback, result.score, exercise_id);

    res.json(result);
  } catch (error) { next(error); }
});

aiTutorRouter.get('/writing-exercises', (req, res) => {
  const student = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id);
  if (!student) return res.json([]);
  const rows = db.prepare('SELECT * FROM ai_writing_exercises WHERE student_id = ? ORDER BY created_at DESC LIMIT 20').all(student.id);
  res.json(rows.map((r) => ({ ...r, exercise_prompt: JSON.parse(r.exercise_prompt || '{}') })));
});

// ===== AI 升格训练 =====
aiTutorRouter.post('/upgrade', async (req, res, next) => {
  try {
    const { essay_id, original_text, original_score } = req.body;
    const student = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id);
    if (!student) return res.status(403).json({ message: '仅学生可使用' });

    const essay = essay_id ? db.prepare('SELECT id, student_id, original_text FROM essays WHERE id = ?').get(essay_id) : null;
    if (essay_id && (!essay || essay.student_id !== student.id)) return res.status(404).json({ message: '未找到可升格的作文' });

    const textToUpgrade = original_text || essay?.original_text;
    if (!textToUpgrade) return res.status(400).json({ message: '请提供作文内容' });

    const result = await upgradeEssay({ originalText: textToUpgrade, originalScore: original_score || 42 });

    db.prepare('INSERT INTO ai_upgrade_records (student_id, essay_id, original_text, original_score, upgraded_text, upgraded_score, upgrade_report) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(student.id, essay_id || null, textToUpgrade, result.original_score, result.upgraded_text, result.upgraded_score, safeJson(result));

    res.json(result);
  } catch (error) { next(error); }
});

aiTutorRouter.get('/upgrade-records', (req, res) => {
  const student = db.prepare('SELECT id FROM students WHERE user_id = ?').get(req.user.id);
  if (!student) return res.json([]);
  const rows = db.prepare('SELECT id, original_score, upgraded_score, upgrade_report, created_at FROM ai_upgrade_records WHERE student_id = ? ORDER BY created_at DESC LIMIT 10').all(student.id);
  res.json(rows.map((r) => ({ ...r, upgrade_report: JSON.parse(r.upgrade_report || '{}') })));
});

// ===== 高考阅卷模拟 =====
aiTutorRouter.post('/mock-mark/start', async (req, res, next) => {
  try {
    const { essay_id } = req.body;
    const essay = db.prepare(`
      SELECT e.*, a.title AS assignment_title, a.prompt AS assignment_prompt, a.essay_type, a.full_score
      FROM essays e JOIN assignments a ON a.id = e.assignment_id WHERE e.id = ?
    `).get(essay_id);
    if (!essay) return res.status(404).json({ message: '作文不存在' });

    const assignment = { title: essay.assignment_title, prompt: essay.assignment_prompt, essay_type: essay.essay_type, full_score: essay.full_score };
    const essayText = essay.revised_text || essay.original_text;

    const [mark1, mark2] = await Promise.all([
      mockMark({ essayText, assignment }),
      mockMark({ essayText, assignment })
    ]);

    const diff = Math.abs(mark1.total_score - mark2.total_score);
    let status = 'first_pair';
    let finalScore = null;
    let finalLevel = null;
    let mark3 = null;
    let arbitration = null;

    if (diff > 5) {
      mark3 = await mockMark({ essayText, assignment });
      status = 'need_third';

      const scores = [mark1, mark2, mark3].map((m) => m.total_score);
      scores.sort((a, b) => a - b);
      if (scores[2] - scores[0] <= 7) {
        finalScore = Math.round((scores[1] + scores[2]) / 2);
        const levels = [mark1, mark2, mark3].map((m) => m.level);
        finalLevel = levels[1];
        status = 'arbitration_done';
      } else {
        arbitration = await arbitrateMark({ marker1: mark1, marker2: mark2, marker3, essayText, assignment });
        finalScore = arbitration.final_score;
        finalLevel = arbitration.final_level;
        status = 'arbitration_done';
      }
    } else {
      finalScore = Math.round((mark1.total_score + mark2.total_score) / 2);
      finalLevel = mark1.level;
      status = 'final';
    }

    const recordId = db.prepare(`
      INSERT INTO mock_marking_records (essay_id, marker_1_score, marker_1_detail, marker_2_score, marker_2_detail, marker_3_score, marker_3_detail, final_score, final_level, arbitration_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      essay_id, mark1.total_score, safeJson(mark1), mark2.total_score, safeJson(mark2),
      mark3?.total_score || null, mark3 ? safeJson(mark3) : null,
      finalScore, finalLevel, arbitration ? safeJson(arbitration) : null, status
    ).lastInsertRowid;

    res.json({
      id: recordId,
      markers: [mark1, mark2, mark3].filter(Boolean),
      final_score: finalScore,
      final_level: finalLevel,
      status,
      arbitration,
      marker_diff: diff
    });
  } catch (error) { next(error); }
});

aiTutorRouter.get('/mock-mark/records/:essayId', (req, res) => {
  const records = db.prepare('SELECT * FROM mock_marking_records WHERE essay_id = ? ORDER BY created_at DESC').all(req.params.essayId);
  res.json(records.map((r) => ({
    ...r,
    marker_1_detail: JSON.parse(r.marker_1_detail || '{}'),
    marker_2_detail: JSON.parse(r.marker_2_detail || '{}'),
    marker_3_detail: JSON.parse(r.marker_3_detail || '{}'),
    arbitration_json: JSON.parse(r.arbitration_json || '{}')
  })));
});

// ===== 教师报告（晨报/周报/月报） =====
aiTutorRouter.post('/teacher/report/generate', async (req, res, next) => {
  try {
    const { report_type, class_id } = req.body;
    const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(req.user.id);
    if (!teacher) return res.status(403).json({ message: '仅教师可使用' });

    const { classAnalytics } = await import('./analytics.js');

    if (report_type === 'daily') {
      const briefing = await generateDailyBriefing();
      db.prepare('INSERT INTO teacher_reports (teacher_id, report_type, report_data) VALUES (?, ?, ?)')
        .run(teacher.id, 'daily', safeJson(briefing));
      archiveTeacherReport(req, 'daily', briefing);
      return res.json(briefing);
    }

    if (report_type === 'weekly' || report_type === 'monthly') {
      const analytics = classAnalytics(class_id);
      const klass = db.prepare('SELECT name FROM classes WHERE id = ?').get(class_id);
      const insight = await generateClassInsight({ analytics, className: klass?.name || '未命名班级' });
      const reportData = { analytics, insight };
      db.prepare('INSERT INTO teacher_reports (teacher_id, report_type, report_data) VALUES (?, ?, ?)')
        .run(teacher.id, report_type, safeJson(reportData));
      archiveTeacherReport(req, report_type, reportData);
      return res.json(reportData);
    }

    res.status(400).json({ message: '不支持的报告类型' });
  } catch (error) { next(error); }
});

aiTutorRouter.get('/teacher/reports/:type', (req, res) => {
  const teacher = db.prepare('SELECT id FROM teachers WHERE user_id = ?').get(req.user.id);
  if (!teacher) return res.status(403).json({ message: '仅教师可查看' });
  const rows = db.prepare('SELECT * FROM teacher_reports WHERE teacher_id = ? AND report_type = ? ORDER BY created_at DESC LIMIT 10')
    .all(teacher.id, req.params.type);
  res.json(rows.map((r) => ({ ...r, report_data: JSON.parse(r.report_data || '{}') })));
});

// ===== 素材库 =====
aiTutorRouter.get('/materials', (req, res) => {
  const { category, tag } = req.query;
  let sql = 'SELECT * FROM material_library WHERE 1=1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (tag) { sql += ' AND tags LIKE ?'; params.push(`%${tag}%`); }
  sql += ' ORDER BY usage_count DESC, created_at DESC LIMIT 30';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map((r) => ({ ...r, tags: JSON.parse(r.tags || '[]') })));
});

aiTutorRouter.post('/materials', async (req, res, next) => {
  try {
    const { category, sub_category, title, content, source, tags } = req.body;
    const result = db.prepare('INSERT INTO material_library (category, sub_category, title, content, source, tags) VALUES (?, ?, ?, ?, ?, ?)')
      .run(category, sub_category, title, content, source, safeJson(tags || []));
    res.json(db.prepare('SELECT * FROM material_library WHERE id = ?').get(result.lastInsertRowid));
  } catch (error) { next(error); }
});

aiTutorRouter.post('/materials/:id/use', (req, res) => {
  db.prepare('UPDATE material_library SET usage_count = usage_count + 1 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
