import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { routeFeishuEvent } from '../src/integrations/feishu/messageRouter.js';
import { createFeishuService } from '../src/integrations/feishu/service.js';

test('feishu business pause sends migration notice for incoming essay commands', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { code: 0, msg: 'success', tenant_access_token: 'token-1', expire: 7200 };
        },
        async text() {
          return JSON.stringify({ code: 0, msg: 'success', tenant_access_token: 'token-1', expire: 7200 });
        }
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { code: 0, msg: 'success', data: { message_id: 'om-notice-1' } };
      },
      async text() {
        return JSON.stringify({ code: 0, msg: 'success', data: { message_id: 'om-notice-1' } });
      }
    };
  };

  const result = await routeFeishuEvent({
    body: {
      header: { event_id: `event-${randomUUID()}` },
      event: {
        message: {
          message_id: 'msg-1',
          chat_id: 'oc_test_chat',
          message_type: 'text',
          content: JSON.stringify({ text: '批改作文 这是测试作文' })
        },
        sender: { sender_id: { open_id: 'ou_sender' } }
      }
    },
    env: {
      NODE_ENV: 'production',
      FEISHU_BUSINESS_ENABLED: 'false',
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret',
      PUBLIC_APP_ORIGIN: 'https://pi.zhenwanyue.icu'
    },
    fetchImpl
  });

  assert.equal(result.statusCode, 200);
  assert.equal(result.body.businessPaused, true);
  assert.match(requests[1].body.content, /作文教学业务已迁移/);
  assert.match(requests[1].body.content, /\/teacher/);
  assert.match(requests[1].body.content, /\/student-mobile/);
});

test('feishu card actions are redirected to migration notice while business is paused', async () => {
  const service = createFeishuService({
    env: {
      NODE_ENV: 'production',
      FEISHU_BUSINESS_ENABLED: 'false',
      FEISHU_APP_ID: 'app-id',
      FEISHU_APP_SECRET: 'app-secret',
      PUBLIC_APP_ORIGIN: 'https://pi.zhenwanyue.icu'
    },
    appDir: process.cwd()
  });

  const calls = [];
  service.sendMessage = async (...args) => {
    calls.push(args);
    return { ok: true };
  };

  const result = await service.handleCardAction({
    action: { value: JSON.stringify({ command: 'essay-report-page', archiveId: 'archive-1', page: 1 }) },
    context: { open_chat_id: 'oc_test_chat', open_message_id: 'msg-1' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0][1], /作文教学业务已迁移/);
  assert.match(calls[0][1], /\/teacher/);
  assert.match(calls[0][1], /\/student-mobile/);
});
