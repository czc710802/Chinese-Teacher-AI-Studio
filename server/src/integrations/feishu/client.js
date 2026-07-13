import { loadFeishuConfig } from './config.js';

const TOKEN_API = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const MESSAGE_API = 'https://open.feishu.cn/open-apis/im/v1/messages';

async function jsonRequest(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.msg || data.message || `Feishu request failed: ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  if (data.code && data.code !== 0) {
    const error = new Error(data.msg || data.message || 'Feishu request failed');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function getTenantAccessToken({ env = process.env, fetchImpl = fetch } = {}) {
  const config = loadFeishuConfig(env);
  if (!config.appConfigured) {
    return { ok: false, skipped: true, reason: 'app credentials missing' };
  }

  const data = await jsonRequest(fetchImpl, TOKEN_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret
    })
  });

  return {
    ok: true,
    tenantAccessToken: data.tenant_access_token,
    expire: data.expire
  };
}

async function sendMessage({ env = process.env, receiveId, receiveIdType = 'chat_id', messageType, content, fetchImpl = fetch } = {}) {
  const config = loadFeishuConfig(env);
  if (!config.appConfigured) {
    return { ok: false, skipped: true, reason: 'app credentials missing' };
  }
  if (!receiveId) {
    return { ok: false, skipped: true, reason: 'receive id missing' };
  }

  const token = await getTenantAccessToken({ env, fetchImpl });
  if (!token.ok) {
    return token;
  }

  const data = await jsonRequest(fetchImpl, `${MESSAGE_API}?receive_id_type=${encodeURIComponent(receiveIdType)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.tenantAccessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: messageType,
      content: JSON.stringify(content)
    })
  });

  return { ok: true, data };
}

export async function sendTextMessage(options = {}) {
  const text = typeof options.text === 'string' ? options.text : String(options.text ?? '');
  return sendMessage({
    ...options,
    messageType: 'text',
    content: { text }
  });
}

export async function sendCardMessage(options = {}) {
  return sendMessage({
    ...options,
    messageType: 'interactive',
    content: options.card
  });
}
