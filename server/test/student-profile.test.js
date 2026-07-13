import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  resolveStudentKey
} from '../src/services/student-profile/profile-service.js';
import {
  scoreTrendThreshold,
  updateScoreHistory
} from '../src/services/student-profile/score-analyzer.js';
import {
  ABILITY_DIMENSIONS,
  updateAbilityHistory
} from '../src/services/student-profile/ability-analyzer.js';
import {
  normalizeIssue,
  updateIssueStatistics
} from '../src/services/student-profile/issue-normalizer.js';
import {
  generateTrainingPlan
} from '../src/services/student-profile/training-plan-service.js';
import {
  createOrUpdateProfile,
  getStudentProfile,
  listStudentProfiles,
  rebuildStudentProfiles,
  retryPendingProfileUpdates
} from '../src/services/student-profile/profile-service.js';

function tempAppDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'student-profile-'));
}

function archiveRecord(overrides = {}) {
  return {
    id: overrides.id || 'archive-1',
    studentId: overrides.studentId ?? '20260301',
    studentName: overrides.studentName ?? '许伟航',
    className: overrides.className ?? '高二3班',
    grade: overrides.grade ?? '高二',
    schoolName: overrides.schoolName ?? '示范高中',
    essayTitle: overrides.essayTitle || '青年责任',
    createdAt: overrides.createdAt || '2026-07-12T08:00:00.000Z',
    provider: 'deepseek',
    model: 'deepseek-chat',
    score: overrides.score ?? 48,
    gradeText: overrides.gradeText || '二类文',
    nasPath: overrides.nasPath || 'Archive/高二3班/20260301_许伟航/2026/2026-07/青年责任',
    files: overrides.files || []
  };
}

function report(overrides = {}) {
  return {
    score: overrides.score ?? 48,
    maxScore: overrides.maxScore ?? 60,
    grade: overrides.grade || '二类文',
    strengths: ['观点明确'],
    problems: overrides.problems || ['论据分析不足', '材料后面的分析不充分'],
    logicAnalysis: overrides.logicAnalysis || '论证链条需要补足',
    languageAnalysis: overrides.languageAnalysis || '表达较流畅',
    intentAnalysis: overrides.intentAnalysis || '立意准确',
    materialAnalysis: overrides.materialAnalysis || '素材运用仍需扣题',
    suggestions: overrides.suggestions || ['举例后补充扣题分析'],
    trainingTasks: overrides.trainingTasks || ['写一段因果分析'],
    dimensionScores: overrides.dimensionScores || [
      { name: '审题立意', score: 16, full: 20 },
      { name: '逻辑论证', score: 14, full: 20 },
      { name: '语言表达', score: 18, full: 20 }
    ]
  };
}

function mockClient({ fail = false } = {}) {
  const state = { uploads: [], directories: [] };
  return {
    state,
    config: { enabled: true },
    async ensureDirectory(remotePath) {
      state.directories.push(remotePath);
      return { ok: true };
    },
    async uploadBuffer(remotePath, buffer, contentType) {
      if (fail) throw new Error('ETIMEDOUT profile nas');
      state.uploads.push({ remotePath, buffer: Buffer.from(buffer), contentType });
      return { ok: true, remotePath };
    },
    async downloadFile(remotePath) {
      if (remotePath.endsWith('report.json')) return Buffer.from(JSON.stringify(report()));
      if (remotePath.endsWith('metadata.json')) return Buffer.from(JSON.stringify({ wordCount: 800 }));
      throw new Error('not found');
    }
  };
}

test('resolveStudentKey uses studentId first and preserves Chinese safely', () => {
  assert.equal(resolveStudentKey({ studentId: '20260301', studentName: '许伟航', className: '高二3班' }), '20260301_许伟航');
  assert.equal(resolveStudentKey({ studentNo: 'A/01', studentName: '../许伟航', className: '高二3班' }), 'A01_许伟航');
  assert.equal(resolveStudentKey({ studentName: '许伟航', className: '高二3班' }), '高二3班_许伟航');
  assert.match(resolveStudentKey({ studentName: '', className: '' }), /^anonymous_/);
});

test('score history normalizes different max scores and explains trends', () => {
  assert.equal(scoreTrendThreshold, 3);
  const up = updateScoreHistory([
    { archiveId: 'a1', essayTitle: '一', score: 42, maxScore: 60, level: '三类文', createdAt: '2026-07-01' },
    { archiveId: 'a2', essayTitle: '二', score: 46, maxScore: 60, level: '二类文', createdAt: '2026-07-02' }
  ]);
  assert.equal(up.statistics.trend, 'up');
  assert.equal(up.items[0].normalizedScore, 70);

  const down = updateScoreHistory([
    { archiveId: 'a1', score: 50, maxScore: 60, createdAt: '2026-07-01' },
    { archiveId: 'a2', score: 46, maxScore: 60, createdAt: '2026-07-02' }
  ]);
  assert.equal(down.statistics.trend, 'down');

  const stable = updateScoreHistory([
    { archiveId: 'a1', score: 50, maxScore: 60, createdAt: '2026-07-01' },
    { archiveId: 'a2', score: 52, maxScore: 60, createdAt: '2026-07-02' }
  ]);
  assert.equal(stable.statistics.trend, 'stable');
  assert.equal(updateScoreHistory([{ archiveId: 'a1', score: 50, maxScore: 60 }]).statistics.trend, 'insufficient_data');
});

test('ability history keeps missing dimensions as null and never treats null as zero', () => {
  const history = updateAbilityHistory([
    { archiveId: 'a1', createdAt: '2026-07-01', report: report({ dimensionScores: [{ name: '审题立意', score: 15, full: 20 }] }) }
  ]);
  assert.deepEqual(Object.keys(history.dimensions), ABILITY_DIMENSIONS);
  assert.equal(history.dimensions['审题立意'][0].score, 75);
  assert.equal(history.dimensions['逻辑论证'][0].score, null);
  assert.equal(history.statistics.strongestAbility, '审题立意');
  assert.equal(history.statistics.weakestAbility, '审题立意');
});

test('issue normalizer maps equivalent wording to one code', () => {
  assert.equal(normalizeIssue('论据分析不足').code, 'ARGUMENT_ANALYSIS_WEAK');
  assert.equal(normalizeIssue('材料后面的分析不充分').code, 'ARGUMENT_ANALYSIS_WEAK');
  assert.equal(normalizeIssue('举例后缺少扣题分析').code, 'ARGUMENT_ANALYSIS_WEAK');
  const stats = updateIssueStatistics([
    { archiveId: 'a1', createdAt: '2026-07-01', report: report() },
    { archiveId: 'a2', createdAt: '2026-07-02', report: report({ problems: ['结构层次不清'] }) }
  ]);
  assert.equal(stats.issues[0].code, 'ARGUMENT_ANALYSIS_WEAK');
  assert.ok(stats.issues[0].count >= 2);
});

test('training plan uses history, marks insufficient samples, and produces seven days', () => {
  const plan = generateTrainingPlan({
    essayCount: 2,
    topIssues: [{ code: 'ARGUMENT_ANALYSIS_WEAK', label: '论据分析不足', count: 2 }],
    weakestAbilities: ['逻辑论证']
  });
  assert.equal(plan.weeklyPlan.length, 7);
  assert.equal(plan.sampleStatus, 'insufficient_data');
  assert.equal(plan.priority[0].ability, '逻辑论证');
});

test('createOrUpdateProfile is idempotent, writes reports, uploads NAS artifacts, and lists filters', async () => {
  const appDir = tempAppDir();
  const client = mockClient();
  await createOrUpdateProfile({ appDir, archiveRecord: archiveRecord({ id: 'a1', score: 42 }), reportJson: report({ score: 42 }), metadata: { wordCount: 750 }, client });
  await createOrUpdateProfile({ appDir, archiveRecord: archiveRecord({ id: 'a1', score: 42 }), reportJson: report({ score: 42 }), metadata: { wordCount: 750 }, client });
  await createOrUpdateProfile({ appDir, archiveRecord: archiveRecord({ id: 'a2', score: 48, createdAt: '2026-07-15T08:00:00.000Z' }), reportJson: report({ score: 48 }), metadata: { wordCount: 810 }, client });

  const profile = getStudentProfile(appDir, '20260301_许伟航');
  assert.equal(profile.profile.essayCount, 2);
  assert.equal(profile.scoreHistory.statistics.trend, 'up');
  assert.equal(profile.archiveIndex.items.length, 2);
  assert.ok(fs.existsSync(path.join(appDir, 'data/student-profiles/高二3班/20260301_许伟航/profile.json')));
  assert.ok(fs.existsSync(path.join(appDir, 'data/student-profiles/高二3班/20260301_许伟航/reports/2026-07-12-growth-report.docx')));
  assert.ok(client.state.uploads.some((item) => item.remotePath.endsWith('profile.json')));
  assert.equal(listStudentProfiles(appDir, { className: '高二3班', keyword: '许伟航' }).items.length, 1);
});

test('profile NAS failure queues artifacts without throwing away local profile', async () => {
  const appDir = tempAppDir();
  const result = await createOrUpdateProfile({
    appDir,
    archiveRecord: archiveRecord(),
    reportJson: report(),
    client: mockClient({ fail: true })
  });
  const queue = JSON.parse(fs.readFileSync(path.join(appDir, 'data', 'student-profile-queue', 'profile-pending.json'), 'utf8'));
  assert.equal(result.queued, true);
  assert.equal(queue.tasks.length, 1);
  assert.equal(getStudentProfile(appDir, '20260301_许伟航').profile.essayCount, 1);
});

test('retryPendingProfileUpdates syncs queued profile updates once NAS recovers', async () => {
  const appDir = tempAppDir();
  await createOrUpdateProfile({ appDir, archiveRecord: archiveRecord(), reportJson: report(), client: mockClient({ fail: true }) });
  const result = await retryPendingProfileUpdates({ appDir, client: mockClient() });
  assert.equal(result.synced, 1);
  assert.equal(result.pending, 0);
});

test('rebuildStudentProfiles scans archive records, downloads report JSON, skips damaged records, and avoids duplicates', async () => {
  const appDir = tempAppDir();
  fs.mkdirSync(path.join(appDir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(appDir, 'data/archive-records.json'), JSON.stringify({
    version: 1,
    records: [
      archiveRecord({ id: 'a1', files: [{ name: 'report.json', remotePath: 'a1/report.json' }, { name: 'metadata.json', remotePath: 'a1/metadata.json' }] }),
      archiveRecord({ id: 'a1', files: [{ name: 'report.json', remotePath: 'a1/report.json' }] }),
      archiveRecord({ id: 'bad', files: [{ name: 'report.json', remotePath: 'bad/missing.json' }] })
    ]
  }));
  const result = await rebuildStudentProfiles({ appDir, client: mockClient() });
  assert.equal(result.archivesScanned, 3);
  assert.equal(result.rebuilt, 1);
  assert.equal(result.archivesSkipped, 1);
  assert.equal(result.failures, 0);
});
