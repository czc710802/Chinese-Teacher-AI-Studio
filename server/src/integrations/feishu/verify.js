import { loadFeishuConfig } from './config.js';
import crypto from 'node:crypto';

const defaultNonceStore = new Map();

function headerValue(headers = {}, name) {
  const direct = headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()];
  if (direct) return Array.isArray(direct) ? String(direct[0] || '') : String(direct);
  const found = Object.keys(headers || {}).find((key) => key.toLowerCase() === name.toLowerCase());
  if (!found) return '';
  const value = headers[found];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function cleanupNonceStore(store, nowSeconds) {
  if (!store || typeof store.delete !== 'function') return;
  if (store instanceof Set) return;
  for (const [key, expiresAt] of store.entries()) {
    if (Number(expiresAt || 0) <= nowSeconds) store.delete(key);
  }
}

function hasNonce(store, nonce) {
  if (!store) return false;
  if (store instanceof Set) return store.has(nonce);
  return store.has(nonce);
}

function saveNonce(store, nonce, expiresAt) {
  if (!store) return;
  if (store instanceof Set) {
    store.add(nonce);
    return;
  }
  store.set(nonce, expiresAt);
}

function safeCompare(left = '', right = '') {
  const leftBuffer = Buffer.from(String(left), 'utf8');
  const rightBuffer = Buffer.from(String(right), 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyFeishuEvent({ body, env = process.env, config: inputConfig = null, headers = {}, rawBody = '' } = {}) {
  if (!body || typeof body !== 'object') {
    return {
      statusCode: 400,
      body: { message: 'invalid request body' }
    };
  }

  if (body.type === 'url_verification' || body.challenge) {
    const config = inputConfig || loadFeishuConfig(env);
    if (config.verificationToken && body.token && body.token !== config.verificationToken) {
      return {
        statusCode: 401,
        body: { message: 'verification token mismatch' }
      };
    }

    return {
      statusCode: 200,
      body: { challenge: body.challenge }
    };
  }

  const config = inputConfig || loadFeishuConfig(env);
  const enforceSignature = Boolean(config.enforceSignature || String(env.FEISHU_ENFORCE_SIGNATURE || '').toLowerCase() === 'true');
  const encryptKey = config.encryptKey || loadFeishuConfig(env).encryptKey;
  if (enforceSignature) {
    const timestamp = headerValue(headers, 'x-lark-request-timestamp');
    const nonce = headerValue(headers, 'x-lark-request-nonce');
    const signature = headerValue(headers, 'x-lark-signature');
    const nowSeconds = Number(config.nowSeconds || Math.floor(Date.now() / 1000));
    const ts = Number(timestamp);
    if (!timestamp || !nonce || !signature || !encryptKey || !Number.isFinite(ts)) {
      return { statusCode: 401, body: { message: 'feishu signature headers missing' } };
    }
    if (Math.abs(nowSeconds - ts) > Number(config.signatureWindowSeconds || 1800)) {
      return { statusCode: 401, body: { message: 'feishu signature timestamp expired' } };
    }
    const nonceStore = config.nonceStore || defaultNonceStore;
    cleanupNonceStore(nonceStore, nowSeconds);
    if (hasNonce(nonceStore, nonce)) {
      return { statusCode: 409, body: { message: 'feishu event replayed' } };
    }
    const payload = rawBody || JSON.stringify(body);
    const expected = crypto
      .createHash('sha256')
      .update(`${timestamp}${nonce}${encryptKey}${payload}`)
      .digest('hex');
    if (!safeCompare(expected, signature)) {
      return { statusCode: 401, body: { message: 'feishu signature mismatch' } };
    }
    saveNonce(nonceStore, nonce, nowSeconds + Number(config.signatureWindowSeconds || 1800));
  }

  return null;
}
