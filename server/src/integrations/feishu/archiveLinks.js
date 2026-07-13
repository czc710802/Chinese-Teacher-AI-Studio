import { archiveSyntheticPayload } from '../../services/archive-pipeline.js';
import { buildArchiveDownloadLinks } from '../../services/file-access.js';
import { sanitizePathSegment } from '../../services/zspace-storage.js';

function safeUserSegment(value) {
  return sanitizePathSegment(String(value || '').replace(/[^\w\u4e00-\u9fa5-]+/g, ''), 'feishu-user').slice(0, 48) || 'feishu-user';
}

function normalizeSuggestions(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => typeof item === 'string' ? item : (item.focus || item.diagnosis || item.action || JSON.stringify(item)))
    .filter(Boolean);
}

function reportJsonFromResult(result = {}) {
  const dimensions = Array.isArray(result.dimensionScores) ? result.dimensionScores : [];
  const findDimension = (keyword) => dimensions.find((item) => String(item?.name || '').includes(keyword))?.comment || '';
  return {
    score: result.totalScore ?? result.score ?? null,
    grade: result.level || result.grade || '',
    level: result.level || result.grade || '',
    strengths: Array.isArray(result.coreAdvantages) ? result.coreAdvantages : (result.strengths || []),
    problems: Array.isArray(result.mainProblems) ? result.mainProblems : (result.problems || []),
    weaknesses: Array.isArray(result.mainProblems) ? result.mainProblems : (result.weaknesses || []),
    dimensionScores: dimensions,
    logicAnalysis: result.logicAnalysis || findDimension('逻辑') || findDimension('结构'),
    languageAnalysis: result.languageAnalysis || findDimension('语言'),
    intentAnalysis: result.intentAnalysis || findDimension('审题') || findDimension('立意'),
    materialAnalysis: result.materialAnalysis || findDimension('内容') || findDimension('素材'),
    suggestions: normalizeSuggestions(result.suggestions),
    trainingTasks: Array.isArray(result.nextTraining) ? result.nextTraining : [],
    raw: result
  };
}

export async function archiveFeishuEssayResult({
  appDir,
  env = process.env,
  client,
  analysis = {},
  title = '',
  text = '',
  feishuUserId = '',
  studentName = '飞书用户',
  className = '飞书提交',
  logger = console
} = {}) {
  if (!analysis?.id || analysis.status !== 'completed') {
    return { ok: false, skipped: true, reason: 'analysis not completed', links: {} };
  }
  if (!client?.config?.enabled || typeof client.ensureDirectory !== 'function') {
    return { ok: false, skipped: true, reason: 'zspace disabled', links: {} };
  }

  try {
    const result = analysis.result || {};
    const archiveId = `feishu-${analysis.id}`;
    const reportJson = reportJsonFromResult(result);
    const archive = await archiveSyntheticPayload({
      appDir,
      client,
      logger,
      payload: {
        id: archiveId,
        studentNo: safeUserSegment(feishuUserId),
        studentName,
        className,
        essayTitle: title || analysis.title || '飞书作文',
        originalText: text,
        ocrText: analysis.ocr?.text || '',
        provider: result.provider || result.aiMeta?.provider || 'deepseek',
        model: result.model || result.aiMeta?.model || '',
        score: reportJson.score,
        grade: reportJson.grade,
        createdAt: new Date().toISOString(),
        reportJson
      }
    });
    if (!archive.ok || !archive.record?.id) return { ok: false, queued: archive.queued, archive, links: {} };
    const links = await buildArchiveDownloadLinks({
      appDir,
      archiveId: archive.record.id,
      userId: feishuUserId || 'feishu',
      env,
      client
    });
    return { ok: links.available, archive, archiveId: archive.record.id, links };
  } catch (error) {
    logger.warn?.('飞书批改结果归档链接生成失败，已回退摘要消息', { message: error?.message || String(error || '') });
    return { ok: false, errorCode: 'FEISHU_ARCHIVE_LINK_FAILED', links: {} };
  }
}
