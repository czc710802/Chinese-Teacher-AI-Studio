import { analyzeEssay, listEssayHistory } from '../../../../apps/essay-ai/src/index.js';
import { buildEssayMenuCard, buildEssayResultCard } from './cards.js';
import { archiveFeishuEssayResult } from './archiveLinks.js';

function guessTitle(text = '') {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '飞书作文';
  return trimmed.slice(0, 12);
}

export async function handleFeishuEssayMessage({ body, command = {}, appDir, env = process.env, zspaceClient, logger = console } = {}) {
  const messageType = body?.event?.message?.message_type || 'text';
  if (messageType !== 'text') {
    return {
      responseType: 'text',
      message: '已收到作文文件，正在识别与批改'
    };
  }

  const essayText = String(command.text || '').trim();
  if (!essayText) {
    return {
      responseType: 'card',
      responseContent: buildEssayMenuCard(),
      message: '作文菜单'
    };
  }

  const analysis = await analyzeEssay({
    appDir,
    title: guessTitle(essayText),
    text: essayText,
    source: 'feishu'
  });
  const result = analysis.result || {};
  const senderId = body?.event?.sender?.sender_id?.open_id || body?.event?.sender?.open_id || '';
  const archiveLinks = await archiveFeishuEssayResult({
    appDir,
    env,
    client: zspaceClient,
    analysis,
    title: guessTitle(essayText),
    text: essayText,
    feishuUserId: senderId,
    logger
  });
  return {
    responseType: 'card',
    responseContent: buildEssayResultCard(result, { links: { ...(archiveLinks.links || {}), archiveId: archiveLinks.archiveId || '' } }),
    message: `作文 AI 批改结果：${result.totalScore ?? '暂无'} / ${result.fullScore ?? 60}，${result.level || '暂无'}；${String(result.overallEvaluation || result.teacherComment || result.teacher_overall || '').trim().slice(0, 120) || '暂无'}`,
    analysisId: analysis.id,
    archiveId: archiveLinks.archiveId || '',
    status: analysis.status,
    result,
    historyPreview: listEssayHistory({ appDir, limit: 5 })
  };
}
