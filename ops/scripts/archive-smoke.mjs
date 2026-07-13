#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadServerEnv } from '../../server/src/config/env.js';
import { createZSpaceClient } from '../../server/src/services/zspace-storage.js';
import { archiveSyntheticPayload } from '../../server/src/services/archive-pipeline.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '../..');

loadServerEnv({ appDir, nodeEnv: 'production' });

const client = createZSpaceClient({ env: process.env });
const checkedAt = new Date().toISOString();
const payload = {
  id: `archive-smoke-${Date.now()}`,
  className: 'ArchiveSmoke',
  studentNo: '0000',
  studentName: 'Smoke',
  essayTitle: `Smoke-${checkedAt.slice(0, 10)}`,
  createdAt: checkedAt,
  provider: process.env.AI_PRIMARY_PROVIDER || process.env.AI_PROVIDER || 'deepseek',
  model: process.env.DEEPSEEK_MODEL || '',
  score: 48,
  grade: '二类文',
  originalText: '青年应当如何处理个人选择与时代责任之间的关系？请简要分析。',
  ocrText: 'Smoke OCR text'
};

const result = await archiveSyntheticPayload({ appDir, client, payload });

console.log(`Archive connected=${Boolean(result.ok && !result.queued)}`);
console.log(`JSON=${Boolean(result.checks?.json)}`);
console.log(`Markdown=${Boolean(result.checks?.markdown)}`);
console.log(`Word=${Boolean(result.checks?.word)}`);
console.log(`PDF=${Boolean(result.checks?.pdf)}`);
console.log(`Metadata=${Boolean(result.checks?.metadata)}`);
console.log(`NAS Upload=${Boolean(result.checks?.nasUpload)}`);
console.log(`Queue=${Boolean(result.queued)}`);

if (!result.ok || result.queued) {
  console.error(result.error || 'Archive smoke failed');
  process.exit(1);
}
