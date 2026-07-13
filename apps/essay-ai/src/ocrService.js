import fs from 'node:fs';
import path from 'node:path';

import { recognizeImages } from '../../../server/src/services/openai.js';
import { getAIProviderStatus } from '../../../server/src/services/ai/client-factory.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff']);
const TEXT_EXTENSIONS = new Set(['.txt']);
const DOCUMENT_EXTENSIONS = new Set(['.doc', '.docx', '.pdf']);

function getExtension(file) {
  return path.extname(String(file?.filename || file?.originalname || file?.path || '')).toLowerCase();
}

function isImageFile(file) {
  const mimetype = String(file?.mimetype || '').toLowerCase();
  return mimetype.startsWith('image/') || IMAGE_EXTENSIONS.has(getExtension(file));
}

function isTextFile(file) {
  const mimetype = String(file?.mimetype || '').toLowerCase();
  return mimetype.startsWith('text/plain') || TEXT_EXTENSIONS.has(getExtension(file));
}

function isDocumentFile(file) {
  return DOCUMENT_EXTENSIONS.has(getExtension(file));
}

export function isSupportedEssayUploadFile(file) {
  return Boolean(file && (isImageFile(file) || isTextFile(file) || isDocumentFile(file)));
}

function readTextContent(file) {
  if (!file?.path || !fs.existsSync(file.path)) return '';
  return fs.readFileSync(file.path, 'utf8').trim();
}

export async function extractEssayTextFromFiles(files = []) {
  const normalizedFiles = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!normalizedFiles.length) {
    return {
      ok: false,
      text: '',
      message: '请先上传作文图片或文件'
    };
  }

  const textParts = [];
  const imageFiles = [];
  const unsupportedFiles = [];

  for (const file of normalizedFiles) {
    if (isTextFile(file)) {
      const text = readTextContent(file);
      if (text) textParts.push(text);
      continue;
    }
    if (isImageFile(file)) {
      imageFiles.push(file);
      continue;
    }
    if (isDocumentFile(file)) {
      unsupportedFiles.push(file);
      continue;
    }
    unsupportedFiles.push(file);
  }

  if (unsupportedFiles.length) {
    return {
      ok: false,
      text: '',
      message: 'OCR 服务未配置，请先接入 OCR'
    };
  }

  if (imageFiles.length) {
    if (!getAIProviderStatus().configured) {
      return {
        ok: false,
        text: '',
        message: 'OCR 服务未配置，请先接入 OCR'
      };
    }
    const text = String(await recognizeImages(imageFiles) || '').trim();
    if (!text) {
      return {
        ok: false,
        text: '',
        message: 'OCR 识别结果为空，请重新上传更清晰的图片'
      };
    }
    textParts.push(text);
  }

  const mergedText = textParts.join('\n\n').trim();
  if (!mergedText) {
    return {
      ok: false,
      text: '',
      message: 'OCR 服务未配置，请先接入 OCR'
    };
  }

  return {
    ok: true,
    text: mergedText,
    message: '识别成功'
  };
}
