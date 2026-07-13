export const ABILITY_DIMENSIONS = [
  '审题立意',
  '内容材料',
  '结构层次',
  '逻辑论证',
  '语言表达',
  '素材运用',
  '概念辨析',
  '段落展开',
  '扣题意识',
  '书写规范'
];

const aliases = {
  审题立意: ['审题立意', '立意', '审题'],
  内容材料: ['内容材料', '内容', '材料'],
  结构层次: ['结构层次', '结构', '层次'],
  逻辑论证: ['逻辑论证', '论证逻辑', '逻辑', '论证'],
  语言表达: ['语言表达', '表达', '语言'],
  素材运用: ['素材运用', '素材', '材料使用'],
  概念辨析: ['概念辨析', '概念'],
  段落展开: ['段落展开', '展开'],
  扣题意识: ['扣题意识', '扣题', '回扣'],
  书写规范: ['书写规范', '书写', '错别字']
};

function normalize(score, full) {
  const raw = Number(score);
  const max = Number(full);
  if (!Number.isFinite(raw) || !Number.isFinite(max) || max <= 0) return null;
  return Math.round(raw / max * 100);
}

function findDimension(report, dimension) {
  const rows = Array.isArray(report?.dimensionScores) ? report.dimensionScores
    : Array.isArray(report?.dimension_scores) ? report.dimension_scores : [];
  const names = aliases[dimension] || [dimension];
  return rows.find((item) => names.some((name) => String(item?.name || '').includes(name))) || null;
}

export function updateAbilityHistory(entries = []) {
  const dimensions = Object.fromEntries(ABILITY_DIMENSIONS.map((dimension) => [dimension, []]));
  for (const entry of entries) {
    for (const dimension of ABILITY_DIMENSIONS) {
      const found = findDimension(entry.report || {}, dimension);
      dimensions[dimension].push({
        archiveId: entry.archiveId || '',
        score: found ? normalize(found.score, found.full || found.maxScore || found.max) : null,
        rawScore: found ? Number(found.score) : null,
        maxScore: found ? Number(found.full || found.maxScore || found.max || 0) : null,
        createdAt: entry.createdAt || ''
      });
    }
  }
  const averages = ABILITY_DIMENSIONS.map((dimension) => {
    const values = dimensions[dimension].map((item) => item.score).filter((value) => Number.isFinite(value));
    return { dimension, average: values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null };
  }).filter((item) => item.average !== null);
  const strongest = [...averages].sort((a, b) => b.average - a.average)[0]?.dimension || '';
  const weakest = [...averages].sort((a, b) => a.average - b.average)[0]?.dimension || '';
  return { dimensions, statistics: { strongestAbility: strongest, weakestAbility: weakest, averages } };
}
