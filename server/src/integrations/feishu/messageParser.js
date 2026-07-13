const DEFAULT_FEISHU_REPLY = '我已收到消息。请发送“批改作文+作文正文”，也可以直接发送完整作文。';

const COMMAND_GROUPS = [
  { key: 'workbench', prefixes: ['workbench', '教师工作台', '打开教师工作台', '我的工作台', '查看我的班级'] },
  { key: 'bind_teacher', prefixes: ['绑定教师', '教师绑定', 'bind teacher'] },
  { key: 'essay', prefixes: ['批改作文', '作文批改', '帮我批改', '点评作文', '批改', '作文', 'essay'] },
  { key: 'help', prefixes: ['帮助', 'help'] },
  { key: 'status', prefixes: ['状态', 'status'] },
  { key: 'daily', prefixes: ['日报', 'daily'] },
  { key: 'backup', prefixes: ['备份', 'backup'] },
  { key: 'nas', prefixes: ['NAS 文件', 'nas 文件', 'NAS', 'nas', '网盘文件', '极空间文件'] },
  { key: 'logs', prefixes: ['日志', 'logs'] },
  { key: 'paper', prefixes: ['试卷', 'paper'] },
  { key: 'ppt', prefixes: ['ppt'] },
  { key: 'morning', prefixes: ['晨报', 'morning'] },
  { key: 'restart', prefixes: ['restart', '重启'] }
];

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeString(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function parseFeishuContentValue(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function stripFeishuDecoration(text = '') {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/<at[^>]*>.*?<\/at>/gis, ' ')
    .replace(/<at[^>]*\/>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/@机器人/gi, ' ')
    .replace(/[@＠][^\s@＠]+/g, ' ')
    .replace(/[*_`~]/g, ' ');
}

export function cleanFeishuText(text = '') {
  return stripFeishuDecoration(text)
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractFeishuMessageText(message = {}) {
  const content = parseFeishuContentValue(message.content);
  if (typeof content.text === 'string') return content.text;
  if (typeof content.title === 'string') return content.title;
  if (typeof content.content === 'string') return content.content;
  if (typeof message.content === 'string') return message.content;
  return '';
}

export function countFeishuVisibleChars(text = '') {
  return cleanFeishuText(text).replace(/\s+/g, '').length;
}

function matchCommandPrefix(text, prefix) {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}(?:[\\s:：,，。！？!?+\\-]*)`, 'i');
  return text.match(pattern);
}

function classifyByPrefix(text = '') {
  const normalizedText = cleanFeishuText(text);
  const withoutSlash = normalizedText.replace(/^\/+/, '');
  for (const group of COMMAND_GROUPS) {
    const prefixes = [...group.prefixes].sort((a, b) => b.length - a.length);
    for (const prefix of prefixes) {
      const match = matchCommandPrefix(withoutSlash, prefix);
      if (match) {
        const commandText = cleanFeishuText(withoutSlash.slice(match[0].length));
        return {
          key: group.key,
          text: commandText,
          normalized: withoutSlash.replace(/\s+/g, '').toLowerCase(),
          raw: text
        };
      }
    }
  }
  return {
    key: 'unknown',
    text: '',
    normalized: withoutSlash.replace(/\s+/g, '').toLowerCase(),
    raw: text
  };
}

export function parseFeishuCommand(input) {
  return classifyByPrefix(input);
}

export function parseFeishuIncomingMessage(input = {}, { botName = 'Chinese Teacher AI Studio' } = {}) {
  const event = input?.event || input;
  const message = event?.message || input?.message || input || {};
  const sender = event?.sender || input?.sender || {};
  const senderId = sender?.sender_id || sender?.senderId || {};
  const rawContent = message.content;
  const rawText = extractFeishuMessageText(message);
  const text = cleanFeishuText(rawText);
  const command = parseFeishuCommand(text);
  const messageId = message.message_id || message.messageId || '';
  const chatId = message.chat_id || message.chatId || '';
  const messageType = String(message.message_type || message.msg_type || input.messageType || input.rawContentType || 'text').toLowerCase();
  const wordCount = countFeishuVisibleChars(text);
  const mentions = Array.isArray(message.mentions) ? message.mentions : [];

  return {
    messageId,
    chatId,
    messageType,
    rawContent: safeString(rawContent),
    rawText,
    text,
    command,
    wordCount,
    senderId: senderId.open_id || senderId.user_id || senderId.union_id || sender.open_id || sender.user_id || sender.union_id || '',
    senderOpenId: senderId.open_id || sender.open_id || '',
    senderUserId: senderId.user_id || sender.user_id || '',
    senderUnionId: senderId.union_id || sender.union_id || '',
    senderName: sender.sender_name || '',
    mentions,
    raw: input,
    botName
  };
}

export function classifyFeishuIncomingMessage(input = {}, options = {}) {
  const parsed = parseFeishuIncomingMessage(input, options);
  const hasChinese = /[\u4e00-\u9fa5]/.test(parsed.text);
  const isLongEssay = parsed.messageType === 'text' && parsed.wordCount >= 100 && hasChinese;
  const explicitEssay = parsed.command.key === 'essay' && parsed.command.text.length > 0;
  const essayPromptOnly = parsed.command.key === 'essay' && parsed.command.text.length === 0;

  if (explicitEssay) {
    return {
      ...parsed,
      mode: 'essay',
      command: { ...parsed.command, key: 'essay' },
      essayText: parsed.command.text,
      replyText: ''
    };
  }

  if (isLongEssay) {
    return {
      ...parsed,
      mode: 'essay',
      command: { ...parsed.command, key: 'essay', autoDetected: true, text: parsed.text },
      essayText: parsed.text,
      replyText: ''
    };
  }

  if (essayPromptOnly) {
    return {
      ...parsed,
      mode: 'help',
      replyText: DEFAULT_FEISHU_REPLY,
      essayText: ''
    };
  }

  if (parsed.command.key === 'unknown') {
    return {
      ...parsed,
      mode: 'unknown',
      replyText: DEFAULT_FEISHU_REPLY,
      essayText: ''
    };
  }

  return {
    ...parsed,
    mode: 'command',
    replyText: '',
    essayText: parsed.command.text || ''
  };
}

export function getFeishuDefaultReply() {
  return DEFAULT_FEISHU_REPLY;
}
