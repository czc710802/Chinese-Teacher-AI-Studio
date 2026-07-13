export const scoreTrendThreshold = 3;

function normalizeScore(score, maxScore = 60) {
  const value = Number(score);
  const max = Number(maxScore) || 60;
  if (!Number.isFinite(value)) return null;
  return Math.round(value / max * 100);
}

export function updateScoreHistory(records = []) {
  const items = records
    .filter((item) => Number.isFinite(Number(item.score)))
    .map((item) => ({
      archiveId: item.archiveId || item.id || '',
      essayTitle: item.essayTitle || '',
      score: Number(item.score),
      maxScore: Number(item.maxScore || item.fullScore || 60),
      normalizedScore: normalizeScore(item.score, item.maxScore || item.fullScore || 60),
      level: item.level || item.grade || '',
      createdAt: item.createdAt || ''
    }))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const scores = items.map((item) => item.score);
  const latest = scores.at(-1) ?? 0;
  const previous = scores.length > 1 ? scores.at(-2) : 0;
  const change = scores.length > 1 ? Number((latest - previous).toFixed(1)) : 0;
  let trend = 'insufficient_data';
  if (scores.length >= 2) {
    if (change >= scoreTrendThreshold) trend = 'up';
    else if (change <= -scoreTrendThreshold) trend = 'down';
    else trend = 'stable';
  }
  return {
    items,
    statistics: {
      count: items.length,
      average: scores.length ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(1)) : 0,
      highest: scores.length ? Math.max(...scores) : 0,
      lowest: scores.length ? Math.min(...scores) : 0,
      latest,
      previous,
      change,
      trend
    }
  };
}
