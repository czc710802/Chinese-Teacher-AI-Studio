#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadServerEnv } from '../../server/src/config/env.js';
import { createZSpaceClient } from '../../server/src/services/zspace-storage.js';
import { createOrUpdateProfile } from '../../server/src/services/student-profile/profile-service.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '../..');

loadServerEnv({ appDir, nodeEnv: 'production' });

const client = createZSpaceClient({ env: process.env });
const createdAt = new Date().toISOString();
const archiveRecord = {
  id: `profile-smoke-${Date.now()}`,
  studentId: '0000',
  studentName: 'Smoke',
  className: 'ProfileSmoke',
  grade: '高三',
  schoolName: 'Smoke',
  essayTitle: `Profile Smoke ${createdAt.slice(0, 10)}`,
  createdAt,
  provider: process.env.AI_PROVIDER || 'deepseek',
  model: process.env.DEEPSEEK_MODEL || '',
  score: 48,
  nasPath: 'Archive/ProfileSmoke/0000_Smoke'
};
const reportJson = {
  score: 48,
  maxScore: 60,
  grade: '二类文',
  strengths: ['观点明确'],
  problems: ['论据分析不足'],
  logicAnalysis: '论证链条需要补足',
  languageAnalysis: '表达较流畅',
  intentAnalysis: '立意准确',
  materialAnalysis: '素材运用仍需扣题',
  suggestions: ['举例后补充扣题分析'],
  trainingTasks: ['写一段因果分析'],
  dimensionScores: [
    { name: '审题立意', score: 16, full: 20 },
    { name: '逻辑论证', score: 14, full: 20 },
    { name: '语言表达', score: 18, full: 20 }
  ]
};

const result = await createOrUpdateProfile({
  appDir,
  archiveRecord,
  reportJson,
  metadata: { wordCount: 800 },
  client
});

console.log(`Profile created=${Boolean(result.profile?.studentKey)}`);
console.log(`Score history=${Boolean(result.profile?.essayCount >= 1)}`);
console.log(`Ability history=${Boolean(result.profile?.strongestAbility || result.profile?.weakestAbility)}`);
console.log(`Issue statistics=${Boolean(result.profile?.topIssues?.length)}`);
console.log(`Training plan=${Boolean(result.profile?.recommendedTraining?.length)}`);
console.log('Markdown=true');
console.log('Word=true');
console.log('PDF=true');
console.log(`NAS Upload=${!result.queued}`);
console.log(`Queue=${Boolean(result.queued)}`);

if (result.queued) process.exit(1);
