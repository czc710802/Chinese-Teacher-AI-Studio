function formatList(items = []) {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- 暂无';
}

function stringifyItem(item) {
  if (item == null || item === '') return '暂无';
  if (typeof item === 'string') return item;
  if (typeof item === 'number' || typeof item === 'boolean') return String(item);
  if (Array.isArray(item)) return item.map(stringifyItem).join('；');
  if (item.focus || item.title || item.type) {
    return [
      item.type ? `【${item.type}】` : '',
      item.focus || item.title || '',
      item.goal ? `目标：${item.goal}` : '',
      item.task ? `任务：${item.task}` : '',
      item.diagnosis ? `诊断：${item.diagnosis}` : '',
      item.logic_analysis ? `逻辑：${item.logic_analysis}` : '',
      item.action_steps ? `步骤：${item.action_steps}` : '',
      item.example_direction ? `示例：${item.example_direction}` : '',
      item.reason ? `理由：${item.reason}` : '',
      item.usage ? `用法：${item.usage}` : '',
      item.checkpoint ? `自查：${item.checkpoint}` : ''
    ].filter(Boolean).join(' ');
  }
  if (item.paragraph || item.original || item.revision) {
    return [
      item.paragraph ? `第${item.paragraph}段` : '',
      item.original ? `原文：${item.original}` : '',
      item.problem ? `问题：${item.problem}` : '',
      item.revision ? `修改：${item.revision}` : '',
      item.explanation ? `理由：${item.explanation}` : ''
    ].filter(Boolean).join('\n');
  }
  return Object.entries(item).map(([key, value]) => `${key}：${stringifyItem(value)}`).join('；');
}

function formatRich(value) {
  if (Array.isArray(value)) return value.length ? value.map((item) => `- ${stringifyItem(item)}`).join('\n') : '- 暂无';
  return stringifyItem(value);
}

function formatDimensionScores(items = []) {
  if (!items.length) return '- 暂无';
  return items.map((item) => `- ${item.name || '维度'}：${item.score ?? '-'} / ${item.full ?? '-'}  ${item.comment || ''}`.trim()).join('\n');
}

function formatOptionalList(value = []) {
  const items = Array.isArray(value) ? value : [value].filter(Boolean);
  return items.length ? items.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n') : '- 暂无';
}

export function buildEssayReportMarkdown(record = {}) {
  const result = record.result || {};
  const title = record.title || '未命名作文';
  const createdAt = record.createdAt || '';
  const suggestionLines = formatRich(result.suggestions || []);
  const gaokao = result.gaokaoScoring || {};

  return `# 作文 AI 批改报告

- 标题：${title}
- 来源：${record.source || 'api'}
- 状态：${record.status || 'completed'}
- 时间：${createdAt}
- 总分：${result.totalScore ?? '-'} / ${result.fullScore ?? 60}
- 等级：${result.level || '-'}

## 总体评价
${result.overallEvaluation || result.teacherComment || '暂无'}

## 审题立意
${result.topicIntentAnalysis || '暂无'}

### 维度得分
${formatDimensionScores(result.dimensionScores || [])}

## 结构分析
${result.structureAnalysis || '暂无'}

## 逻辑分析
${result.logicAnalysis || '暂无'}

## 语言分析
${result.languageAnalysis || '暂无'}

## 素材分析
${result.materialAnalysis || '暂无'}

### 推荐素材
${formatRich(result.recommendedMaterials || [])}

## 高考评分
${formatRich(gaokao)}

## 核心优点
${formatList(result.coreAdvantages || [])}

## 主要问题
${formatList(result.mainProblems || [])}

## 修改建议
${suggestionLines}

## 逐段精修
${formatRich(result.paragraphRefinements || [])}

## 段落分析
${formatOptionalList(result.paragraphAnalysis || result.paragraph_analysis || [])}

## 句子分析
${formatOptionalList(result.sentenceAnalysis || result.sentence_analysis || [])}

## 升格示例
${result.upgradedParagraph || '暂无'}

## 整篇升格文章
${result.excellentVersion || result.polishedFullText || '暂无'}

## 教师评语
${result.teacherComment || '暂无'}

## 训练任务
${formatRich(result.trainingTasks || result.nextTraining || [])}

## 成长分析
${formatRich(result.growthAnalysis || {})}
`;
}

export function summarizeEssayRecord(record = {}) {
  const result = record.result || {};
  return {
    id: record.id,
    createdAt: record.createdAt || '',
    title: record.title || '未命名作文',
    score: result.totalScore ?? null,
    level: result.level || '',
    source: record.source || 'api',
    status: record.status || 'completed'
  };
}
