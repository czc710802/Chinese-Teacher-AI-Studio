import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  Client,
  EventDispatcher,
  LoggerLevel,
  WSClient
} from '@larksuiteoapi/node-sdk';

import { loadFeishuConfig } from './config.js';
import { parseFeishuCommand } from './commands.js';
import { canExecuteFeishuCommand } from './auth.js';
import {
  buildBackupCard,
  buildDailyReportCard,
  buildEssayMenuCard,
  buildEssayResultCard,
  buildEssayReportPageCard,
  buildHelpCard,
  buildLogsCard,
  parseEssayCardActionValue,
  buildRestartCard,
  buildStatusCard
} from './cards.js';
import { analyzeEssay } from '../../../../apps/essay-ai/src/index.js';
import { getSystemStatus } from '../../services/system-status.js';
import { getSystemLogs } from '../../services/system-logs.js';
import { getLatestDailyReport } from '../../services/system-daily-report.js';
import { triggerBackup } from '../../services/system-backup.js';
import {
  classifyFeishuIncomingMessage,
  cleanFeishuText,
  parseFeishuIncomingMessage
} from './messageParser.js';
import { archiveFeishuEssayResult, loadFeishuEssayReport } from './archiveLinks.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SDK_PACKAGE_JSON = path.resolve(__dirname, '../../../../node_modules/@larksuiteoapi/node-sdk/package.json');
const SDK_VERSION = readSdkVersion();

export function findNasFilesForFeishu({ appDir = path.resolve(process.cwd()), limit = 5 } = {}) {
  const queuePath = path.join(appDir, 'data', 'nas-sync-queue.json');
  if (!fs.existsSync(queuePath)) return { ok: false, message: 'NAS 同步队列不存在', items: [] };
  try {
    const data = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    const tasks = Array.isArray(data.tasks) ? data.tasks : Array.isArray(data) ? data : [];
    const root = path.resolve(appDir);
    const items = tasks
      .slice()
      .sort((a, b) => String(b.synced_at || b.created_at || '').localeCompare(String(a.synced_at || a.created_at || '')))
      .slice(0, limit)
      .map((task) => buildNasFileItemForFeishu(task, root));
    return { ok: true, items };
  } catch (error) {
    return { ok: false, message: error.message, items: [] };
  }
}

export function readNasFileForFeishu({ appDir = path.resolve(process.cwd()), query = '', maxBytes = 1800 } = {}) {
  const queuePath = path.join(appDir, 'data', 'nas-sync-queue.json');
  if (!fs.existsSync(queuePath)) return { ok: false, message: 'NAS 同步队列不存在', items: [] };
  try {
    const data = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
    const tasks = Array.isArray(data.tasks) ? data.tasks : Array.isArray(data) ? data : [];
    const root = path.resolve(appDir);
    const normalizedQuery = cleanFeishuText(query).toLowerCase();
    const candidates = tasks
      .filter((task) => !normalizedQuery || String(task.remote_path || task.local_path || '').toLowerCase().includes(normalizedQuery))
      .sort((a, b) => String(b.synced_at || b.created_at || '').localeCompare(String(a.synced_at || a.created_at || '')))
      .slice(0, 3)
      .map((task) => buildNasFileItemForFeishu(task, root, { includePreview: true, maxBytes }));
    return { ok: true, items: candidates };
  } catch (error) {
    return { ok: false, message: error.message, items: [] };
  }
}

function buildNasFileItemForFeishu(task, root, { includePreview = false, maxBytes = 1800 } = {}) {
  const remotePath = task.remote_path || '';
  const localPath = task.local_path || '';
  const item = {
    remotePath,
    status: task.status || '',
    sha256: task.sha256 || '',
    syncedAt: task.synced_at || '',
    createdAt: task.created_at || ''
  };
  if (includePreview) item.preview = readSafeNasPreview({ root, localPath, remotePath, maxBytes });
  return item;
}

function readSafeNasPreview({ root, localPath, remotePath, maxBytes }) {
  if (!localPath) return { ok: false, message: '没有本地镜像路径' };
  const resolved = path.resolve(localPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return { ok: false, message: '文件路径不在应用目录内，已拒绝读取' };
  }
  if (!fs.existsSync(resolved)) return { ok: false, message: '本地镜像文件不存在' };
  if (!isTextNasFile(remotePath || resolved)) return { ok: false, message: '二进制文件不在飞书中展开' };
  const buffer = fs.readFileSync(resolved);
  const text = buffer.subarray(0, maxBytes).toString('utf8');
  return {
    ok: true,
    text: text.length >= maxBytes ? `${text}\n...` : text
  };
}

function isTextNasFile(filePath = '') {
  return ['.txt', '.md', '.json', '.csv', '.log'].includes(path.extname(String(filePath)).toLowerCase());
}

function readSdkVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(SDK_PACKAGE_JSON, 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
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

function redactSecrets(text) {
  return String(text || '')
    .replace(/(FEISHU_[A-Z_]+\s*=\s*)[^\s]+/g, '$1[redacted]')
    .replace(/(appSecret|app_secret|secret|token|encryptKey|encrypt_key)\s*[:=]\s*['"]?[^'"\s]+['"]?/gi, '$1=[redacted]');
}

function redactStructured(value) {
  if (value == null) return value;
  if (typeof value === 'string') return redactSecrets(value);
  if (typeof value !== 'object') return value;
  return parseJsonObject(redactSecrets(safeString(value)), {});
}

function fileTypeFromName(fileName = '', mimeType = '') {
  const lowerName = String(fileName || '').toLowerCase();
  const lowerMime = String(mimeType || '').toLowerCase();
  if (lowerMime.startsWith('image/') || /\.(png|jpg|jpeg|webp|gif|bmp|tif|tiff|ico)$/i.test(lowerName)) return 'image';
  if (lowerMime.startsWith('text/plain') || /\.txt$/i.test(lowerName)) return 'text';
  if (/\.pdf$/i.test(lowerName)) return 'pdf';
  if (/\.docx?$/i.test(lowerName)) return 'doc';
  if (/\.xlsx?$/i.test(lowerName)) return 'xls';
  if (/\.pptx?$/i.test(lowerName)) return 'ppt';
  if (/\.mp4$/i.test(lowerName)) return 'mp4';
  return 'file';
}

function resourceTypeFromName(fileName = '', mimeType = '') {
  const lowerName = String(fileName || '').toLowerCase();
  const lowerMime = String(mimeType || '').toLowerCase();
  if (lowerMime.startsWith('image/') || /\.(png|jpg|jpeg|webp|gif|bmp|tif|tiff|ico)$/i.test(lowerName)) return 'image';
  return 'file';
}

function markdownFromLines(lines = []) {
  return lines.filter(Boolean).join('\n\n');
}

function parseJsonObject(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  if (!value || typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function detectReceiveIdType(value = '', explicitType = '') {
  const normalizedType = String(explicitType || '').trim();
  if (['chat_id', 'open_id', 'user_id', 'union_id', 'email'].includes(normalizedType)) return normalizedType;
  const id = String(value || '');
  if (id.startsWith('oc_')) return 'chat_id';
  if (id.startsWith('ou_')) return 'open_id';
  if (id.startsWith('on_')) return 'union_id';
  if (id) return 'user_id';
  return 'chat_id';
}

function pickSenderIds(message = {}, incoming = {}) {
  const raw = message.raw || {};
  const sender = message.sender || raw.sender || raw.event?.sender || {};
  const senderId = sender.sender_id || sender.senderId || {};
  return {
    userId: String(incoming.senderUserId || message.senderUserId || senderId.user_id || sender.user_id || ''),
    openId: String(incoming.senderOpenId || message.senderOpenId || senderId.open_id || sender.open_id || ''),
    unionId: String(incoming.senderUnionId || message.senderUnionId || senderId.union_id || sender.union_id || ''),
    fallbackId: String(incoming.senderId || message.senderId || '')
  };
}

function resolveDirectReceiveTarget(message = {}, incoming = {}) {
  const ids = pickSenderIds(message, incoming);
  if (ids.userId) return { receiveId: ids.userId, receiveIdType: 'user_id' };
  if (ids.openId) return { receiveId: ids.openId, receiveIdType: 'open_id' };
  const chatId = String(incoming.chatId || message.chatId || message.chat_id || '');
  if (chatId) return { receiveId: chatId, receiveIdType: 'chat_id' };
  return { receiveId: '', receiveIdType: '' };
}

function normalizeHeaderValue(headers = {}, names = []) {
  for (const name of names) {
    const direct = headers?.[name];
    if (direct) return Array.isArray(direct) ? String(direct[0] || '') : String(direct);
    const foundKey = Object.keys(headers || {}).find((key) => key.toLowerCase() === name.toLowerCase());
    if (foundKey && headers[foundKey]) {
      const value = headers[foundKey];
      return Array.isArray(value) ? String(value[0] || '') : String(value);
    }
  }
  return '';
}

function normalizeResponseHeaders(headers = {}) {
  const result = {};
  if (typeof headers?.forEach === 'function') {
    headers.forEach((value, key) => {
      result[String(key).toLowerCase()] = Array.isArray(value) ? value[0] : value;
    });
    return result;
  }
  for (const [key, value] of Object.entries(headers || {})) {
    result[String(key).toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return result;
}

function buildFeishuRequestUrl(domain = 'https://open.feishu.cn', url = '', params = {}) {
  const base = String(domain || 'https://open.feishu.cn').replace(/\/+$/, '');
  const pathPart = String(url || '').replace(/^\/+/, '');
  const requestUrl = `${base}/${pathPart}`;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value == null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${requestUrl}?${query}` : requestUrl;
}

async function parseFeishuFetchBody(response = {}) {
  const text = typeof response.text === 'function' ? await response.text() : '';
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {
      code: Number(response.status || -1),
      msg: text,
      data: {}
    };
  }
}

function normalizeFeishuApiBody(response = {}) {
  if (response?.data && typeof response.data === 'object' && ('code' in response.data || 'msg' in response.data || 'data' in response.data)) {
    return response.data;
  }
  if ('code' in response || 'msg' in response || 'data' in response) return response;
  return { code: 0, msg: 'success', data: response || {} };
}

function normalizeFeishuSendResponse(response = {}, meta = {}) {
  const body = normalizeFeishuApiBody(response);
  const headers = response?.headers || {};
  const data = body?.data && typeof body.data === 'object' ? body.data : {};
  const code = Number(body?.code ?? 0);
  const httpStatus = Number(response?.status ?? response?.httpStatus ?? meta.httpStatus ?? 0);
  const requestId = String(
    body?.request_id
      || body?.requestId
      || normalizeHeaderValue(headers, ['x-tt-logid', 'x-request-id', 'x-lark-request-id', 'request-id'])
      || ''
  );
  const dataMessageId = String(data?.message_id || body?.message_id || '');
  return {
    ok: code === 0 && (!httpStatus || (httpStatus >= 200 && httpStatus < 300)),
    code,
    msg: String(body?.msg || body?.message || (code === 0 ? 'success' : 'Feishu request failed')),
    requestId,
    messageId: dataMessageId,
    dataMessageId,
    requestUrl: meta.requestUrl || response?.requestUrl || '',
    httpStatus,
    mode: meta.mode || '',
    msgType: meta.msgType || '',
    chatId: meta.chatId || '',
    receiveId: meta.receiveId || '',
    receiveIdType: meta.receiveIdType || '',
    replyToMessageId: meta.replyToMessageId || '',
    raw: {
      code,
      msg: String(body?.msg || body?.message || ''),
      request_id: requestId,
      data: {
        message_id: dataMessageId
      }
    }
  };
}

function normalizeFeishuSendError(error, meta = {}) {
  const response = error?.response || {};
  const body = response?.data || error?.data || {};
  const headers = response?.headers || {};
  const httpStatus = Number(response?.status ?? error?.status ?? meta.httpStatus ?? 0);
  const code = Number(body?.code ?? httpStatus ?? -1);
  const requestId = String(
    body?.request_id
      || body?.requestId
      || normalizeHeaderValue(headers, ['x-tt-logid', 'x-request-id', 'x-lark-request-id', 'request-id'])
      || ''
  );
  const data = body?.data && typeof body.data === 'object' ? body.data : {};
  const message = String(body?.msg || body?.message || error?.message || 'Feishu request failed');
  return {
    ok: false,
    code,
    msg: message,
    requestId,
    messageId: String(data?.message_id || ''),
    dataMessageId: String(data?.message_id || ''),
    requestUrl: meta.requestUrl || response?.requestUrl || '',
    httpStatus,
    mode: meta.mode || '',
    msgType: meta.msgType || '',
    chatId: meta.chatId || '',
    receiveId: meta.receiveId || '',
    receiveIdType: meta.receiveIdType || '',
    replyToMessageId: meta.replyToMessageId || '',
    error: message,
    raw: {
      code,
      msg: message,
      request_id: requestId,
      data: {
        message_id: String(data?.message_id || '')
      }
    }
  };
}

function normalizeResources(message = {}) {
  const type = String(message.message_type || message.msg_type || '').toLowerCase();
  const content = parseJsonObject(message.content, {});
  const name = content.file_name || content.name || '';
  if (type === 'image' && content.image_key) {
    return [{
      type: 'image',
      fileKey: content.image_key,
      fileName: name || 'feishu-image.png',
      mimeType: 'image/png'
    }];
  }
  if (['file', 'media', 'audio'].includes(type) && content.file_key) {
    return [{
      type: 'file',
      fileKey: content.file_key,
      fileName: name || 'feishu-file',
      mimeType: ''
    }];
  }
  return [];
}

function normalizeReceiveEvent(data = {}) {
  const event = data.event || data;
  const message = event.message || {};
  const sender = event.sender || {};
  const senderId = sender.sender_id || sender.senderId || {};
  const parsed = parseFeishuIncomingMessage(event, { botName: sender.sender_name || '' });
  return {
    eventType: String(data?.header?.event_type || data?.schema || data?.type || 'im.message.receive_v1'),
    realEvent: true,
    mockedEvent: false,
    messageId: parsed.messageId || message.message_id || '',
    chatId: parsed.chatId || message.chat_id || '',
    chatType: message.chat_type || 'group',
    senderId: parsed.senderId || senderId.open_id || senderId.user_id || senderId.union_id || '',
    senderOpenId: parsed.senderOpenId || senderId.open_id || sender.open_id || '',
    senderUserId: parsed.senderUserId || senderId.user_id || sender.user_id || '',
    senderUnionId: parsed.senderUnionId || senderId.union_id || sender.union_id || '',
    sender,
    senderName: sender.sender_name || '',
    content: parsed.text,
    rawContent: parsed.rawContent,
    rawText: parsed.rawText,
    rawContentType: parsed.messageType || message.message_type || '',
    resources: normalizeResources(message),
    mentions: Array.isArray(message.mentions) ? message.mentions : [],
    mentionAll: false,
    mentionedBot: true,
    rootId: message.root_id || '',
    threadId: message.thread_id || '',
    replyToMessageId: message.parent_id || '',
    createTime: Number(message.create_time || Date.now()),
    raw: data
  };
}

function buildRawEventLog(data = {}, fallbackEventType = '') {
  const event = data?.event || data || {};
  const message = event?.message || {};
  const sender = event?.sender || {};
  const senderId = sender?.sender_id || sender?.senderId || {};
  return {
    real_event: true,
    mocked_event: false,
    event_type: String(data?.header?.event_type || data?.schema || data?.type || fallbackEventType || ''),
    message_id: String(message?.message_id || message?.messageId || ''),
    chat_id: String(message?.chat_id || message?.chatId || ''),
    sender_id: String(senderId?.open_id || senderId?.user_id || senderId?.union_id || sender?.open_id || sender?.user_id || sender?.union_id || ''),
    message_type: String(message?.message_type || message?.msg_type || ''),
    raw_content: safeString(message?.content || '')
  };
}

function detectRawEventType(data = {}) {
  return String(data?.header?.event_type || data?.event?.type || data?.type || '');
}

class FeishuLongConnectionClient {
  constructor({ appId, appSecret, logger, loggerLevel = LoggerLevel.info, source, wsConfig, fetchImpl = fetch } = {}) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.logger = logger;
    this.loggerLevel = loggerLevel;
    this.source = source;
    this.wsConfig = wsConfig;
    this.fetchImpl = fetchImpl;
    this.rawClient = new Client({ appId, appSecret, logger, loggerLevel, source });
    this.rawWsClient = null;
    this.connected = false;
    this.handlers = {};
    this.dispatcher = new EventDispatcher({ logger, loggerLevel });
    this.eventHandlersRegistered = false;
    this.rawEventProbeInstalled = false;
  }

  on(nameOrMap, handler) {
    if (typeof nameOrMap === 'string') {
      this.handlers[nameOrMap] = handler;
      return () => {
        if (this.handlers[nameOrMap] === handler) delete this.handlers[nameOrMap];
      };
    }
    const unsubscribers = Object.entries(nameOrMap || {})
      .filter(([, fn]) => typeof fn === 'function')
      .map(([name, fn]) => this.on(name, fn));
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }

  installRawEventProbe() {
    if (this.rawEventProbeInstalled) return;
    const originalInvoke = this.dispatcher.invoke.bind(this.dispatcher);
    this.dispatcher.invoke = async (data, params) => {
      const eventType = detectRawEventType(data);
      if (eventType) {
        this.logger?.info?.('Feishu raw event arrived', buildRawEventLog(data, eventType));
      }
      return originalInvoke(data, params);
    };
    this.rawEventProbeInstalled = true;
  }

  registerEventHandlers() {
    if (this.eventHandlersRegistered) return this.dispatcher;
    this.installRawEventProbe();
    this.dispatcher.register({
      'im.message.receive_v1': async (data) => {
        try {
          console.log(
            '[MESSAGE]',
            data?.header?.event_type,
            data?.event?.sender?.sender_id,
            data?.event?.message?.message_type,
            data?.event?.message?.chat_type
          );
        } catch {
          // ignore debug logging failures
        }
        await this.handlers.message?.(normalizeReceiveEvent(data));
      },
      'im.chat.member.bot.added_v1': async (data) => {
        await this.handlers.botAdded?.(data);
      },
      'card.action.trigger': async (data) => {
        await this.handlers.cardAction?.(data);
      }
    });
    this.eventHandlersRegistered = true;
    return this.dispatcher;
  }

  async connect() {
    if (this.connected && this.rawWsClient) return;
    const eventDispatcher = this.registerEventHandlers();
    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error('Feishu WebSocket handshake timeout'));
      }, 15000);
      this.rawWsClient = new WSClient({
        appId: this.appId,
        appSecret: this.appSecret,
        logger: this.logger,
        loggerLevel: this.loggerLevel,
        autoReconnect: true,
        source: this.source,
        wsConfig: this.wsConfig,
        handshakeTimeoutMs: 15000,
        onReady: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.connected = true;
          resolve();
        },
        onError: (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
        onReconnecting: () => this.handlers.reconnecting?.(),
        onReconnected: () => this.handlers.reconnected?.()
      });
      this.rawWsClient.start({ eventDispatcher });
    });
  }

  async disconnect({ force = true } = {}) {
    this.rawWsClient?.close?.({ force });
    this.connected = false;
  }

  getConnectionStatus() {
    return this.rawWsClient?.getConnectionStatus?.();
  }

  getReconnectInfo() {
    return this.rawWsClient?.getReconnectInfo?.();
  }

  async send(to, input, opts = {}) {
    const target = String(to || '');
    if (!target) throw new Error('Feishu message target is empty');
    if ('card' in input) {
      return this.sendRaw(target, 'interactive', input.card, opts);
    }
    if ('markdown' in input) {
      return this.sendRaw(target, 'text', { text: String(input.markdown || '') }, opts);
    }
    return this.sendRaw(target, 'text', { text: String(input.text || '') }, opts);
  }

  async sendRaw(to, msgType, content, opts = {}) {
    const receiveIdType = detectReceiveIdType(to, opts.receiveIdType);
    const mode = opts.replyTo ? 'reply' : 'send';
    const meta = {
      mode,
      msgType,
      chatId: to,
      receiveId: to,
      receiveIdType,
      replyToMessageId: opts.replyTo || ''
    };
    const data = opts.replyTo
      ? {
          msg_type: msgType,
          content: JSON.stringify(content),
          reply_in_thread: opts.replyInThread
        }
      : {
          receive_id: to,
          msg_type: msgType,
          content: JSON.stringify(content)
        };
    const url = opts.replyTo
      ? `/open-apis/im/v1/messages/${encodeURIComponent(opts.replyTo)}/reply`
      : '/open-apis/im/v1/messages';
    const params = opts.replyTo ? {} : { receive_id_type: receiveIdType };
    const requestUrl = buildFeishuRequestUrl(this.rawClient?.domain, url, params);
    this.logger?.info?.('Feishu send request', {
      mode,
      request_url: requestUrl,
      receive_id: opts.replyTo ? '' : to,
      receive_id_type: opts.replyTo ? '' : receiveIdType,
      message_id: opts.replyTo || opts.messageId || '',
      msg_type: msgType,
      content: safeString(data.content || '')
    });

    try {
      const payload = await this.rawClient.formatPayload({
        data,
        params: {},
        headers: {}
      });
      const response = await this.fetchImpl(requestUrl, {
        method: 'POST',
        headers: {
          ...(payload?.headers || {}),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload?.data || data)
      });
      const body = await parseFeishuFetchBody(response);
      const headers = normalizeResponseHeaders(response?.headers || {});
      return normalizeFeishuSendResponse({
        status: response?.status,
        data: body,
        headers,
        requestUrl
      }, {
        ...meta,
        requestUrl,
        httpStatus: response?.status
      });
    } catch (error) {
      return normalizeFeishuSendError(error, {
        ...meta,
        requestUrl
      });
    }
  }

  async sendFile(to, file, opts = {}) {
    const upload = await this.uploadFile(file);
    if (!upload?.ok || !upload.fileKey) {
      throw new Error('Feishu file upload failed');
    }
    return this.sendRaw(String(to || ''), 'file', { file_key: upload.fileKey }, opts);
  }

  async downloadResource(fileKey, type) {
    if (type === 'image') {
      return this.rawClient.im.v1.image.get({ path: { image_key: fileKey } });
    }
    return this.rawClient.im.v1.file.get({ path: { file_key: fileKey } });
  }
}

export class FeishuService {
  constructor({ env = process.env, appDir = path.resolve(process.cwd(), '..'), logger = console, analyzeEssay: analyzeEssayImpl, zspaceClient } = {}) {
    this.env = env;
    this.appDir = appDir;
    this.logger = logger;
    this.config = loadFeishuConfig(env);
    this.analyzeEssay = typeof analyzeEssayImpl === 'function' ? analyzeEssayImpl : analyzeEssay;
    this.zspaceClient = zspaceClient;
    this.sdkVersion = SDK_VERSION;
    this.logDir = path.join(appDir, 'logs');
    this.logPath = path.join(this.logDir, 'feishu-connect.log');
    this.uploadDir = path.join(appDir, 'server', 'uploads', 'essay-ai', 'feishu');
    this.channel = null;
    this.connected = false;
    this.connectingPromise = null;
    this.heartbeatTimer = null;
    this.lastMessageAt = '';
    this.lastConnectedAt = '';
    this.lastError = '';
    this.connectAttempts = 0;
    this.botIdentity = null;
    this.connectionStatus = null;
    ensureDir(this.logDir);
    ensureDir(this.uploadDir);
  }

  log(level, message, extra = undefined) {
    const timestamp = new Date().toISOString();
    const suffix = extra == null ? '' : ` ${redactSecrets(safeString(extra))}`;
    const line = `[${timestamp}] [${level}] ${redactSecrets(String(message || ''))}${suffix}\n`;
    try {
      fs.appendFileSync(this.logPath, line, 'utf8');
    } catch {
      // ignore log write failures
    }
    const sink = this.logger?.[level] || this.logger?.info || this.logger?.log;
    if (typeof sink === 'function') {
      try {
        sink.call(this.logger, redactSecrets(String(message || '')), redactStructured(extra));
      } catch {
        // ignore logger failures
      }
    }
  }

  buildChannel() {
    if (!this.config.appConfigured) return null;
    const forwardLog = (level, ...args) => {
      const [message = '', ...rest] = args;
      const extra = rest.length === 0 ? undefined : (rest.length === 1 ? rest[0] : rest.map(safeString).join(' '));
      this.log(level, safeString(message), extra);
    };
    const logger = {
      info: (...args) => forwardLog('info', ...args),
      warn: (...args) => forwardLog('warn', ...args),
      error: (...args) => forwardLog('error', ...args),
      debug: (...args) => forwardLog('debug', ...args)
    };

    return new FeishuLongConnectionClient({
      appId: this.config.appId,
      appSecret: this.config.appSecret,
      logger,
      loggerLevel: LoggerLevel.info,
      source: 'v12-feishu-studio',
      wsConfig: { pingTimeout: 90 }
    });
  }

  scheduleHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.heartbeat().catch((error) => this.log('error', 'heartbeat failed', error?.message || error));
    }, 30000);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  getConnectionSnapshot() {
    const channelStatus = this.channel?.getConnectionStatus?.() || null;
    this.connectionStatus = channelStatus;
    return channelStatus;
  }

  getHealth() {
    const snapshot = this.getConnectionSnapshot();
    return {
      ok: Boolean(this.config.appConfigured),
      connected: this.connected,
      appConfigured: this.config.appConfigured,
      webhookConfigured: false,
      connectionMode: 'websocket',
      connectionState: snapshot?.state || (this.connected ? 'connected' : 'idle'),
      connectionStatus: snapshot || null,
      reconnectInfo: this.channel?.getReconnectInfo?.() || null,
      botInfo: this.getBotInfo(),
      sdkVersion: this.sdkVersion,
      logPath: this.logPath,
      lastConnectedAt: this.lastConnectedAt || '',
      lastMessageAt: this.lastMessageAt || '',
      lastError: this.lastError || ''
    };
  }

  getBotInfo() {
    if (this.botIdentity) {
      return {
        openId: this.botIdentity.openId || '',
        userId: this.botIdentity.userId || '',
        name: this.botIdentity.name || this.config.botName
      };
    }
    return {
      openId: '',
      userId: '',
      name: this.config.botName,
      appId: this.config.appId
    };
  }

  async connect() {
    if (this.connected && this.channel) {
      return this.getHealth();
    }
    if (this.connectingPromise) {
      return this.connectingPromise;
    }

    if (!this.config.appConfigured) {
      this.connected = false;
      this.lastError = 'FEISHU_APP_ID / FEISHU_APP_SECRET 未配置';
      this.log('warn', this.lastError);
      return this.getHealth();
    }

    this.connectAttempts += 1;
    this.connectingPromise = (async () => {
      if (!this.channel) {
        this.channel = this.buildChannel();
      }
      if (!this.channel) {
        throw new Error('飞书长连接客户端初始化失败');
      }

      const logEvent = (event) => {
        console.log('[EVENT]', JSON.stringify(event, null, 2));
      };

      this.channel.on({
        message: async (message) => {
          this.log('info', '[MESSAGE ENTER]', {
            real_event: message?.realEvent === true,
            event_type: message?.eventType || '',
            message_id: message?.messageId || message?.message_id || '',
            chat_id: message?.chatId || message?.chat_id || '',
            sender_user_id: message?.senderUserId || '',
            sender_open_id: message?.senderOpenId || '',
            message_type: message?.messageType || message?.message_type || '',
            chat_type: message?.chatType || ''
          });
          logEvent(message);
          await this.receiveMessage(message);
        },
        botAdded: async (event) => {
          logEvent(event);
          this.log('info', 'Feishu bot added to chat');
        },
        cardAction: async (event) => {
          logEvent(event);
          const evt = event;
          this.log('info', 'Feishu card action received', evt?.action?.value || evt?.operator?.open_id || '');
          await this.handleCardAction(evt);
        }
      });

      this.log('info', `Feishu connect attempt #${this.connectAttempts} using SDK ${this.sdkVersion}`);
      await this.channel.connect();
      this.connected = true;
      this.botIdentity = this.channel.botIdentity || this.botIdentity;
      this.lastConnectedAt = new Date().toISOString();
      this.lastError = '';
      this.scheduleHeartbeat();
      this.log('info', `Feishu connected as ${this.getBotInfo().name}`);
      return this.getHealth();
    })();

    try {
      return await this.connectingPromise;
    } catch (error) {
      this.connected = false;
      this.lastError = String(error?.message || error || '飞书连接失败');
      this.log('error', 'Feishu connect failed', this.lastError);
      throw error;
    } finally {
      this.connectingPromise = null;
    }
  }

  async reconnect() {
    this.log('warn', 'Feishu reconnect requested');
    await this.close({ force: true });
    this.channel = null;
    return this.connect();
  }

  async close({ force = false } = {}) {
    this.stopHeartbeat();
    if (this.channel) {
      try {
        await this.channel.disconnect();
      } catch (error) {
        this.log('warn', 'Feishu disconnect failed', error?.message || error);
      }
    }
    this.connected = false;
  }

  async heartbeat() {
    const status = this.getConnectionSnapshot();
    if (!this.config.appConfigured) {
      return this.getHealth();
    }
    if (!status || ['failed', 'disconnected', 'closed'].includes(String(status.state || '').toLowerCase())) {
      this.log('warn', `Feishu heartbeat detected ${status?.state || 'unavailable'}, reconnecting`);
      await this.reconnect();
    }
    return this.getHealth();
  }

  async sendMessage(to, text, opts = {}) {
    if (!this.channel) {
      throw new Error('Feishu channel not connected');
    }
    return this.channel.send(String(to || ''), { text: String(text || '') }, opts);
  }

  async sendMarkdown(to, markdown, opts = {}) {
    if (!this.channel) {
      throw new Error('Feishu channel not connected');
    }
    return this.channel.send(String(to || ''), { markdown: String(markdown || '') }, opts);
  }

  async sendCard(to, card, opts = {}) {
    if (!this.channel) {
      throw new Error('Feishu channel not connected');
    }
    return this.channel.send(String(to || ''), { card }, opts);
  }

  async sendFile(to, file, opts = {}) {
    if (!this.channel) {
      throw new Error('Feishu channel not connected');
    }
    if (typeof this.channel.sendFile === 'function') {
      return this.channel.sendFile(String(to || ''), file, opts);
    }
    const upload = await this.channel.uploadFile?.(file);
    if (!upload?.ok || !upload.fileKey) {
      throw new Error('Feishu file upload failed');
    }
    return this.channel.send(String(to || ''), { file: { file_key: upload.fileKey } }, opts);
  }

  async deliverReportFiles({
    target = '',
    archiveId = '',
    messageId = '',
    userId = '',
    files = []
  } = {}) {
    if (!this.config.fileUploadEnabled) {
      return { ok: false, skipped: true, reason: 'file upload disabled' };
    }
    if (!this.zspaceClient?.downloadFile || !archiveId) {
      return { ok: false, skipped: true, reason: 'file source unavailable' };
    }

    const results = [];
    for (const file of files) {
      const fileName = String(file?.name || '').toLowerCase();
      if (!['report.pdf', 'report.docx'].includes(fileName)) continue;
      try {
        const buffer = await this.zspaceClient.downloadFile(file.remotePath);
        const response = await this.sendFile(target, {
          fileName: file.name,
          fileType: fileName.endsWith('.pdf') ? 'pdf' : 'docx',
          source: buffer
        }, {
          messageId,
          receiveIdType: 'chat_id',
          replyTo: messageId
        });
        results.push({ ok: true, fileName: file.name, messageId: response?.messageId || '' });
      } catch (error) {
        this.log('warn', 'Feishu report file delivery failed', {
          archive_id: archiveId,
          file_name: file?.name || '',
          message: error?.message || String(error || '')
        });
        results.push({ ok: false, fileName: file?.name || '', error: String(error?.message || error || '') });
      }
    }
    return { ok: results.some((item) => item.ok), skipped: false, results };
  }

  async handleCardAction(event = {}) {
    const action = parseEssayCardActionValue(event?.action?.value);
    const command = String(action.command || event?.action?.tag || '').trim();
    if (command === 'essay-rerun') {
      await this.sendMessage(event.chatId || event?.chat_id || '', '已收到重新批改请求，请在网页端或教师工作台发起再次批改。', {
        receiveIdType: 'chat_id',
        messageId: event.messageId || ''
      });
      return { ok: true, command };
    }
    if (!command || !command.startsWith('essay-report-')) return { ok: false, skipped: true, reason: 'unsupported action' };

    const archiveId = String(action.archiveId || '').trim();
    if (!archiveId) {
      await this.sendMessage(event.chatId || event?.chat_id || '', '缺少报告标识，无法打开分页报告', {
        receiveIdType: 'chat_id',
        messageId: event.messageId || ''
      });
      return { ok: false, reason: 'archive id missing' };
    }

    const report = await loadFeishuEssayReport({
      appDir: this.appDir,
      archiveId,
      client: this.zspaceClient,
      env: this.env,
      userId: event?.operator?.openId || 'feishu',
      logger: this.logger
    });
    if (!report.ok) {
      await this.sendMessage(event.chatId || event?.chat_id || '', '未找到对应批改报告，请先重新批改一次', {
        receiveIdType: 'chat_id',
        messageId: event.messageId || ''
      });
      return { ok: false, reason: report.reason || 'report missing' };
    }

    const links = { ...(report.links || {}), archiveId };
    const page = Number(action.page || 1);
    const replyCard = command === 'essay-report-overview'
      ? buildEssayResultCard(report.reportJson || {}, { links })
      : buildEssayReportPageCard(report.reportJson || {}, { links, archiveId, page });
    const result = await this.replyMessage({
      target: event.chatId || '',
      chatId: event.chatId || '',
      messageId: event.messageId || '',
      replyType: 'card',
      card: replyCard,
      forceMode: this.config.replyMode,
      receiveIdType: 'chat_id'
    });
    this.logSendHttpResponse(result, {
      replyType: 'card',
      requestedMode: this.config.replyMode,
      actualMode: result?.mode || '',
      targetChatId: event.chatId || '',
      receiveId: event.chatId || '',
      targetMessageId: event.messageId || '',
      incomingChatId: event.chatId || '',
      incomingMessageId: event.messageId || '',
      receiveIdType: 'chat_id'
    });
    return { ok: true, command, archiveId, page };
  }

  isSendOk(result = {}) {
    if (result?.ok === false) return false;
    const httpStatus = Number(result?.httpStatus || 0);
    if (httpStatus && (httpStatus < 200 || httpStatus >= 300)) return false;
    if (Number.isFinite(Number(result?.code)) && Number(result.code) !== 0) return false;
    return true;
  }

  logSendHttpResponse(result = {}, context = {}) {
    const payload = {
      reply_type: context.replyType || '',
      requested_mode: context.requestedMode || '',
      actual_mode: result.mode || context.actualMode || '',
      msg_type: result.msgType || context.msgType || '',
      request_url: result.requestUrl || context.requestUrl || '',
      http_status: Number(result.httpStatus || context.httpStatus || 0),
      code: Number(result.code ?? 0),
      msg: result.msg || '',
      request_id: result.requestId || '',
      data_message_id: result.dataMessageId || result.messageId || '',
      target_chat_id: result.chatId || context.targetChatId || '',
      receive_id: result.receiveId || context.receiveId || '',
      target_message_id: result.replyToMessageId || context.targetMessageId || '',
      incoming_chat_id: context.incomingChatId || '',
      incoming_message_id: context.incomingMessageId || '',
      receive_id_type: result.receiveIdType || context.receiveIdType || ''
    };
    if (!this.isSendOk(result)) {
      payload.error = result.error || result.msg || 'Feishu send failed';
      payload.raw_response = result.raw || null;
    }
    this.log(this.isSendOk(result) ? 'info' : 'error', 'Feishu send HTTP response', payload);
  }

  buildReplyOptions({ messageId = '', chatId = '', forceMode = '', receiveIdType = '' } = {}) {
    const requestedMode = forceMode || this.config.replyMode || 'send';
    const replyTo = requestedMode === 'reply' ? String(messageId || '') : '';
    return {
      replyMode: requestedMode,
      replyTo,
      messageId: String(messageId || ''),
      chatId: String(chatId || ''),
      receiveIdType,
      fallbackToSend: true
    };
  }

  async replyMessage({ target, messageId = '', chatId = '', replyType = 'text', text = '', markdown = '', card = null, forceMode = '', receiveIdType = '' } = {}) {
    const requestedMode = forceMode || this.config.replyMode || 'send';
    const sendOnce = async (options) => {
      if (replyType === 'card') return this.sendCard(target, card, options);
      if (replyType === 'markdown') return this.sendMarkdown(target, markdown, options);
      return this.sendMessage(target, text, options);
    };
    const initialOptions = this.buildReplyOptions({ messageId, chatId, forceMode, receiveIdType });
    const context = {
      replyType,
      requestedMode,
      targetChatId: target || '',
      receiveId: target || '',
      targetMessageId: initialOptions.replyTo || '',
      incomingChatId: chatId || '',
      incomingMessageId: messageId || '',
      receiveIdType: initialOptions.receiveIdType || ''
    };
    const firstResult = await sendOnce(initialOptions);
    this.logSendHttpResponse(firstResult, context);
    if (this.isSendOk(firstResult) || !initialOptions.replyTo) {
      return firstResult;
    }

    this.log('warn', 'Feishu reply failed, falling back to send', {
      reply_type: replyType,
      code: Number(firstResult.code ?? -1),
      msg: firstResult.msg || '',
      request_id: firstResult.requestId || '',
      failed_message_id: messageId || '',
      fallback_chat_id: target || ''
    });

    const fallbackOptions = {
      ...initialOptions,
      replyMode: 'send',
      replyTo: ''
    };
    const fallbackResult = await sendOnce(fallbackOptions);
    this.logSendHttpResponse(fallbackResult, {
      ...context,
      requestedMode: 'send',
      targetMessageId: ''
    });
    return fallbackResult;
  }

  async uploadFile({ file, fileName = 'file', fileType = '', source = file, mimeType = '' } = {}) {
    if (!this.channel?.rawClient) {
      throw new Error('Feishu channel not connected');
    }

    const input = source || file;
    const resolvedName = String(fileName || 'file');
    const resolvedType = String(fileType || fileTypeFromName(resolvedName, mimeType));

    if (resolvedType === 'image') {
      const response = await this.channel.rawClient.im.v1.image.create({
        data: {
          image_type: 'message',
          image: input
        }
      });
      return {
        ok: true,
        kind: 'image',
        imageKey: response?.image_key || ''
      };
    }

    const uploadTypeMap = {
      pdf: 'pdf',
      doc: 'doc',
      xls: 'xls',
      ppt: 'ppt',
      mp4: 'mp4',
      opus: 'opus',
      stream: 'stream',
      file: 'stream'
    };

    const response = await this.channel.rawClient.im.v1.file.create({
      data: {
        file_type: uploadTypeMap[resolvedType] || 'stream',
        file_name: resolvedName,
        file: input
      }
    });

    return {
      ok: true,
      kind: 'file',
      fileKey: response?.file_key || ''
    };
  }

  async persistResource(resource, index = 0) {
    if (!this.channel || !resource?.fileKey) return null;
    const resourceType = resourceTypeFromName(resource.fileName || '', resource.mimeType || '');
    const response = await this.channel.downloadResource(resource.fileKey, resourceType);
    const fallbackExt = resourceType === 'image' ? '.png' : '';
    const baseName = path.basename(String(resource.fileName || `feishu-resource-${index + 1}${fallbackExt}`));
    const safeName = baseName.replace(/[^\w.\-()（）\u4e00-\u9fa5]+/g, '_');
    const savedPath = path.join(this.uploadDir, `${Date.now()}-${randomUUID()}-${safeName || `resource-${index + 1}`}`);
    await response.writeFile(savedPath);
    return {
      fieldname: 'files',
      originalname: resource.fileName || safeName,
      filename: resource.fileName || safeName,
      path: savedPath,
      mimetype: resourceType === 'image' ? 'image/png' : 'application/octet-stream',
      size: fs.statSync(savedPath).size
    };
  }

  async receiveMessage(message = {}) {
    this.log('info', '[HANDLER ENTER]', {
      incoming_message_id: message?.messageId || message?.message_id || '',
      incoming_chat_id: message?.chatId || message?.chat_id || '',
      real_event: message.realEvent === true || message?.raw?.realEvent === true || false
    });
    try {
      const incoming = classifyFeishuIncomingMessage(message, { botName: this.config.botName });
      const chatId = String(incoming.chatId || message.chatId || message.chat_id || '');
      const senderId = String(incoming.senderId || message.senderId || message.sender?.openId || message.sender?.sender_id?.open_id || '');
      const text = String(incoming.text || '').trim();
      const resources = Array.isArray(message.resources) ? message.resources.filter(Boolean) : [];
      const command = incoming.command || parseFeishuCommand(text);
      const directTarget = resolveDirectReceiveTarget(message, incoming);
      const adminAllowed = canExecuteFeishuCommand({
        commandKey: command.key,
        openId: senderId,
        config: this.config
      });
      const realEvent = message.realEvent === true || incoming.realEvent === true;
      const useDirectSend = realEvent || this.config.replyMode !== 'reply';
      const target = (useDirectSend ? directTarget.receiveId : '') || chatId || senderId;
      const targetReceiveIdType = useDirectSend
        ? (directTarget.receiveId === target ? directTarget.receiveIdType : (chatId ? 'chat_id' : detectReceiveIdType(target)))
        : detectReceiveIdType(target);
      if (!target) {
        return { ok: false, message: 'missing target' };
      }

      this.lastMessageAt = new Date().toISOString();
      this.log('info', 'Feishu message received', {
        real_event: message.realEvent === true,
        mocked_event: message.realEvent === true ? false : message.mockedEvent === true || !message.raw,
        event_type: message.eventType || '',
        message_id: incoming.messageId || message.messageId || message.message_id || '',
        chat_id: chatId || '',
        sender_id: senderId || '',
        direct_receive_id: directTarget.receiveId || '',
        direct_receive_id_type: directTarget.receiveIdType || '',
        message_type: incoming.messageType || message.message_type || message.msg_type || '',
        raw_content: incoming.rawContent || '',
        parsed_text: text,
        command: command.key || 'unknown',
        word_count: incoming.wordCount ?? text.replace(/\s+/g, '').length,
        resource_count: resources.length
      });

      const incomingMessageId = incoming.messageId || message.messageId || message.message_id || '';
      const sendDirectReply = async ({ replyType = 'text', text: replyText = '', markdown = '', card = null }) => {
        const result = replyType === 'card'
          ? await this.sendCard(target, card, {
              receiveIdType: targetReceiveIdType,
              messageId: incomingMessageId
            })
          : replyType === 'markdown'
            ? await this.sendMarkdown(target, markdown, {
                receiveIdType: targetReceiveIdType,
                messageId: incomingMessageId
              })
            : await this.sendMessage(target, replyText, {
                receiveIdType: targetReceiveIdType,
                messageId: incomingMessageId
              });
        this.logSendHttpResponse(result, {
          replyType,
          requestedMode: 'send',
          actualMode: 'send',
          targetChatId: target,
          receiveId: target,
          targetMessageId: '',
          incomingChatId: chatId || '',
          incomingMessageId,
          receiveIdType: targetReceiveIdType
        });
        return result;
      };
      const sendCardReply = async (card) => {
        const result = realEvent
          ? await sendDirectReply({ replyType: 'card', card })
          : await this.replyMessage({
              target,
              chatId,
              messageId: incomingMessageId,
              replyType: 'card',
              card,
              receiveIdType: targetReceiveIdType,
              forceMode: ''
            });
        this.log('info', 'Feishu reply result', {
          message_id: incomingMessageId,
          reply_type: 'card',
          reply_message_id: result?.messageId || '',
          request_id: result?.requestId || '',
          code: Number(result?.code ?? 0),
          actual_mode: result?.mode || ''
        });
        return result;
      };
      const sendTextReply = async (replyText) => {
        const result = realEvent
          ? await sendDirectReply({ replyType: 'text', text: replyText })
          : await this.replyMessage({
              target,
              chatId,
              messageId: incomingMessageId,
              replyType: 'text',
              text: replyText,
              receiveIdType: targetReceiveIdType,
              forceMode: ''
            });
        this.log('info', 'Feishu reply result', {
          message_id: incomingMessageId,
          reply_type: 'text',
          reply_message_id: result?.messageId || '',
          request_id: result?.requestId || '',
          code: Number(result?.code ?? 0),
          actual_mode: result?.mode || '',
          reply_text: replyText
        });
        return result;
      };

      if (text === '测试回复002') {
        await sendTextReply('123456');
        return { ok: true, command: 'test-reply-002', sent: 'text' };
      }

      if (text === '测试123') {
        await sendTextReply('测试回复');
        return { ok: true, command: 'test-reply', sent: 'text' };
      }

      if (text === '你好') {
        await sendTextReply('你好，我是 Chinese Teacher AI Studio。');
        return { ok: true, command: 'greeting', sent: 'text' };
      }

      if (command.key === 'essay' && !incoming.essayText && resources.length === 0) {
        await sendTextReply('我已收到消息。请发送“批改作文+作文正文”，也可以直接发送完整作文。');
        return { ok: true, command: 'essay', sent: 'text' };
      }

      if (command.key === 'help') {
        await sendCardReply(buildHelpCard());
        return { ok: true, command: 'help', sent: 'card' };
      }

      if (command.key === 'status') {
        const status = getSystemStatus({ appDir: this.appDir, env: this.env });
        await sendCardReply(buildStatusCard(status));
        return { ok: true, command: 'status', sent: 'card' };
      }

      if (command.key === 'daily') {
        const status = getSystemStatus({ appDir: this.appDir, env: this.env });
        const report = getLatestDailyReport({ appDir: this.appDir });
        await sendCardReply(buildDailyReportCard({
          reportPath: report.path || status.latestDailyReport?.path || '',
          summary: report.summary || status.latestDailyReport?.summary || '暂无最近日报'
        }));
        return { ok: true, command: 'daily', sent: 'card' };
      }

      if (command.key === 'logs') {
        if (!adminAllowed) {
          await sendTextReply('权限不足，仅管理员可查看日志');
          return { ok: true, command: 'logs', sent: 'text' };
        }
        const logs = getSystemLogs({ appDir: this.appDir });
        await sendCardReply(buildLogsCard({ summary: logs.summary || '暂无错误摘要' }));
        return { ok: true, command: 'logs', sent: 'card' };
      }

      if (command.key === 'backup') {
        if (!adminAllowed) {
          await sendTextReply('权限不足，仅管理员可执行备份');
          return { ok: true, command: 'backup', sent: 'text' };
        }
        const backupResult = triggerBackup({ appDir: this.appDir });
        await sendCardReply(buildBackupCard({ ok: backupResult.ok, path: backupResult.path || '', message: backupResult.message || '' }));
        return { ok: true, command: 'backup', sent: 'card' };
      }

      if (command.key === 'nas') {
        const result = command.text
          ? readNasFileForFeishu({ appDir: this.appDir, query: command.text })
          : findNasFilesForFeishu({ appDir: this.appDir, limit: 6 });
        const lines = result.items.length
          ? result.items.map((item, index) => {
            const base = `${index + 1}. ${item.status} ${item.remotePath}\n${item.sha256 ? item.sha256.slice(0, 12) : ''} ${item.syncedAt || item.createdAt || ''}`;
            if (!item.preview) return base;
            return item.preview.ok ? `${base}\n${item.preview.text}` : `${base}\n${item.preview.message}`;
          })
          : [result.message || '暂无 NAS 同步文件'];
        await sendTextReply(`NAS 文件${command.text ? `：${command.text}` : ''}\n${lines.join('\n')}`);
        return { ok: true, command: 'nas', sent: 'text' };
      }

      if (command.key === 'restart') {
        if (!adminAllowed) {
          await sendTextReply('权限不足，仅管理员可执行重启');
          return { ok: true, command: 'restart', sent: 'text' };
        }
        await sendCardReply(buildRestartCard({ confirmToken: this.config.restartConfirmToken }));
        return { ok: true, command: 'restart', sent: 'card' };
      }

      if (['essay', 'paper', 'ppt', 'morning'].includes(command.key)) {
        if (command.key === 'essay' && !incoming.essayText && resources.length === 0) {
          await sendCardReply(buildEssayMenuCard());
          return { ok: true, command: 'essay', sent: 'card' };
        }
        if (command.key !== 'essay') {
          await sendTextReply('功能入口已预留，将在 V11.1 接入');
          return { ok: true, command: command.key, sent: 'text' };
        }
      }

      const shouldHandleEssay = command.key === 'essay'
        || resources.some((resource) => ['image', 'file'].includes(String(resource.type || '').toLowerCase()))
        || (!command.key || command.key === 'unknown' && resources.length > 0);

      if (shouldHandleEssay) {
        const essayText = incoming.essayText || text;
        this.log('info', 'Feishu AI call start', {
          message_id: incoming.messageId || '',
          chat_id: chatId || '',
          word_count: essayText.replace(/\s+/g, '').length
        });
        if (resources.length > 0) {
          await sendTextReply('已收到作文文件，正在识别与批改。');
        }

        const downloadedFiles = [];
        for (let index = 0; index < resources.length; index += 1) {
          const resource = resources[index];
          if (!resource?.fileKey) continue;
          try {
            const file = await this.persistResource(resource, index);
            if (file) downloadedFiles.push(file);
          } catch (error) {
            this.log('error', 'Feishu resource download failed', error?.message || error);
          }
        }

        const title = incoming.command?.text ? incoming.command.text.slice(0, 12) : (downloadedFiles[0]?.originalname || '飞书作文');
        const analysis = await this.analyzeEssay({
          appDir: this.appDir,
          title,
          text: essayText,
          source: 'feishu',
          files: downloadedFiles
        });
        this.log('info', 'Feishu AI call result', {
          message_id: incoming.messageId || '',
          analysis_id: analysis.id || '',
          status: analysis.status || '',
          total_score: analysis.result?.totalScore ?? null,
          full_score: analysis.result?.fullScore ?? null,
          level: analysis.result?.level || ''
        });

        if (analysis.status === 'pending_ocr') {
          await sendTextReply(analysis.message || 'OCR 服务未配置，请先接入 OCR');
          return { ok: true, command: 'essay', sent: 'text', analysisId: analysis.id, status: analysis.status };
        }

        const archiveLinks = await archiveFeishuEssayResult({
          appDir: this.appDir,
          env: this.env,
          client: this.zspaceClient,
          analysis,
          title,
          text: essayText,
          feishuUserId: senderId,
          logger: this.logger
        });
        this.log('info', 'Feishu archive link result', {
          message_id: incomingMessageId,
          analysis_id: analysis.id || '',
          archive_id: archiveLinks.archiveId || '',
          available: Boolean(archiveLinks.links?.available),
          has_report: Boolean(archiveLinks.links?.reportUrl),
          has_docx: Boolean(archiveLinks.links?.docxUrl),
          has_pdf: Boolean(archiveLinks.links?.pdfUrl)
        });

        await this.deliverReportFiles({
          target,
          archiveId: archiveLinks.archiveId || '',
          messageId: incomingMessageId,
          userId: senderId,
          files: archiveLinks.archive?.record?.files || []
        });

        const publicOrigin = (this.env.PUBLIC_APP_ORIGIN || this.env.FEISHU_REPORT_PUBLIC_BASE_URL || 'https://pi.zhenwanyue.icu').replace(/\/+$/, '');
        await sendCardReply(buildEssayResultCard(analysis.result || {}, { links: { ...(archiveLinks.links || {}), archiveId: archiveLinks.archiveId || '', teacherReviewUrl: `${publicOrigin}/teacher/reviews?archiveId=${encodeURIComponent(archiveLinks.archiveId || analysis.id || '')}` } }));
        const summaryLines = [
          `作文 AI 批改完成：${analysis.result?.totalScore ?? '暂无'} / ${analysis.result?.fullScore ?? 60}`,
          `等级：${analysis.result?.level || '暂无'}`,
          `一句话总评：${String(analysis.result?.overallEvaluation || analysis.result?.teacherComment || analysis.result?.teacher_overall || '').trim().slice(0, 120) || '暂无'}`,
          `教师评语：${analysis.result?.teacherComment || '暂无'}`
        ];
        const markdownResult = await this.replyMessage({
          target,
          chatId,
          messageId: incomingMessageId,
          replyType: 'markdown',
          markdown: markdownFromLines(summaryLines),
          receiveIdType: targetReceiveIdType,
          forceMode: realEvent ? 'send' : ''
        });
        this.log('info', 'Feishu reply result', {
          message_id: incomingMessageId,
          reply_type: 'markdown',
          reply_message_id: markdownResult?.messageId || '',
          request_id: markdownResult?.requestId || '',
          code: Number(markdownResult?.code ?? 0),
          actual_mode: markdownResult?.mode || ''
        });
        return {
          ok: true,
          command: 'essay',
          sent: 'card',
          analysisId: analysis.id,
          status: analysis.status,
          result: analysis.result || null
        };
      }

      await sendTextReply('我已收到消息。请发送“批改作文+作文正文”，也可以直接发送完整作文。');
      return { ok: true, command: command.key || 'unknown', sent: 'text' };
    } finally {
      this.log('info', '[HANDLER EXIT]', {
        last_message_at: this.lastMessageAt || '',
        connected: this.connected
      });
    }
  }
}

export function createFeishuService(options = {}) {
  return new FeishuService(options);
}

export function getFeishuHealthSnapshot({ service } = {}) {
  return service?.getHealth?.() || {
    ok: false,
    connected: false,
    appConfigured: false,
    webhookConfigured: false,
    connectionMode: 'websocket',
    connectionState: 'idle',
    connectionStatus: null,
    reconnectInfo: null,
    botInfo: null,
    sdkVersion: SDK_VERSION,
    logPath: '',
    lastConnectedAt: '',
    lastMessageAt: '',
    lastError: ''
  };
}
