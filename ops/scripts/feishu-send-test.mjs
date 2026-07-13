import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFeishuService } from '../../server/src/integrations/feishu/service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    env[key] = value;
  }
  return env;
}

function summarizeSendResult(label, targetChatId, result = {}) {
  return {
    label,
    ok: result.ok !== false && Number(result.code ?? 0) === 0,
    code: Number(result.code ?? 0),
    msg: result.msg || '',
    request_id: result.requestId || '',
    data_message_id: result.dataMessageId || result.messageId || '',
    actual_mode: result.mode || '',
    actual_chat_id: result.chatId || targetChatId,
    actual_message_id: result.replyToMessageId || '',
    receive_id_type: result.receiveIdType || ''
  };
}

function buildProbeCard() {
  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'green',
      title: { tag: 'plain_text', content: 'Chinese Teacher AI Studio' }
    },
    elements: [
      {
        tag: 'div',
        text: { tag: 'lark_md', content: '**AI 已收到作文。**\n\nCard 发送测试。' }
      }
    ]
  };
}

async function sendTextProbe(service, chatId) {
  return service.replyMessage({
    target: chatId,
    chatId,
    replyType: 'text',
    text: 'AI 已收到作文。',
    forceMode: 'send'
  });
}

async function sendMarkdownProbe(service, chatId) {
  return service.replyMessage({
    target: chatId,
    chatId,
    replyType: 'markdown',
    markdown: '**AI 已收到作文。**\n\nMarkdown 发送测试。',
    forceMode: 'send'
  });
}

async function sendCardProbe(service, chatId) {
  return service.replyMessage({
    target: chatId,
    chatId,
    replyType: 'card',
    card: buildProbeCard(),
    forceMode: 'send'
  });
}

async function main() {
  const fileEnv = parseEnvFile(path.join(appDir, '.env.production'));
  const env = { ...process.env, ...fileEnv, FEISHU_REPLY_MODE: 'send' };
  const chatId = String(process.argv[2] || env.FEISHU_TEST_CHAT_ID || '').trim();
  if (!chatId) {
    console.error('缺少测试 chat_id。请设置 FEISHU_TEST_CHAT_ID，或执行：npm run feishu:send-test -- oc_xxx');
    process.exit(1);
  }
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    console.error('FEISHU_APP_ID / FEISHU_APP_SECRET 未配置，无法发送飞书测试消息。');
    process.exit(1);
  }

  const service = createFeishuService({ appDir, env });
  service.channel = service.buildChannel();
  if (!service.channel) {
    console.error('飞书发送客户端初始化失败。');
    process.exit(1);
  }

  const results = [];
  results.push(summarizeSendResult('text', chatId, await sendTextProbe(service, chatId)));
  results.push(summarizeSendResult('markdown', chatId, await sendMarkdownProbe(service, chatId)));
  results.push(summarizeSendResult('card', chatId, await sendCardProbe(service, chatId)));

  const allOk = results.every((item) => item.ok);
  console.log(JSON.stringify({
    ok: allOk,
    target_chat_id: chatId,
    target_message_id: '',
    results
  }, null, 2));
  if (!allOk) process.exit(1);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
