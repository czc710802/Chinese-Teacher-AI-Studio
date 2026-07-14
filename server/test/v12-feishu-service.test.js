import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { parseFeishuCommand } from '../src/integrations/feishu/commands.js';
import { parseFeishuIncomingMessage } from '../src/integrations/feishu/messageParser.js';
import { createFeishuService, getFeishuHealthSnapshot } from '../src/integrations/feishu/service.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('feishu service exposes websocket health fields without secrets', () => {
  const service = createFeishuService({
    appDir: rootDir,
    env: {
      FEISHU_BOT_NAME: 'Chinese Teacher AI Studio'
    }
  });

  const health = service.getHealth();
  assert.equal(health.connectionMode, 'websocket');
  assert.equal(health.appConfigured, false);
  assert.equal(health.connected, false);
  assert.match(health.logPath, /logs\/feishu-connect\.log$/);
  assert.equal(health.botInfo.name, 'Chinese Teacher AI Studio');

  const snapshot = getFeishuHealthSnapshot({ service });
  assert.equal(snapshot.connectionMode, 'websocket');
  assert.equal(snapshot.ok, false);
});

test('feishu service returns a stable bot info fallback from env', () => {
  const service = createFeishuService({
    appDir: rootDir,
    env: {
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret',
      FEISHU_BOT_NAME: 'Chinese Teacher AI Studio'
    }
  });

  const info = service.getBotInfo();
  assert.equal(info.name, 'Chinese Teacher AI Studio');
  assert.equal(info.appId, 'app-id');
});

test('feishu essay triggers recognize command prefixes and keep the body text', () => {
  assert.equal(parseFeishuCommand('批改作文+这是正文').key, 'essay');
  assert.equal(parseFeishuCommand('批改作文+这是正文').text, '这是正文');
  assert.equal(parseFeishuCommand('作文批改：这是正文').key, 'essay');
  assert.equal(parseFeishuCommand('帮我批改 这是正文').key, 'essay');
  assert.equal(parseFeishuCommand('点评作文 这是正文').key, 'essay');
});

test('feishu message parser reads JSON content and strips mention noise', () => {
  const parsed = parseFeishuIncomingMessage({
    event: {
      message: {
        message_id: 'msg-1',
        chat_id: 'chat-1',
        message_type: 'text',
        content: JSON.stringify({ text: '@机器人\n批改作文：\n这是第一段。\n这是第二段。' })
      }
    }
  });

  assert.equal(parsed.messageId, 'msg-1');
  assert.equal(parsed.chatId, 'chat-1');
  assert.equal(parsed.messageType, 'text');
  assert.equal(parsed.command.key, 'essay');
  assert.doesNotMatch(parsed.text, /@机器人/);
  assert.doesNotMatch(parsed.text, /\n/);
});

test('feishu service replies to 你好 immediately', async () => {
  const service = createFeishuService({
    appDir: rootDir,
    env: {
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret',
      FEISHU_BOT_NAME: 'Chinese Teacher AI Studio'
    }
  });

  const calls = [];
  service.sendMessage = async (...args) => {
    calls.push(args);
    return { ok: true };
  };

  const result = await service.receiveMessage({
    chatId: 'chat-1',
    sender: {
      sender_id: {
        user_id: 'user-1',
        open_id: 'ou-1'
      }
    },
    content: '你好'
  });

  assert.equal(result.ok, true);
  assert.equal(result.command, 'greeting');
  assert.equal(result.sent, 'text');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'user-1');
  assert.equal(calls[0][1], '你好，我是 Chinese Teacher AI Studio。');
  assert.equal(calls[0][2].replyMode, 'send');
  assert.equal(calls[0][2].replyTo, '');
  assert.equal(calls[0][2].receiveIdType, 'user_id');
});

test('feishu service auto-detects long Chinese text as an essay review request', async () => {
  const service = createFeishuService({
    appDir: rootDir,
    env: {
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret',
      FEISHU_BOT_NAME: 'Chinese Teacher AI Studio'
    },
    analyzeEssay: async ({ text, title, source }) => ({
      status: 'completed',
      id: 'essay-1',
      result: {
        totalScore: 58,
        fullScore: 60,
        level: '优秀',
        teacherComment: '很好'
      },
      text,
      title,
      source
    })
  });

  const cards = [];
  const markdowns = [];
  const texts = [];
  service.sendCard = async (...args) => {
    cards.push(args);
    return { messageId: 'card-1' };
  };
  service.sendMarkdown = async (...args) => {
    markdowns.push(args);
    return { messageId: 'md-1' };
  };
  service.sendMessage = async (...args) => {
    texts.push(args);
    return { messageId: 'text-1' };
  };

  const longEssay = '这是一篇中文作文'.repeat(20);
  const result = await service.receiveMessage({
    messageId: 'msg-2',
    chatId: 'chat-2',
    content: longEssay
  });

  assert.equal(result.command, 'essay');
  assert.equal(result.sent, 'card');
  assert.equal(cards.length, 1);
  assert.equal(markdowns.length, 1);
  assert.equal(texts.length, 0);
});

test('feishu service handles essay report pagination card actions', async () => {
  const appDir = rootDir;
  const archiveId = 'feishu-essay-1';
  fs.mkdirSync(path.join(appDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'data', 'archive-records.json'), `${JSON.stringify({
    version: 1,
    records: [{
      id: archiveId,
      archiveStatus: 'archived',
      reportJson: {
        totalScore: 55,
        fullScore: 60,
        level: '一类文',
        overallEvaluation: '整体完成度较高。',
        strengths: ['观点明确'],
        problems: ['论证不够深'],
        suggestions: ['补强因果链']
      },
      files: []
    }]
  }, null, 2)}\n`, 'utf8');

  const service = createFeishuService({
    appDir,
    env: {
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret',
      FEISHU_BOT_NAME: 'Chinese Teacher AI Studio'
    }
  });

  const replies = [];
  service.replyMessage = async (...args) => {
    replies.push(args);
    return { ok: true, messageId: 'reply-1', mode: 'reply' };
  };

  const result = await service.handleCardAction({
    messageId: 'open-msg-1',
    chatId: 'chat-1',
    operator: { openId: 'ou-1' },
    action: {
      value: {
        command: 'essay-report-page',
        archiveId,
        page: 2
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.command, 'essay-report-page');
  assert.equal(replies.length, 1);
  assert.equal(replies[0][0].messageId, 'open-msg-1');
  assert.equal(replies[0][0].card.header.subtitle.content, '第 2 页 / 共 10 页');
});

test('feishu service gives short unknown text a default guidance reply', async () => {
  const service = createFeishuService({
    appDir: rootDir,
    env: {
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret',
      FEISHU_BOT_NAME: 'Chinese Teacher AI Studio'
    },
    analyzeEssay: async () => {
      throw new Error('essay analyzer should not be called for short text');
    }
  });

  const texts = [];
  service.sendMessage = async (...args) => {
    texts.push(args);
    return { messageId: 'text-1' };
  };

  const result = await service.receiveMessage({
    messageId: 'msg-3',
    chatId: 'chat-3',
    content: '帮我看看'
  });

  assert.equal(result.sent, 'text');
  assert.equal(result.command, 'unknown');
  assert.equal(texts.length, 1);
  assert.match(texts[0][1], /批改作文\+作文正文/);
});

test('feishu reply mode send sends directly to chat_id without replyTo', async () => {
  const logs = [];
  const service = createFeishuService({
    appDir: rootDir,
    logger: { info: (message, extra) => logs.push({ message, extra }), warn: () => {}, error: () => {} },
    env: {
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret',
      FEISHU_BOT_NAME: 'Chinese Teacher AI Studio',
      FEISHU_REPLY_MODE: 'send'
    }
  });

  const calls = [];
  service.sendMessage = async (...args) => {
    calls.push(args);
    return {
      ok: true,
      code: 0,
      msg: 'success',
      requestId: 'req-send-1',
      messageId: 'om-send-1',
      dataMessageId: 'om-send-1',
      mode: 'send',
      chatId: args[0]
    };
  };

  const result = await service.receiveMessage({
    messageId: 'om-source-1',
    chatId: 'oc-chat-1',
    content: '你好'
  });

  assert.equal(result.sent, 'text');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'oc-chat-1');
  assert.equal(calls[0][2].replyTo, '');
  assert.equal(calls[0][2].replyMode, 'send');
  assert.ok(logs.some((entry) => String(entry.message).includes('Feishu send HTTP response')
    && entry.extra?.request_id === 'req-send-1'
    && entry.extra?.data_message_id === 'om-send-1'
    && entry.extra?.target_chat_id === 'oc-chat-1'));
});

test('feishu reply mode reply falls back to send when reply api fails', async () => {
  const logs = [];
  const service = createFeishuService({
    appDir: rootDir,
    logger: {
      info: (message, extra) => logs.push({ level: 'info', message, extra }),
      warn: (message, extra) => logs.push({ level: 'warn', message, extra }),
      error: (message, extra) => logs.push({ level: 'error', message, extra })
    },
    env: {
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret',
      FEISHU_BOT_NAME: 'Chinese Teacher AI Studio',
      FEISHU_REPLY_MODE: 'reply'
    }
  });

  const calls = [];
  service.sendMessage = async (...args) => {
    calls.push(args);
    if (args[2]?.replyTo) {
      return {
        ok: false,
        code: 230001,
        msg: 'message_id not found',
        requestId: 'req-reply-failed',
        messageId: '',
        dataMessageId: '',
        mode: 'reply',
        chatId: args[0],
        replyToMessageId: args[2].replyTo,
        error: 'message_id not found'
      };
    }
    return {
      ok: true,
      code: 0,
      msg: 'success',
      requestId: 'req-send-fallback',
      messageId: 'om-fallback-1',
      dataMessageId: 'om-fallback-1',
      mode: 'send',
      chatId: args[0]
    };
  };

  const result = await service.receiveMessage({
    messageId: 'bad-message-id',
    chatId: 'oc-chat-2',
    content: '你好'
  });

  assert.equal(result.sent, 'text');
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2].replyTo, 'bad-message-id');
  assert.equal(calls[1][2].replyTo, '');
  assert.ok(logs.some((entry) => entry.level === 'warn'
    && String(entry.message).includes('falling back to send')
    && entry.extra?.code === 230001));
  assert.ok(logs.some((entry) => String(entry.message).includes('Feishu send HTTP response')
    && entry.extra?.request_id === 'req-send-fallback'
    && entry.extra?.target_chat_id === 'oc-chat-2'));
});

test('feishu real message sends directly and logs request url http status response body and receive id fields', async () => {
  const logs = [];
  const service = createFeishuService({
    appDir: rootDir,
    logger: {
      info: (message, extra) => logs.push({ level: 'info', message, extra }),
      warn: (message, extra) => logs.push({ level: 'warn', message, extra }),
      error: (message, extra) => logs.push({ level: 'error', message, extra })
    },
    env: {
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret',
      FEISHU_BOT_NAME: 'Chinese Teacher AI Studio',
      FEISHU_REPLY_MODE: 'reply'
    }
  });
  const channel = service.buildChannel();
  const requests = [];
  channel.rawClient = {
    domain: 'https://open.feishu.cn',
    async formatPayload(payload) {
      return {
        headers: { Authorization: 'Bearer test-token', 'User-Agent': 'test' },
        params: payload.params || {},
        data: payload.data || {},
        path: payload.path || {}
      };
    }
  };
  channel.fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return {
      status: 200,
      headers: new Map([['x-tt-logid', 'req-real-1']]),
      async json() {
        return {
          code: 0,
          msg: 'success',
          data: { message_id: 'om-real-1' }
        };
      },
      async text() {
        return JSON.stringify({
          code: 0,
          msg: 'success',
          data: { message_id: 'om-real-1' }
        });
      }
    };
  };
  service.channel = channel;

  const result = await service.receiveMessage({
    realEvent: true,
    messageId: 'om-incoming-1',
    chatId: 'oc_real_chat_1',
    sender: {
      sender_id: {
        user_id: 'user_real_1',
        open_id: 'ou_real_1'
      }
    },
    content: '你好'
  });

  assert.equal(result.sent, 'text');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/open-apis\/im\/v1\/messages\?receive_id_type=user_id$/);
  const responseLog = logs.find((entry) => String(entry.message).includes('Feishu send HTTP response'));
  assert.ok(responseLog, 'expected Feishu send HTTP response log');
  assert.equal(responseLog.extra.request_url, 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=user_id');
  assert.equal(responseLog.extra.http_status, 200);
  assert.equal(responseLog.extra.code, 0);
  assert.equal(responseLog.extra.msg, 'success');
  assert.equal(responseLog.extra.request_id, 'req-real-1');
  assert.equal(responseLog.extra.data_message_id, 'om-real-1');
  assert.equal(responseLog.extra.actual_mode, 'send');
  assert.equal(responseLog.extra.receive_id, 'user_real_1');
  assert.equal(responseLog.extra.receive_id_type, 'user_id');
  assert.equal(responseLog.extra.target_chat_id, 'user_real_1');
});

test('feishu test text sends direct message to sender user id with text content', async () => {
  const logs = [];
  const service = createFeishuService({
    appDir: rootDir,
    logger: {
      info: (message, extra) => logs.push({ level: 'info', message, extra }),
      warn: (message, extra) => logs.push({ level: 'warn', message, extra }),
      error: (message, extra) => logs.push({ level: 'error', message, extra })
    },
    env: {
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret',
      FEISHU_BOT_NAME: 'Chinese Teacher AI Studio'
    }
  });
  const channel = service.buildChannel();
  const requests = [];
  channel.rawClient = {
    domain: 'https://open.feishu.cn',
    async formatPayload(payload) {
      return {
        headers: { Authorization: 'Bearer test-token' },
        data: payload.data || {}
      };
    }
  };
  channel.fetchImpl = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return {
      status: 200,
      headers: new Map([['x-tt-logid', 'req-direct-1']]),
      async text() {
        return JSON.stringify({
          code: 0,
          msg: 'success',
          data: { message_id: 'om-direct-1' }
        });
      }
    };
  };
  service.channel = channel;

  const result = await service.receiveMessage({
    eventType: 'im.message.receive_v1',
    realEvent: true,
    messageId: 'om-incoming-test',
    chatId: 'oc_group_or_p2p',
    sender: {
      sender_id: {
        user_id: 'user_sender_1',
        open_id: 'ou_sender_1'
      }
    },
    content: '测试123'
  });

  assert.equal(result.ok, true);
  assert.equal(result.sent, 'text');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/open-apis\/im\/v1\/messages\?receive_id_type=user_id$/);
  assert.doesNotMatch(requests[0].url, /\/reply/);
  assert.equal(requests[0].body.receive_id, 'user_sender_1');
  assert.equal(requests[0].body.msg_type, 'text');
  assert.equal(requests[0].body.content, JSON.stringify({ text: '测试回复' }));
  assert.ok(logs.some((entry) => String(entry.message).includes('Feishu send request')
    && entry.extra?.receive_id === 'user_sender_1'
    && entry.extra?.receive_id_type === 'user_id'
    && entry.extra?.message_id === 'om-incoming-test'));
});

test('feishu real test reply 002 sends 123456 directly to sender user id', async () => {
  const logs = [];
  const service = createFeishuService({
    appDir: rootDir,
    logger: {
      info: (message, extra) => logs.push({ level: 'info', message, extra }),
      warn: (message, extra) => logs.push({ level: 'warn', message, extra }),
      error: (message, extra) => logs.push({ level: 'error', message, extra })
    },
    env: {
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret',
      FEISHU_BOT_NAME: 'Chinese Teacher AI Studio'
    }
  });
  const channel = service.buildChannel();
  const requests = [];
  channel.rawClient = {
    domain: 'https://open.feishu.cn',
    async formatPayload(payload) {
      return {
        headers: { Authorization: 'Bearer test-token' },
        data: payload.data || {}
      };
    }
  };
  channel.fetchImpl = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return {
      status: 200,
      headers: new Map([['x-tt-logid', 'req-direct-2']]),
      async text() {
        return JSON.stringify({
          code: 0,
          msg: 'success',
          data: { message_id: 'om-direct-2' }
        });
      }
    };
  };
  service.channel = channel;

  const result = await service.receiveMessage({
    eventType: 'im.message.receive_v1',
    realEvent: true,
    messageId: 'om-incoming-test-2',
    chatId: 'oc_group_or_p2p',
    sender: {
      sender_id: {
        user_id: 'user_sender_2',
        open_id: 'ou_sender_2'
      }
    },
    content: '测试回复002'
  });

  assert.equal(result.ok, true);
  assert.equal(result.sent, 'text');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/open-apis\/im\/v1\/messages\?receive_id_type=user_id$/);
  assert.doesNotMatch(requests[0].url, /\/reply/);
  assert.equal(requests[0].body.receive_id, 'user_sender_2');
  assert.equal(requests[0].body.msg_type, 'text');
  assert.equal(requests[0].body.content, JSON.stringify({ text: '123456' }));
  assert.ok(logs.some((entry) => String(entry.message).includes('Feishu send request')
    && entry.extra?.receive_id === 'user_sender_2'
    && entry.extra?.receive_id_type === 'user_id'
    && entry.extra?.message_id === 'om-incoming-test-2'));
  assert.ok(logs.some((entry) => String(entry.message).includes('Feishu send HTTP response')
    && entry.extra?.actual_mode === 'send'
    && entry.extra?.code === 0
    && entry.extra?.data_message_id === 'om-direct-2'));
});

test('feishu real message falls back from user id to open id then chat id for direct send', async () => {
  const sends = [];
  const service = createFeishuService({
    appDir: rootDir,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    env: {
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret',
      FEISHU_BOT_NAME: 'Chinese Teacher AI Studio'
    }
  });

  service.sendMessage = async (...args) => {
    sends.push(args);
    return {
      ok: true,
      code: 0,
      msg: 'success',
      requestId: `req-${sends.length}`,
      messageId: `msg-${sends.length}`,
      dataMessageId: `msg-${sends.length}`,
      mode: 'send',
      chatId: args[0]
    };
  };

  await service.receiveMessage({
    realEvent: true,
    messageId: 'real-1',
    chatId: 'oc_chat_fallback_1',
    sender: {
      sender_id: {
        open_id: 'ou_sender_fallback_1'
      }
    },
    content: '你好'
  });

  await service.receiveMessage({
    realEvent: true,
    messageId: 'real-2',
    chatId: 'oc_chat_fallback_2',
    sender: {},
    content: '你好'
  });

  assert.equal(sends.length, 2);
  assert.equal(sends[0][0], 'ou_sender_fallback_1');
  assert.equal(sends[0][2].receiveIdType, 'open_id');
  assert.equal(sends[0][2].replyTo, undefined);
  assert.equal(sends[1][0], 'oc_chat_fallback_2');
  assert.equal(sends[1][2].receiveIdType, 'chat_id');
  assert.equal(sends[1][2].replyTo, undefined);
});

test('feishu websocket dispatcher binds im.message.receive_v1 to raw event logging and message handler', async () => {
  const logs = [];
  const service = createFeishuService({
    appDir: rootDir,
    logger: {
      info: (message, extra) => logs.push({ level: 'info', message, extra }),
      warn: (message, extra) => logs.push({ level: 'warn', message, extra }),
      error: (message, extra) => logs.push({ level: 'error', message, extra })
    },
    env: {
      FEISHU_APP_ID: 'cli_1234567890abcdef',
      FEISHU_APP_SECRET: 'app-secret',
      FEISHU_BOT_NAME: 'Chinese Teacher AI Studio'
    }
  });
  const channel = service.buildChannel();
  const received = [];
  channel.on({
    message: async (message) => {
      received.push(message);
    }
  });

  channel.registerEventHandlers();
  await channel.dispatcher.invoke({
    schema: '2.0',
    header: {
      event_type: 'im.message.receive_v1',
      event_id: 'evt-1'
    },
    event: {
      sender: {
        sender_id: { open_id: 'ou_sender_1' },
        sender_name: 'Teacher'
      },
      message: {
        message_id: 'om_test_1',
        chat_id: 'oc_test_1',
        chat_type: 'p2p',
        message_type: 'text',
        content: JSON.stringify({ text: '测试123' }),
        create_time: '1710000000000'
      }
    }
  }, { needCheck: false });

  assert.equal(received.length, 1);
  assert.equal(received[0].content, '测试123');
  assert.equal(received[0].messageId, 'om_test_1');
  assert.equal(received[0].chatId, 'oc_test_1');
  assert.ok(logs.some((entry) => String(entry.message).includes('Feishu raw event arrived')));
});

test('feishu long connection initialization does not depend on legacy channel bot identity lookup', () => {
  const servicePath = path.join(rootDir, 'server/src/integrations/feishu/service.js');
  const configPath = path.join(rootDir, 'server/src/integrations/feishu/config.js');
  const source = fs.readFileSync(servicePath, 'utf8');
  const configSource = fs.readFileSync(configPath, 'utf8');

  assert.doesNotMatch(source, /createLarkChannel/);
  assert.doesNotMatch(source, /bot\/v3\/info/);
  assert.match(source, /\[EVENT\]/);
  assert.match(source, /Feishu send HTTP response/);
  assert.match(configSource, /FEISHU_REPLY_MODE/);
  assert.match(source, /falling back to send/);
});

test('feishu status script prints explicit long connection and robot online checks', () => {
  const scriptPath = path.join(rootDir, 'ops/scripts/feishu-control.mjs');
  const source = fs.readFileSync(scriptPath, 'utf8');

  assert.match(source, /Long Connection/);
  assert.match(source, /Robot Online/);
  assert.match(source, /PID/);
});
