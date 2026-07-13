import fs from 'node:fs';
import path from 'node:path';

import { parseFeishuCommand } from './commands.js';
import { buildBackupCard, buildDailyReportCard, buildHelpCard, buildLogsCard, buildReservedCard, buildRestartCard, buildStatusCard } from './cards.js';
import { canExecuteFeishuCommand } from './auth.js';
import { loadFeishuConfig } from './config.js';
import { sendCardMessage, sendTextMessage } from './client.js';
import { getSystemStatus } from '../../services/system-status.js';
import { getSystemLogs } from '../../services/system-logs.js';
import { getLatestDailyReport } from '../../services/system-daily-report.js';
import { triggerBackup } from '../../services/system-backup.js';
import { handleFeishuEssayMessage } from './essayHandler.js';
import {
  classifyFeishuIncomingMessage,
  getFeishuDefaultReply
} from './messageParser.js';

function extractReceiveTarget(body) {
  const event = body?.event || {};
  return {
    receiveId: event.chat_id || event.sender?.sender_id?.open_id || event.sender?.sender_id?.union_id || '',
    receiveIdType: event.chat_id ? 'chat_id' : event.sender?.sender_id?.open_id ? 'open_id' : 'union_id'
  };
}

function tailFile(filePath, lines = 20) {
  if (!fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) return '';
  const items = content.split('\n');
  return items.slice(-lines).join('\n');
}

function summarizeLogs(appDir) {
  const candidates = [
    path.join(appDir, 'logs', 'server.err.log'),
    path.join(appDir, 'logs', 'watchdog.log'),
    path.join(appDir, 'logs', 'notify.log')
  ];
  for (const filePath of candidates) {
    const content = tailFile(filePath, 8);
    if (content) return content;
  }
  return '暂无错误摘要';
}

export async function routeFeishuEvent({
  body,
  env = process.env,
  appDir = path.resolve(process.cwd(), '..'),
  fetchImpl = fetch,
  zspaceClient,
  logger = console
} = {}) {
  const incoming = classifyFeishuIncomingMessage(body, { botName: loadFeishuConfig(env).botName });
  const command = incoming.command || parseFeishuCommand(incoming.text);
  const messageType = incoming.messageType || body?.event?.message?.message_type || 'text';
  const { receiveId, receiveIdType } = extractReceiveTarget(body);
  const status = getSystemStatus({ appDir, env });
  const adminAllowed = canExecuteFeishuCommand({
    commandKey: command.key,
    openId: body?.event?.sender?.sender_id?.open_id || body?.event?.sender?.open_id || '',
    config: loadFeishuConfig(env)
  });

  let responseType = 'text';
  let responseContent = getFeishuDefaultReply();
  let responseMessage = responseContent;
  let responseExtra = {};

  if (incoming.text === '你好') {
    responseContent = '你好，我是 Chinese Teacher AI Studio。';
    responseMessage = responseContent;
  } else if (incoming.mode === 'essay' || ['image', 'file'].includes(messageType)) {
    const essayResult = await handleFeishuEssayMessage({ body, command: { ...command, text: incoming.essayText }, env, appDir, status, zspaceClient, logger });
    responseType = essayResult.responseType || 'text';
    responseContent = essayResult.responseContent || essayResult.message || responseContent;
    responseMessage = essayResult.message || responseMessage;
    responseExtra = essayResult;
  } else if (command.key === 'help') {
    responseType = 'card';
    responseContent = buildHelpCard();
    responseMessage = 'card sent';
  } else if (command.key === 'status') {
    responseType = 'card';
    responseContent = buildStatusCard(status);
    responseMessage = 'card sent';
  } else if (command.key === 'daily') {
    const report = getLatestDailyReport({ appDir });
    responseType = 'card';
    responseContent = buildDailyReportCard({
      reportPath: report.path || status.latestDailyReport?.path || '',
      summary: report.summary || status.latestDailyReport?.summary || '暂无最近日报'
    });
    responseMessage = 'card sent';
  } else if (command.key === 'logs') {
    if (!adminAllowed) {
      responseContent = '权限不足，仅管理员可查看日志';
      responseMessage = responseContent;
    } else {
      const logs = getSystemLogs({ appDir });
      responseType = 'card';
      responseContent = buildLogsCard({ summary: logs.summary || summarizeLogs(appDir) });
      responseMessage = 'card sent';
    }
  } else if (command.key === 'backup') {
    if (!adminAllowed) {
      responseContent = '权限不足，仅管理员可执行备份';
      responseMessage = responseContent;
    } else {
      const backupResult = triggerBackup({ appDir });
      responseType = 'card';
      responseContent = buildBackupCard({ ok: backupResult.ok, path: backupResult.path || '', message: backupResult.message || '' });
      responseMessage = 'card sent';
    }
  } else if (command.key === 'essay' && !incoming.essayText) {
    responseContent = getFeishuDefaultReply();
    responseMessage = responseContent;
  } else if (['essay', 'paper', 'ppt', 'morning'].includes(command.key)) {
    responseContent = '功能入口已预留，将在 V11.1 接入';
    responseMessage = responseContent;
  } else if (command.key === 'restart') {
    if (!adminAllowed) {
      responseContent = '权限不足，仅管理员可执行重启';
      responseMessage = responseContent;
    } else {
      responseType = 'card';
      responseContent = buildRestartCard({ confirmToken: loadFeishuConfig(env).restartConfirmToken });
      responseMessage = 'card sent';
    }
  }

  if (receiveId) {
    if (responseType === 'card') {
      await sendCardMessage({ env, receiveId, receiveIdType, card: responseContent, fetchImpl });
    } else {
    await sendTextMessage({ env, receiveId, receiveIdType, text: responseContent, fetchImpl });
  }
  }

  return {
    statusCode: 200,
    body: {
      ok: true,
      command: command.key,
      message: responseMessage,
      analysisId: responseExtra.analysisId || responseExtra.id || '',
      status: responseExtra.status || '',
      result: responseExtra.result || null
    }
  };
}
