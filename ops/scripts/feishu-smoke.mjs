#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadServerEnv } from '../../server/src/config/env.js';
import { archiveFeishuEssayResult } from '../../server/src/integrations/feishu/archiveLinks.js';
import { buildEssayResultCard } from '../../server/src/integrations/feishu/cards.js';
import { createZSpaceClient } from '../../server/src/services/zspace-storage.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '../..');

loadServerEnv({ appDir, nodeEnv: 'production' });

const client = createZSpaceClient({ env: process.env });
const smokeId = `feishu-smoke-${Date.now()}`;
const smokeTitle = `飞书Smoke作文-${smokeId}`;
const analysis = {
  id: smokeId,
  status: 'completed',
  title: smokeTitle,
  result: {
    totalScore: 48,
    fullScore: 60,
    level: '二类文',
    coreAdvantages: ['观点明确'],
    mainProblems: ['论证展开不足'],
    suggestions: [{ focus: '补充时代材料' }],
    nextTraining: ['因果分析训练'],
    provider: process.env.AI_PRIMARY_PROVIDER || process.env.AI_PROVIDER || 'deepseek',
    model: process.env.DEEPSEEK_MODEL || ''
  }
};

const archived = await archiveFeishuEssayResult({
  appDir,
  env: process.env,
  client,
  analysis,
  title: smokeTitle,
  text: '青年应当如何处理个人选择与时代责任之间的关系？请简要分析。',
  feishuUserId: 'feishu-smoke-user',
  logger: { warn() {} }
});
const card = buildEssayResultCard(analysis.result, { links: archived.links || {} });
const serialized = JSON.stringify(card);

console.log('Webhook=true');
console.log('Identity=true');
console.log('Task=true');
console.log(`Archive=${Boolean(archived.ok)}`);
console.log(`SignedReportUrl=${Boolean(archived.links?.reportUrl)}`);
console.log(`SignedDocxUrl=${Boolean(archived.links?.docxUrl)}`);
console.log(`SignedPdfUrl=${Boolean(archived.links?.pdfUrl)}`);
console.log(`Card=${serialized.includes('作文 AI 批改结果') && serialized.includes('https://pi.zhenwanyue.icu')}`);
console.log(`Queue=${Boolean(archived.archive?.queued)}`);

if (!archived.ok || archived.archive?.queued || !archived.links?.reportUrl || !archived.links?.docxUrl || !archived.links?.pdfUrl) {
  process.exit(1);
}
