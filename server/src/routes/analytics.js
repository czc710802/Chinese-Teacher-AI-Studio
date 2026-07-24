import { Router } from 'express';
import { db } from '../db/connection.js';
import { requireUser } from '../middleware/auth.js';
import { parseJson } from '../utils/json.js';
import { canonicalEssayIdsSql } from '../services/essay-submission.js';
import { selectCanonicalEssayReview } from '../services/essay-grading/review-history.js';

export const analyticsRouter = Router();
analyticsRouter.use(requireUser);

export function classAnalytics(classId, assignmentId) {
  const canonicalSql = canonicalEssayIdsSql('e');
  const essayRows = db.prepare(`
    ${canonicalSql}
    SELECT DISTINCT e.student_id
    FROM canonical_essays ce
    JOIN essays e ON e.id = ce.id
    JOIN assignments a ON a.id = e.assignment_id
    WHERE a.class_id = ? AND (? IS NULL OR a.id = ?)
  `).all(classId, assignmentId || null, assignmentId || null).map((x) => x.student_id);
  const essays = db.prepare(`
    ${canonicalSql}
    SELECT e.id, e.student_id
    FROM canonical_essays ce
    JOIN essays e ON e.id = ce.id
    JOIN assignments a ON a.id = e.assignment_id
    WHERE a.class_id = ? AND (? IS NULL OR a.id = ?)
  `).all(classId, assignmentId || null, assignmentId || null);
  const reviewRows = essays
    .map((essay) => ({ essay, review: selectCanonicalEssayReview(db, essay.id) }))
    .filter((item) => item.review);
  const scores = reviewRows.map((item) => Number(item.review.total_score ?? item.review.totalScore ?? 0)).filter(Number.isFinite);
  const students = db.prepare(`
    SELECT s.id, u.name FROM class_students cs
    JOIN students s ON s.id = cs.student_id
    JOIN users u ON u.id = s.user_id
    WHERE cs.class_id = ?
  `).all(classId);
  const counts = {};
  const strengthCounts = {};
  const thinkingBuckets = {};
  const abilityTotals = {};
  const thinkingDepthCounts = {};
  for (const item of reviewRows) {
    const row = item.review;
    for (const problem of parseJson(row.problems || row.weakSpots || [], [])) counts[problem] = (counts[problem] || 0) + 1;
    for (const strength of parseJson(row.strengths, [])) strengthCounts[strength] = (strengthCounts[strength] || 0) + 1;
    const raw = parseJson(row.raw_json, {});
    const depthLabel = raw?.thinking_depth?.label || raw?.thinking_depth?.current_layer;
    if (depthLabel) thinkingDepthCounts[depthLabel] = (thinkingDepthCounts[depthLabel] || 0) + 1;
    for (const item of raw?.logic_thinking_score?.items || []) {
      const normalized = Math.round((Number(item.score) || 0) / (Number(item.full) || 6) * 100);
      const name = item.name || '未命名能力';
      if (!abilityTotals[name]) abilityTotals[name] = [];
      abilityTotals[name].push(normalized);
      if (normalized < 70) {
        const weaknessName = thinkingWeaknessName(name);
        thinkingBuckets[weaknessName] = (thinkingBuckets[weaknessName] || 0) + 1;
      }
    }
  }
  const thinkingAbilityAverages = Object.entries(abilityTotals)
    .map(([name, values]) => ({ name, score: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) }))
    .sort((a, b) => a.score - b.score);
  const thinkingWeaknesses = Object.entries(thinkingBuckets)
    .map(([name, count]) => ({ name, count, percent: reviews.length ? Math.round(count / reviews.length * 100) : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
  const thinkingTeachingSuggestions = thinkingWeaknesses.length ? thinkingWeaknesses.map((item) => ({
    focus: item.name,
    suggestion: thinkingTeachingSuggestion(item.name)
  })) : [
    { focus: '不会分析原因', suggestion: '课堂讲评可统一训练“观点之后补为什么”，让学生在每个材料后写出因果分析句。' }
  ];
  return {
    averageScore: scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)) : 0,
    maxScore: scores.length ? Math.max(...scores) : 0,
    minScore: scores.length ? Math.min(...scores) : 0,
    missingStudents: students.filter((s) => !essayRows.includes(s.id)).map((s) => s.name),
    commonProblems: Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    commonStrengths: Object.entries(strengthCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    thinkingWeaknesses,
    thinkingAbilityAverages,
    thinkingDepthDistribution: Object.entries(thinkingDepthCounts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    thinkingTeachingSuggestions
  };
}

function thinkingWeaknessName(name) {
  if (name === '观点是否明确') return '不会明确回应题目';
  if (name === '论证结构') return '不会组织完整论证链';
  if (name === '推理能力') return '不会分析原因';
  if (name === '材料使用能力') return '不会让材料证明观点';
  if (name === '论证深度') return '不会联系现实和本质';
  return name;
}

function thinkingTeachingSuggestion(name) {
  if (name.includes('分析原因')) return '安排“为什么会这样”专题训练，要求每个论据后补出原因、条件和结果三句分析。';
  if (name.includes('材料')) return '用同一材料示范“讲故事”和“作论据”的区别，训练学生写材料后的回扣句。';
  if (name.includes('论证链')) return '用五步模板拆段：提出观点、解释观点、举例论证、分析例子、回扣观点。';
  if (name.includes('回应题目')) return '课前先做审题圈画，要求学生用一句可证明的判断回答题目。';
  return '组织二次修改课，让学生带着苏格拉底式追问检查观点漏洞和论证深度。';
}

analyticsRouter.get('/classes/:classId/insights', (req, res) => {
  const analytics = classAnalytics(req.params.classId, req.query.assignmentId);
  const excellentEssays = db.prepare(`
    ${canonicalEssayIdsSql('e')}
    SELECT e.id, e.title, u.name AS student_name, e.original_text
    FROM canonical_essays ce
    JOIN essays e ON e.id = ce.id
    JOIN assignments a ON a.id=e.assignment_id
    JOIN students s ON s.id=e.student_id
    JOIN users u ON u.id=s.user_id
    WHERE a.class_id=?
    ORDER BY e.created_at DESC, e.id DESC
  `).all(req.params.classId)
    .map((row) => ({ ...row, review: selectCanonicalEssayReview(db, row.id) }))
    .filter((row) => Number.isFinite(Number(row.review?.total_score ?? row.review?.totalScore ?? null)))
    .sort((a, b) => Number(b.review.total_score ?? b.review.totalScore ?? 0) - Number(a.review.total_score ?? a.review.totalScore ?? 0))
    .slice(0, 5)
    .map((row) => ({ ...row, total_score: row.review.total_score ?? row.review.totalScore ?? null, strengths: parseJson(row.review.strengths, []) }));
  const focus = analytics.commonProblems.slice(0, 3).map((item, index) => ({
    theme: item.name,
    guidance: [`先用一则具体材料建立论题，再补充因果分析。`, `围绕核心概念做“是什么、为什么、怎么办”三层追问。`, `以段落中心句统领事例与议论，避免材料堆砌。`][index] || '以一篇限时修改稿完成针对性训练。'
  }));
  res.json({ ...analytics, excellentEssays, deepGuidance: focus });
});

analyticsRouter.get('/classes/:classId', (req, res) => {
  res.json(classAnalytics(req.params.classId, req.query.assignmentId));
});

analyticsRouter.get('/students/:studentId', (req, res) => {
  const profile = db.prepare('SELECT * FROM student_profiles WHERE student_id = ?').get(req.params.studentId);
  const essays = db.prepare(`
    ${canonicalEssayIdsSql('e')}
    SELECT e.id, e.title, e.created_at, a.title AS assignment_title
    FROM canonical_essays ce
    JOIN essays e ON e.id = ce.id
    JOIN assignments a ON a.id = e.assignment_id
    WHERE e.student_id = ?
    ORDER BY e.created_at DESC, e.id DESC
  `).all(req.params.studentId).map((row) => {
    const review = selectCanonicalEssayReview(db, row.id);
    return { ...row, total_score: review?.total_score ?? review?.totalScore ?? null, level: review?.level || '' };
  });
  res.json({ profile, essays });
});
