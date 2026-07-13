import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { saveEssayRecord, findEssayRecord, listEssayRecords, updateEssayRecord, ensureEssayAiDirs } from './storageService.js';
import { extractEssayTextFromFiles, isSupportedEssayUploadFile } from './ocrService.js';
import { gradeEssay } from './gradingService.js';
import { buildEssayReportMarkdown, summarizeEssayRecord } from './reportService.js';
import { recordEssayAiArtifact } from '../../../server/src/services/storage-artifacts.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeFiles(files = []) {
  return (Array.isArray(files) ? files : [])
    .filter(Boolean)
    .map((file) => ({
      fieldname: file.fieldname || 'files',
      filename: file.originalname || file.filename || path.basename(file.path || ''),
      path: file.path || '',
      mimetype: file.mimetype || '',
      size: file.size || 0,
      publicPath: file.path ? `/uploads/essay-ai/${path.basename(file.path)}` : ''
    }))
    .filter((file) => file.path);
}

function buildRecord({ id, title, source, status, text, files, result, message, ocr }) {
  const createdAt = new Date().toISOString();
  return {
    id,
    title,
    source,
    status,
    createdAt,
    updatedAt: createdAt,
    text,
    textLength: text.length,
    files,
    result: result || null,
    message: message || '',
    ocr: ocr || null,
    reportMarkdown: result ? buildEssayReportMarkdown({ id, title, source, status, createdAt, result }) : ''
  };
}

export async function analyzeEssay({
  appDir = path.resolve(process.cwd()),
  title = '',
  text = '',
  source = 'api',
  files = [],
  storageService,
  logger = console
} = {}) {
  ensureEssayAiDirs(appDir);
  const id = randomUUID();
  const normalizedTitle = normalizeText(title) || '未命名作文';
  const normalizedFiles = normalizeFiles(files);
  let essayText = normalizeText(text);
  let ocr = null;

  if (!essayText && normalizedFiles.length) {
    ocr = await extractEssayTextFromFiles(normalizedFiles);
    essayText = normalizeText(ocr.text);
  }

  if (!essayText) {
    const record = buildRecord({
      id,
      title: normalizedTitle,
      source,
      status: 'pending_ocr',
      text: '',
      files: normalizedFiles,
      result: null,
      message: ocr?.message || 'OCR 服务未配置，请先接入 OCR',
      ocr
    });
    saveEssayRecord(appDir, record);
    await recordEssayAiArtifact({ storageService, record, files, logger });
    return {
      ok: true,
      id: record.id,
      taskId: record.id,
      status: record.status,
      title: record.title,
      source: record.source,
      message: record.message,
      files: record.files,
      ocr: record.ocr,
      result: null
    };
  }

  const result = await gradeEssay({ title: normalizedTitle, text: essayText, fullScore: 60 });
  const record = buildRecord({
    id,
    title: normalizedTitle,
    source,
    status: 'completed',
    text: essayText,
    files: normalizedFiles,
    result,
    message: '批改完成',
    ocr
  });
  saveEssayRecord(appDir, record);
  await recordEssayAiArtifact({ storageService, record, files, logger });

  return {
    ok: true,
    id: record.id,
    taskId: record.id,
    status: record.status,
    title: record.title,
    source: record.source,
    message: record.message,
    textLength: record.textLength,
    files: record.files,
    ocr: record.ocr,
    result: record.result,
    reportMarkdown: record.reportMarkdown
  };
}

export async function uploadEssayFiles(options = {}) {
  return analyzeEssay({
    ...options,
    source: options.source || 'upload'
  });
}

export function getEssayResult({ appDir = path.resolve(process.cwd()), id } = {}) {
  const record = findEssayRecord(appDir, id);
  if (!record) return null;
  return {
    ok: true,
    ...record,
    summary: summarizeEssayRecord(record)
  };
}

export function listEssayHistory({ appDir = path.resolve(process.cwd()), limit = 20 } = {}) {
  const items = listEssayRecords(appDir, limit).map((record) => summarizeEssayRecord(record));
  return {
    ok: true,
    items
  };
}

export function downloadEssayReport({ appDir = path.resolve(process.cwd()), id, format = 'md' } = {}) {
  const record = findEssayRecord(appDir, id);
  if (!record) {
    return {
      ok: false,
      statusCode: 404,
      body: { ok: false, message: '批改记录不存在' }
    };
  }

  if (format === 'word' || format === 'pdf') {
    return {
      ok: true,
      statusCode: 200,
      body: {
        ok: true,
        id: record.id,
        format,
        message: 'V11.3 接入'
      }
    };
  }

  return {
    ok: true,
    statusCode: 200,
    body: buildEssayReportMarkdown(record),
    contentType: 'text/markdown; charset=utf-8',
    filename: `essay-${record.id}.md`
  };
}

export function isEssayUploadFileAllowed(file) {
  return isSupportedEssayUploadFile(file);
}
