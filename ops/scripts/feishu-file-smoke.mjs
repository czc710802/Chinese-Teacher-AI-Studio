#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadServerEnv } from '../../server/src/config/env.js';
import { archiveSyntheticPayload } from '../../server/src/services/archive-pipeline.js';
import { buildArchiveDownloadLinks, createSignedDownloadUrl } from '../../server/src/services/file-access.js';
import { createZSpaceClient } from '../../server/src/services/zspace-storage.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '../..');

loadServerEnv({ appDir, nodeEnv: 'production' });

const client = createZSpaceClient({ env: process.env });
const archiveId = `feishu-file-smoke-${Date.now()}`;
const checkedAt = new Date().toISOString();

function hasInternalUrl(value) {
  return /(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.|webdav|file:\/\/|ZSPACE_WEBDAV_USERNAME|ZSPACE_WEBDAV_PASSWORD)/i.test(String(value || ''));
}

async function getStatus(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'manual' });
  await response.arrayBuffer().catch(() => new ArrayBuffer(0));
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    disposition: response.headers.get('content-disposition') || ''
  };
}

const archive = await archiveSyntheticPayload({
  appDir,
  client,
  payload: {
    id: archiveId,
    className: 'FeishuFileSmoke',
    studentNo: '0000',
    studentName: 'Smoke',
    essayTitle: `Feishu文件-${checkedAt.slice(0, 10)}`,
    createdAt: checkedAt,
    provider: process.env.AI_PRIMARY_PROVIDER || process.env.AI_PROVIDER || 'deepseek',
    model: process.env.DEEPSEEK_MODEL || '',
    score: 48,
    grade: '二类文',
    originalText: '青年应当如何处理个人选择与时代责任之间的关系？请简要分析。',
    ocrText: 'Feishu file smoke OCR text'
  }
});

if (!archive.ok || archive.queued) {
  console.log('Report URL HTTP=0');
  console.log('DOCX URL HTTP=0');
  console.log('PDF URL HTTP=0');
  console.log('PDF Content-Type=false');
  console.log('DOCX Content-Type=false');
  console.log('Signed URL=false');
  console.log('Expired URL=false');
  console.log('Invalid URL=false');
  console.log('No Internal IP=false');
  console.log('No WebDAV Credential=false');
  process.exit(1);
}

const links = await buildArchiveDownloadLinks({ appDir, archiveId, userId: 'feishu-smoke', env: process.env, client });
const report = await getStatus(links.reportUrl);
const docx = await getStatus(links.docxUrl);
const pdf = await getStatus(links.pdfUrl);
const expiredUrl = createSignedDownloadUrl({ archiveId, fileType: 'pdf', userId: 'feishu-smoke', expiresInSeconds: -1, env: process.env });
const expired = await getStatus(expiredUrl);
const invalid = await getStatus(links.pdfUrl.replace(/token=[^&]+/, 'token=invalid'));
const serializedLinks = JSON.stringify(links);

console.log(`Report URL HTTP=${report.status}`);
console.log(`DOCX URL HTTP=${docx.status}`);
console.log(`PDF URL HTTP=${pdf.status}`);
console.log(`PDF Content-Type=${pdf.contentType.includes('application/pdf')}`);
console.log(`DOCX Content-Type=${docx.contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')}`);
console.log(`Signed URL=${Boolean(links.reportUrl && links.docxUrl && links.pdfUrl)}`);
console.log(`Expired URL=${expired.status}`);
console.log(`Invalid URL=${invalid.status}`);
console.log(`No Internal IP=${!hasInternalUrl(serializedLinks)}`);
console.log(`No WebDAV Credential=${!/(username|password|Basic\s|Bearer\s)/i.test(serializedLinks)}`);

if (
  report.status !== 200 ||
  docx.status !== 200 ||
  pdf.status !== 200 ||
  !pdf.contentType.includes('application/pdf') ||
  !docx.contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') ||
  expired.status !== 410 ||
  invalid.status !== 403 ||
  hasInternalUrl(serializedLinks) ||
  /(username|password|Basic\s|Bearer\s)/i.test(serializedLinks)
) {
  process.exit(1);
}
