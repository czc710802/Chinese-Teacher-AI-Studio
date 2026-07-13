import { db } from '../db/connection.js';
import { parseJson, safeJson } from '../utils/json.js';
import { recordStudentProfileSnapshot } from './storage-artifacts.js';

export function refreshStudentProfile(studentId, { storageService, logger = console } = {}) {
  const rows = db.prepare(`
    SELECT e.id, e.title, e.created_at, a.title AS assignment_title, ar.total_score, ar.problems, ar.next_training, ar.raw_json
    FROM essays e
    LEFT JOIN assignments a ON a.id = e.assignment_id
    LEFT JOIN ai_reviews ar ON ar.essay_id = e.id
    WHERE e.student_id = ?
    ORDER BY e.created_at ASC
  `).all(studentId);

  const scoreTrend = rows.filter((row) => row.total_score !== null).map((row) => ({
    essay_id: row.id,
    date: row.created_at,
    score: row.total_score
  }));
  const problems = rows.flatMap((row) => parseJson(row.problems, []));
  const problemCounts = problems.reduce((acc, item) => {
    acc[item] = (acc[item] || 0) + 1;
    return acc;
  }, {});
  const commonProblems = Object.entries(problemCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));
  const thinkingGrowth = buildThinkingGrowth(rows);
  const suggestions = [
    ...rows.flatMap((row) => parseJson(row.next_training, [])).slice(-8),
    {
      type: 'thinking_growth',
      abilities: thinkingGrowth.abilities,
      thinking_analyses: thinkingGrowth.thinking_analyses,
      analyses: thinkingGrowth.thinking_analyses,
      summary: thinkingGrowth.summary
    }
  ];
  const growthReport = scoreTrend.length
    ? `已累计提交 ${rows.length} 篇作文，最近一次得分 ${scoreTrend.at(-1).score} 分。思维成长档案已结合已批改作文生成详细分析，跟踪逻辑能力、思辨能力、论证能力、材料分析能力、语言表达能力和修改能力。`
    : '已建立作文成长档案，等待更多写作记录形成趋势。';

  db.prepare(`
    INSERT INTO student_profiles (student_id, score_trend, common_problems, growth_report, personalized_suggestions, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(student_id) DO UPDATE SET
      score_trend = excluded.score_trend,
      common_problems = excluded.common_problems,
      growth_report = excluded.growth_report,
      personalized_suggestions = excluded.personalized_suggestions,
      updated_at = CURRENT_TIMESTAMP
  `).run(studentId, safeJson(scoreTrend), safeJson(commonProblems), growthReport, safeJson(suggestions));
  recordStudentProfileSnapshot({ storageService, database: db, studentId, logger });
}

function buildThinkingGrowth(rows) {
  const abilityMap = new Map([
    ['逻辑能力', []],
    ['思辨能力', []],
    ['论证能力', []],
    ['材料分析能力', []],
    ['语言表达能力', []],
    ['修改能力', []]
  ]);

  for (const row of rows) {
    const raw = parseJson(row.raw_json, {});
    const items = raw?.logic_thinking_score?.items || [];
    const itemScore = (name) => {
      const item = items.find((entry) => entry.name === name);
      return item ? Math.round((Number(item.score) || 0) / (Number(item.full) || 6) * 100) : null;
    };
    const dimensionScores = Array.isArray(raw.dimension_scores) ? raw.dimension_scores : [];
    const dimensionScore = (name) => {
      const item = dimensionScores.find((entry) => entry.name === name);
      return item ? Math.round((Number(item.score) || 0) / (Number(item.full) || 10) * 100) : null;
    };

    const entries = {
      逻辑能力: itemScore('观点是否明确'),
      思辨能力: raw?.thinking_depth?.stars ? Math.round(Number(raw.thinking_depth.stars) / 5 * 100) : itemScore('论证深度'),
      论证能力: itemScore('论证结构') ?? dimensionScore('论证逻辑'),
      材料分析能力: itemScore('材料使用能力'),
      语言表达能力: dimensionScore('语言表达'),
      修改能力: Array.isArray(raw.suggestions) ? Math.min(100, 60 + raw.suggestions.length * 8) : null
    };

    for (const [name, score] of Object.entries(entries)) {
      if (Number.isFinite(score)) abilityMap.get(name).push(score);
    }
  }

  const abilities = [...abilityMap.entries()].map(([name, scores]) => {
    const score = scores.length ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length) : '--';
    const trend = scores.length > 1
      ? `${scores.at(-1) >= scores[0] ? '稳中有升' : '需要回稳'}，最近一次 ${scores.at(-1)}`
      : scores.length ? '已有一次思维能力记录，继续提交后会形成趋势' : '等待更多批改数据';
    const evidence = scores.length
      ? `${name}平均 ${score}，来自 ${scores.length} 篇已批改作文的思维评分。`
      : `${name}暂无足够评分证据，需要继续提交作文形成判断。`;
    return { name, score, trend, evidence };
  });
  const thinking_analyses = buildThinkingAnalyses(rows);
  const summary = thinking_analyses.length
    ? `已分析 ${thinking_analyses.length} 篇已批改作文，重点追踪观点、材料、推理、段落递进和修改任务。`
    : '暂无可分析的已批改作文，完成 AI 批改后将生成逐篇思维分析。';
  return { abilities, thinking_analyses, summary };
}

function buildThinkingAnalyses(rows) {
  return rows.map((row, index) => {
    const raw = parseJson(row.raw_json, {});
    if (!Object.keys(raw).length) return null;
    const items = raw?.logic_thinking_score?.items || [];
    const sortedItems = [...items].filter((item) => Number.isFinite(Number(item.score))).sort((a, b) => Number(a.score) - Number(b.score));
    const weakest = sortedItems[0];
    const strongest = sortedItems.at(-1);
    const essay_title = row.assignment_title || row.title || `第${index + 1}篇作文`;
    const depth = raw.thinking_depth;
    const problems = Array.isArray(raw.problems) ? raw.problems.slice(0, 2) : [];
    const revisionTask = raw.thinking_coach?.revision_task || raw.thinking_improvement?.training_focus || '下一篇作文继续补足观点、材料、分析和回扣链条。';
    const evidence = [
      strongest ? `优势：${strongest.name} ${strongest.score}/${strongest.full}，${strongest.diagnosis}` : null,
      weakest ? `短板：${weakest.name} ${weakest.score}/${weakest.full}，${weakest.guidance}` : null,
      depth?.reason ? `思维深度：${depth.current_layer || depth.label}，${depth.reason}` : null,
      problems.length ? `文本问题：${problems.join('；')}` : null
    ].filter(Boolean);
    const detailed_analysis = evidence.length
      ? `这篇作文得分 ${row.total_score ?? '未评分'}。${evidence.join(' ')} 修改重点：${revisionTask}`
      : `这篇作文得分 ${row.total_score ?? '未评分'}，后续需要结合批改结果继续补充思维分析。`;
    return {
      essay_id: row.id,
      essay_title,
      score: row.total_score,
      detailed_analysis,
      evidence,
      next_step: revisionTask
    };
  }).filter(Boolean).slice(-6);
}
