const ISSUE_RULES = [
  {
    code: 'ARGUMENT_ANALYSIS_WEAK',
    label: '论据分析不足',
    patterns: [/论据.*分析.*不足/, /材料.*分析.*不充分/, /举例后.*扣题分析/, /缺少扣题分析/, /分析不充分/]
  },
  {
    code: 'STRUCTURE_UNCLEAR',
    label: '结构层次不清',
    patterns: [/结构.*不清/, /层次.*不清/, /段落.*混乱/]
  },
  {
    code: 'LANGUAGE_EXPRESSION_WEAK',
    label: '语言表达不够准确',
    patterns: [/语言/, /表达/, /病句/, /错别字/]
  },
  {
    code: 'THESIS_FOCUS_WEAK',
    label: '审题立意不够集中',
    patterns: [/立意/, /审题/, /中心论点/, /观点.*不明确/]
  },
  {
    code: 'MATERIAL_USAGE_WEAK',
    label: '素材运用不足',
    patterns: [/素材/, /材料/, /事例/]
  }
];

function stableCode(text) {
  return `ISSUE_${Buffer.from(String(text || 'UNKNOWN')).toString('hex').slice(0, 12).toUpperCase()}`;
}

export function normalizeIssue(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  for (const rule of ISSUE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) return { code: rule.code, label: rule.label };
  }
  const label = text.slice(0, 28) || '未归类问题';
  return { code: stableCode(label), label };
}

function collectIssues(report = {}) {
  return [
    ...(Array.isArray(report.problems) ? report.problems : []),
    ...(Array.isArray(report.weaknesses) ? report.weaknesses : []),
    report.logicAnalysis,
    report.languageAnalysis,
    report.intentAnalysis,
    report.materialAnalysis,
    ...(Array.isArray(report.suggestions) ? report.suggestions : []),
    ...(Array.isArray(report.teacherComments) ? report.teacherComments : [])
  ].filter(Boolean);
}

export function updateIssueStatistics(entries = []) {
  const total = entries.length || 1;
  const buckets = new Map();
  for (const entry of entries) {
    for (const issue of collectIssues(entry.report)) {
      const normalized = normalizeIssue(issue);
      const current = buckets.get(normalized.code) || {
        code: normalized.code,
        label: normalized.label,
        count: 0,
        ratio: 0,
        lastSeenAt: '',
        sampleArchiveIds: []
      };
      current.count += 1;
      current.lastSeenAt = entry.createdAt || current.lastSeenAt;
      if (current.sampleArchiveIds.length < 5 && entry.archiveId) current.sampleArchiveIds.push(entry.archiveId);
      buckets.set(normalized.code, current);
    }
  }
  const issues = [...buckets.values()]
    .map((item) => ({ ...item, ratio: Number((item.count / total).toFixed(2)) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
  return { issues };
}
