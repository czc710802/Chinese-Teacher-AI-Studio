export function generateTrainingPlan({ essayCount = 0, topIssues = [], weakestAbilities = [] } = {}) {
  const primaryAbility = weakestAbilities[0] || '逻辑论证';
  const primaryIssue = topIssues[0] || { code: 'GENERAL_WRITING', label: '综合写作提升' };
  const sampleStatus = essayCount < 3 ? 'insufficient_data' : 'sufficient';
  const templates = [
    ['核心概念辨析', '明确题目关键词之间的关系', '用“是什么、为什么、怎么办”写出 3 组概念辨析句。'],
    ['论据分析加深', '让材料真正证明观点', '选一则作文素材，补写原因、条件、结果三句分析。'],
    ['段落展开训练', '形成完整论证段', '按“观点-解释-材料-分析-回扣”写 180 字主体段。'],
    ['扣题意识训练', '避免材料游离题目', '把最近作文中的一个事例改写为带关键词回扣的论据。'],
    ['语言表达修订', '提升句子准确度和节奏', '挑出 5 个长句，改成更清楚的判断句和分析句。'],
    ['结构层次梳理', '增强文章递进感', '为下一篇作文写四段式提纲，并标出每段功能。'],
    ['限时综合修改', '把训练迁移到整篇文章', '用 25 分钟重写一段主体段，并自查是否回应中心论点。']
  ];
  return {
    generatedAt: new Date().toISOString(),
    sampleStatus,
    basis: {
      essayCount,
      topIssues,
      weakestAbilities
    },
    weeklyPlan: templates.map(([title, goal, task], index) => ({
      day: index + 1,
      title,
      goal,
      task: sampleStatus === 'insufficient_data' ? `${task}（当前样本不足，先作为基础训练。）` : task,
      estimatedMinutes: 20,
      relatedIssueCodes: [primaryIssue.code].filter(Boolean)
    })),
    priority: [
      {
        rank: 1,
        ability: primaryAbility,
        reason: `${primaryIssue.label || '当前主要问题'}出现频率较高，应优先训练${primaryAbility}。${sampleStatus === 'insufficient_data' ? '当前少于 3 篇作文，结论仅作阶段参考。' : ''}`,
        recommendedExercises: ['概念辨析句', '论据后分析句', '五步主体段']
      }
    ]
  };
}
