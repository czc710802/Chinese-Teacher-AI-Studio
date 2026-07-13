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
const origin = String(process.env.PUBLIC_APP_ORIGIN || 'https://pi.zhenwanyue.icu').replace(/\/+$/, '');
const archiveId = `public-files-${Date.now()}`;
const checkedAt = new Date().toISOString();

function noInternal(value) {
  return !/(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.|webdav|file:\/\/)/i.test(String(value || ''));
}

async function statusOf(url, options = {}) {
  const response = await fetch(url, { ...options, redirect: 'manual' });
  await response.arrayBuffer().catch(() => new ArrayBuffer(0));
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    contentRange: response.headers.get('content-range') || ''
  };
}

const archive = await archiveSyntheticPayload({
  appDir,
  client,
  payload: {
    id: archiveId,
    className: 'PublicFileSmoke',
    studentNo: '0000',
    studentName: 'Smoke',
    essayTitle: `PublicFiles-${checkedAt.slice(0, 10)}`,
    createdAt: checkedAt,
    provider: process.env.AI_PRIMARY_PROVIDER || process.env.AI_PROVIDER || 'deepseek',
    model: process.env.DEEPSEEK_MODEL || '',
    score: 48,
    grade: '二类文',
    originalText: '青年应当如何处理个人选择与时代责任之间的关系？请简要分析。',
    ocrText: 'Public file smoke OCR text'
  }
});

if (!archive.ok || archive.queued) {
  console.log('Public origin reachable=false');
  console.log('Report page=false');
  console.log('PDF download=false');
  console.log('DOCX download=false');
  console.log('Range support=false');
  console.log('Signed URL=false');
  console.log('Expired URL=false');
  console.log('Invalid signature=false');
  console.error('Archive setup failed');
  process.exit(1);
}

const links = await buildArchiveDownloadLinks({ appDir, archiveId, userId: 'public-smoke', env: process.env, client });
const publicStatus = await statusOf(`${origin}/api/public-access`);
const report = await statusOf(links.reportUrl);
const pdf = await statusOf(links.pdfUrl);
const docx = await statusOf(links.docxUrl);
const range = await statusOf(links.pdfUrl, { headers: { Range: 'bytes=0-3' } });
const expiredUrl = createSignedDownloadUrl({ archiveId, fileType: 'pdf', userId: 'public-smoke', expiresInSeconds: -1, env: process.env });
const expired = await statusOf(expiredUrl);
const invalid = await statusOf(`${links.pdfUrl.replace(/token=[^&]+/, 'token=invalid')}`);
const signedOk = noInternal(links.reportUrl) && noInternal(links.pdfUrl) && noInternal(links.docxUrl);

console.log(`Public origin reachable=${publicStatus.status === 200}`);
console.log(`Report page=${report.status === 200}`);
console.log(`PDF download=${pdf.status === 200 && pdf.contentType.includes('application/pdf')}`);
console.log(`DOCX download=${docx.status === 200 && docx.contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')}`);
console.log(`Range support=${range.status === 206 && Boolean(range.contentRange)}`);
console.log(`Signed URL=${signedOk}`);
console.log(`Expired URL=${expired.status}`);
console.log(`Invalid signature=${invalid.status}`);

if (
  publicStatus.status !== 200 ||
  report.status !== 200 ||
  pdf.status !== 200 ||
  docx.status !== 200 ||
  range.status !== 206 ||
  expired.status !== 410 ||
  invalid.status !== 403 ||
  !signedOk
) {
  process.exit(1);
}
