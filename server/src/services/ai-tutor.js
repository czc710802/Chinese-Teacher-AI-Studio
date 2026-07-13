import { getTextProvider, callTextModel, parseAIJsonObject } from './openai.js';

/**
 * AI 辅导老师 — 解释作文得分和问题
 */
export async function tutorChat({ essay, review, studentQuestion, history = [] }) {
  const messages = history.map((m) => `${m.role}：${m.message}`).join('\n');
  const prompt = `你是一位耐心细致的高中语文教师，正在为学生解答关于作文批改的问题。

【作文任务】${essay.assignment_title}（${essay.essay_type}）
【学生作文片段】${(essay.original_text || '').slice(0, 600)}
【AI批改总分】${review?.total_score || '暂无'}分
【AI评语】${review?.problems?.join('；') || '暂无'}
【历史对话】
${messages || '无'}

【学生提问】${studentQuestion}

请以教师的口吻，用温和鼓励的语气解答学生的疑问，给出具体的修改建议和提升方向。回答要结合高考作文评分标准，指出学生可以实际操作的方法。控制在 300 字以内。`;

  return callTextModel(prompt, { taskType: 'quick_feedback' });
}

/**
 * 仿写训练 — 根据范文生成练习题
 */
export async function generateWritingExercise({ sourceText, exerciseType }) {
  const typeMap = {
    imitation: '仿写练习：分析范文的结构和语言特点，按照相同的结构写一段相似主题的文字',
    continuation: '续写练习：根据范文的开头和思路，续写文章的后半部分',
    rewrite: '改写练习：保持原文观点不变，用不同的论证方式重新表达',
    outline: '提纲练习：根据范文内容，提炼出文章的论证结构提纲'
  };

  const prompt = `你是一位高中语文写作教师。请根据以下范文，生成一道作文训练题。

训练类型：${typeMap[exerciseType] || '仿写练习'}

【范文】
${sourceText}

请输出 JSON 格式（不要 Markdown，不要额外解释）：
{
  "exercise_type": "${exerciseType}",
  "title": "练习标题",
  "instruction": "具体的练习要求（200字以内，清晰可操作）",
  "hint": "写作提示（帮助学生完成练习）",
  "reference_outline": "参考结构或思路（100字以内）"
}`;

  const text = await callTextModel(prompt, { jsonMode: true, taskType: 'quick_feedback' });
  return parseAIJsonObject(text);
}

/**
 * 作文升格 — 将低分作文提升为高分作文
 */
export async function upgradeEssay({ originalText, originalScore, targetScore = 55, fullScore = 60 }) {
  const prompt = `你是一位高考作文阅卷专家、高中语文特级教师。请将以下 ${originalScore} 分（满分 ${fullScore} 分）的作文提升至 ${targetScore} 分水平。

要求：
1. 保留学生的核心观点，但必须深度重写薄弱段落，允许调整段落顺序和论证结构。
2. 不得只做同义词替换、错别字修正或轻微润色；必须让升格稿与原文形成明显差异。
3. 深化立意，增加思辨层次，并补足关键概念辨析。
4. 优化论据运用，重构薄弱段落，使论证更充分、更有递进。
5. 改进开头和结尾，增强首尾呼应与表达张力。
6. 篇幅可按升格需要适度增删，以完整表达和高考高分水平为准。

【原文】
${originalText}

请输出 JSON 格式（不要 Markdown）：
{
  "original_score": ${originalScore},
  "upgraded_score": ${targetScore},
  "upgraded_text": "升格后的完整作文",
  "change_summary": "总体修改说明（50字以内）",
  "paragraph_changes": [
    {
      "part": "开头（第1段）",
      "original": "原文片段",
      "upgraded": "升格后片段",
      "reason": "修改理由"
    }
  ],
  "key_improvements": ["提升点1", "提升点2", "提升点3"],
  "retained_strengths": ["保留的优点1", "保留的优点2"]
}`;

  const text = await callTextModel(prompt, { jsonMode: true, taskType: 'deep_revision', maxTokens: 4000 });
  return parseAIJsonObject(text);
}

/**
 * 高考阅卷模拟 — 双评/三评
 */
export async function mockMark({ essayText, assignment }) {
  const prompt = `你是一位高考作文阅卷教师。请严格按照高考作文评分标准，对以下作文进行独立评分。

【作文题目】${assignment?.title || '未命名'}
【作文材料】${assignment?.prompt || '无'}
【满分】${assignment?.full_score || 60}

【学生作文】
${essayText}

请按以下维度评分并输出 JSON：
{
  "total_score": 数字,
  "level": "一类文/二类文/三类文/四类文",
  "dimension_scores": {
    "内容": {"score": 数字, "full": 20, "comment": "..."},
    "表达": {"score": 数字, "full": 20, "comment": "..."},
    "发展等级": {"score": 数字, "full": 20, "comment": "..."}
  },
  "strengths": ["..."],
  "weaknesses": ["..."],
  "confidence": "high/medium/low"
}`;

  const text = await callTextModel(prompt, { jsonMode: true, taskType: 'essay_grading' });
  return parseAIJsonObject(text);
}

/**
 * 三评仲裁
 */
export async function arbitrateMark({ marker1, marker2, marker3, essayText, assignment }) {
  const prompt = `你是一位高考作文阅卷仲裁组组长。两位（或三位）阅卷教师对同一篇作文的评分存在差异，请进行仲裁。

【作文题目】${assignment?.title || '未命名'}
【满分】${assignment?.full_score || 60}

【作文原文】
${(essayText || '').slice(0, 800)}

【阅卷教师1评分】
总分：${marker1?.total_score}
分项：${JSON.stringify(marker1?.dimension_scores || {})}

【阅卷教师2评分】
总分：${marker2?.total_score}
分项：${JSON.stringify(marker2?.dimension_scores || {})}

${marker3 ? `【阅卷教师3评分】
总分：${marker3?.total_score}
分项：${JSON.stringify(marker3?.dimension_scores || {})}` : ''}

请分析评分差异原因，给出仲裁结果。输出 JSON：
{
  "final_score": 数字,
  "final_level": "...",
  "arbitration_reason": "仲裁说明",
  "dimension_final": {
    "内容": {"score": 数字, "full": 20},
    "表达": {"score": 数字, "full": 20},
    "发展等级": {"score": 数字, "full": 20}
  }
}`;

  const text = await callTextModel(prompt, { jsonMode: true, taskType: 'logic_analysis' });
  return parseAIJsonObject(text);
}

/**
 * 教师晨报 — 自动生成每日教育资讯
 */
export async function generateDailyBriefing() {
  const prompt = `你是一位高中语文教学研究员。请生成一份今日语文教学晨报，包含以下内容：

1. **教育热点**：当前中国教育领域的一个热点话题（200字以内）
2. **高考资讯**：一条与高考语文相关的备考建议或政策动态
3. **作文素材**：一则适用于高中作文的时事素材，包含事件简述和运用角度
4. **时评金句**：一则社会热点评论的金句，注明来源
5. **名言积累**：一句适合作文引用的经典名言，附出处和适用主题

请以 JSON 格式输出：
{
  "date": "2026-06-21",
  "hot_topic": {"title": "...", "content": "..."},
  "exam_news": "...",
  "material": {"event": "...", "angles": ["..."]},
  "quote": {"text": "...", "source": "...", "topics": ["..."]},
  "famous_saying": {"text": "...", "author": "...", "usage": "..."}
}`;

  const text = await callTextModel(prompt, { jsonMode: true, taskType: 'summary' });
  return parseAIJsonObject(text);
}

/**
 * 班级学情诊断与教学建议
 */
export async function generateClassInsight({ analytics, className }) {
  const problems = (analytics?.commonProblems || []).slice(0, 5).map((p) => p.name).join('、');
  const avgScore = analytics?.averageScore || 0;
  const missingCount = analytics?.missingStudents?.length || 0;

  const prompt = `你是一位高中语文教研组长。请根据以下班级作文数据，生成学情诊断和教学建议。

【班级】${className}
【平均分】${avgScore}
【未提交人数】${missingCount}
【共性写作问题】${problems || '暂无数据'}

请输出 JSON：
{
  "diagnosis": "学情诊断（150字以内）",
  "teaching_suggestions": [
    {"priority": "高", "content": "教学建议1"},
    {"priority": "中", "content": "教学建议2"}
  ],
  "focus_training": "本周重点训练方向",
  "individual_attention": "需要重点关注的建议"
}`;

  const text = await callTextModel(prompt, { jsonMode: true, taskType: 'teacher_report' });
  return parseAIJsonObject(text);
}
