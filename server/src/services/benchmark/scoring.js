const compareDimensions = [
  ['立意分析', 'topicIntentAnalysis'],
  ['审题分析', 'topicIntentAnalysis'],
  ['结构分析', 'structureAnalysis'],
  ['逻辑分析', 'logicAnalysis'],
  ['语言分析', 'languageAnalysis'],
  ['素材分析', 'materialAnalysis'],
  ['论证分析', 'argumentAnalysis'],
  ['教师点评', 'teacherComment'],
  ['修改建议', 'revisionSuggestions'],
  ['成长建议', 'growthSuggestions']
];

const scoreDimensions = ['批改深度', '教师价值', '逻辑分析', '语言分析', '素材分析', '修改质量', '成长指导', '可操作性'];

function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join('\n');
  return Object.values(value).map(textOf).join('\n');
}

function dimensionScore({ oldText, newText, weight = 1 }) {
  const oldLength = textOf(oldText).length;
  const newLength = textOf(newText).length;
  if (!newLength) return 0;
  const depth = Math.min(10, 4 + Math.log10(newLength + 1) * 2);
  const improvement = oldLength ? Math.min(2.5, Math.max(-2, (newLength - oldLength) / Math.max(100, oldLength))) : 1.5;
  return Number(Math.max(0, Math.min(10, (depth + improvement) * weight)).toFixed(2));
}

export function compareReports({ oldReport = {}, newReport = {} } = {}) {
  const dimensions = {};
  for (const [label, field] of compareDimensions) {
    const oldText = oldReport?.[field] || oldReport?.[label] || oldReport?.overall || oldReport;
    const newText = newReport?.[field] || newReport?.[label] || newReport?.overall || newReport;
    dimensions[label] = {
      oldLength: textOf(oldText).length,
      newLength: textOf(newText).length,
      improved: textOf(newText).length >= textOf(oldText).length,
      oldExcerpt: textOf(oldText).slice(0, 160),
      newExcerpt: textOf(newText).slice(0, 160)
    };
  }
  return {
    dimensions,
    comparedAt: new Date().toISOString(),
    summary: {
      improvedCount: Object.values(dimensions).filter((item) => item.improved).length,
      total: Object.keys(dimensions).length
    }
  };
}

export function scoreBenchmarkComparison(compareResult = {}, config = {}) {
  const weights = config?.scoring?.weights || {};
  const source = compareResult.dimensions || {};
  const dimensions = {};
  for (const label of scoreDimensions) {
    const mapped = source[label] || source[label.replace('批改', '教师')] || source['逻辑分析'] || {};
    dimensions[label] = dimensionScore({
      oldText: mapped.oldExcerpt || '',
      newText: mapped.newExcerpt || '',
      weight: Number(weights[label] || 1)
    });
  }
  const totalScore = Number(Object.values(dimensions).reduce((sum, value) => sum + value, 0).toFixed(2));
  const averageScore = Number((totalScore / Object.keys(dimensions).length).toFixed(2));
  const oldTotal = Object.values(source).reduce((sum, item) => sum + Number(item.oldLength || 0), 0);
  const newTotal = Object.values(source).reduce((sum, item) => sum + Number(item.newLength || 0), 0);
  const improvementRate = oldTotal ? Number((((newTotal - oldTotal) / oldTotal) * 100).toFixed(2)) : 100;
  return { dimensions, totalScore, averageScore, improvementRate, scoredAt: new Date().toISOString() };
}

export { compareDimensions, scoreDimensions };
