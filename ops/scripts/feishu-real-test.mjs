#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadServerEnv } from '../../server/src/config/env.js';
import { createFeishuService } from '../../server/src/integrations/feishu/service.js';
import { archiveSyntheticPayload } from '../../server/src/services/archive-pipeline.js';
import { createZSpaceClient } from '../../server/src/services/zspace-storage.js';
import { sectionsToDocxBuffer, sectionsToPdfBuffer } from '../../server/src/services/exporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');
const outputDir = path.join(appDir, 'exports', 'feishu-real-test');

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--chat-id' && argv[i + 1]) {
      args.chatId = argv[i + 1];
      i += 1;
    } else if (item.startsWith('--chat-id=')) {
      args.chatId = item.slice('--chat-id='.length);
    } else if (item === '--title' && argv[i + 1]) {
      args.title = argv[i + 1];
      i += 1;
    } else if (item.startsWith('--title=')) {
      args.title = item.slice('--title='.length);
    }
  }
  return args;
}

function printStep(step, payload) {
  console.log(JSON.stringify({ step, ...payload }, null, 2));
}

function redactEnvSummary(env) {
  const keys = [
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
    'FEISHU_VERIFICATION_TOKEN',
    'FEISHU_ENCRYPT_KEY',
    'FEISHU_FILE_UPLOAD_ENABLED',
    'FEISHU_REPORT_CARD_ENABLED',
    'FEISHU_REPORT_PAGINATION_ENABLED',
    'FEISHU_FILE_LINK_SECRET',
    'FEISHU_FILE_LINK_TTL_SECONDS',
    'FEISHU_BUSINESS_ENABLED',
    'FEISHU_STUDENT_SUBMISSION_ENABLED',
    'FEISHU_TEACHER_REVIEW_ENABLED',
    'FEISHU_REGRADING_ENABLED',
    'FEISHU_SYSTEM_NOTIFICATION_ENABLED',
    'FEISHU_REPORT_PUBLIC_BASE_URL'
  ];
  const out = {};
  for (const key of keys) out[key] = env[key] ? 'SET' : 'MISSING';
  return out;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const bodyText = await response.text();
  let bodyJson = null;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    bodyJson = null;
  }
  return { status: response.status, ok: response.ok, bodyText, bodyJson };
}

async function getTenantAccessToken(env) {
  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: env.FEISHU_APP_ID,
      app_secret: env.FEISHU_APP_SECRET
    })
  });
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status,
    code: body.code ?? null,
    msg: body.msg || body.message || '',
    request_id: body.request_id || body.requestId || '',
    tenant_access_token: body.tenant_access_token || '',
    expire: body.expire || null
  };
}

async function sendMessage({ token, receiveId, receiveIdType = 'chat_id', msgType, content }) {
  const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${encodeURIComponent(receiveIdType)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: msgType,
      content: JSON.stringify(content)
    })
  });
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status,
    code: body.code ?? null,
    msg: body.msg || body.message || '',
    request_id: body.request_id || body.requestId || '',
    data_message_id: body.data?.message_id || body.data?.messageId || body.message_id || body.messageId || ''
  };
}

async function uploadFile({ token, fileName, fileType, buffer }) {
  const form = new FormData();
  form.append('file_type', fileType);
  form.append('file_name', fileName);
  form.append('file', new Blob([buffer]), fileName);
  const response = await fetch('https://open.feishu.cn/open-apis/im/v1/files', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form
  });
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status,
    code: body.code ?? null,
    msg: body.msg || body.message || '',
    request_id: body.request_id || body.requestId || '',
    file_key: body.data?.file_key || body.file_key || ''
  };
}

async function main() {
  loadServerEnv({ appDir, nodeEnv: 'production' });
  const env = process.env;
  const { chatId, title } = parseArgs();
  if (!chatId) {
    console.error('请提供飞书测试群 chatId');
    process.exit(1);
  }
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) {
    console.error('FEISHU_APP_ID / FEISHU_APP_SECRET 未配置');
    process.exit(1);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const service = createFeishuService({ appDir, env, zspaceClient: createZSpaceClient({ env }) });
  service.channel = service.buildChannel();
  if (!service.channel) {
    console.error('飞书客户端初始化失败');
    process.exit(1);
  }

  console.log(JSON.stringify({
    chatId,
    env: redactEnvSummary(env)
  }, null, 2));

  const token = await getTenantAccessToken(env);
  printStep('tenant_access_token', token);
  if (!token.tenant_access_token) process.exit(1);

  const text = await sendMessage({
    token: token.tenant_access_token,
    receiveId: chatId,
    receiveIdType: 'chat_id',
    msgType: 'text',
    content: { text: 'Feishu real test: 文本消息测试。' }
  });
  printStep('send_text', text);

  const card = {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: 'Chinese Teacher AI Studio Test' } },
    elements: [
      { tag: 'div', text: { tag: 'lark_md', content: '**Feishu real test card**' } }
    ]
  };
  const cardRes = await sendMessage({
    token: token.tenant_access_token,
    receiveId: chatId,
    receiveIdType: 'chat_id',
    msgType: 'interactive',
    content: card
  });
  printStep('send_card', cardRes);

  const archive = await archiveSyntheticPayload({
    appDir,
    client: createZSpaceClient({ env }),
    payload: {
      id: `feishu-real-test-${Date.now()}`,
      className: 'FeishuRealTest',
      studentNo: '0000',
      studentName: 'Test',
      essayTitle: title || 'Feishu Real Test Report',
      createdAt: new Date().toISOString(),
      provider: env.AI_PRIMARY_PROVIDER || env.AI_PROVIDER || 'deepseek',
      model: env.DEEPSEEK_MODEL || '',
      score: 48,
      grade: '二类文',
      originalText: '青年应当如何处理个人选择与时代责任之间的关系？请简要分析。',
      ocrText: 'Feishu real test OCR text'
    }
  });
  printStep('archive_report', {
    ok: archive.ok,
    queued: archive.queued,
    basePath: archive.basePath || '',
    recordId: archive.record?.id || ''
  });

  const pdfBuffer = await sectionsToPdfBuffer('Feishu Real Test PDF', [{ title: '检查', content: ['PDF 生成测试'] }]);
  const docxBuffer = await sectionsToDocxBuffer('Feishu Real Test DOCX', [{ title: '检查', content: ['DOCX 生成测试'] }]);

  const pdfPath = path.join(outputDir, 'feishu-real-test.pdf');
  const docxPath = path.join(outputDir, 'feishu-real-test.docx');
  fs.writeFileSync(pdfPath, pdfBuffer);
  fs.writeFileSync(docxPath, docxBuffer);
  printStep('generate_pdf', { path: pdfPath, bytes: pdfBuffer.length, mime: 'application/pdf' });
  printStep('generate_docx', { path: docxPath, bytes: docxBuffer.length, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

  const pdfUpload = await uploadFile({
    token: token.tenant_access_token,
    fileName: path.basename(pdfPath),
    fileType: 'pdf',
    buffer: pdfBuffer
  });
  printStep('upload_pdf', pdfUpload);
  if (pdfUpload.file_key) {
    const pdfSend = await sendMessage({
      token: token.tenant_access_token,
      receiveId: chatId,
      receiveIdType: 'chat_id',
      msgType: 'file',
      content: { file_key: pdfUpload.file_key }
    });
    printStep('send_pdf_file', pdfSend);
  }

  const docxUpload = await uploadFile({
    token: token.tenant_access_token,
    fileName: path.basename(docxPath),
    fileType: 'docx',
    buffer: docxBuffer
  });
  printStep('upload_docx', docxUpload);
  if (docxUpload.file_key) {
    const docxSend = await sendMessage({
      token: token.tenant_access_token,
      receiveId: chatId,
      receiveIdType: 'chat_id',
      msgType: 'file',
      content: { file_key: docxUpload.file_key }
    });
    printStep('send_docx_file', docxSend);
  }

  const reportUrl = archive.links?.reportUrl || '';
  printStep('report_link', {
    url: reportUrl,
    safe: reportUrl.startsWith('https://pi.zhenwanyue.icu') && !/localhost|127\.0\.0\.1/i.test(reportUrl)
  });
  if (reportUrl) {
    const reportSend = await sendMessage({
      token: token.tenant_access_token,
      receiveId: chatId,
      receiveIdType: 'chat_id',
      msgType: 'text',
      content: { text: `完整报告：${reportUrl}` }
    });
    printStep('send_report_link', reportSend);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    step: 'fatal',
    message: String(error?.message || error || 'unknown error')
  }, null, 2));
  process.exit(1);
});
