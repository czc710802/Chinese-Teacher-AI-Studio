import fs from 'node:fs';
import path from 'node:path';
import { createZSpaceClient, sanitizePathSegment } from '../zspace-storage.js';
import { sectionsToDocxBuffer, sectionsToPdfBuffer } from '../exporter.js';
import { updateScoreHistory } from './score-analyzer.js';
import { updateAbilityHistory } from './ability-analyzer.js';
import { updateIssueStatistics } from './issue-normalizer.js';
import { generateTrainingPlan } from './training-plan-service.js';
import {
  PROFILE_VERSION,
  atomicWriteJson,
  atomicWriteText,
  profileLocalDir,
  profileRemoteBase,
  profileRoot,
  readJsonFile,
  uploadProfileDirectory
} from './profile-storage.js';
import { retryPendingProfileUpdates as retryQueue } from './profile-queue.js';

function logProfile(appDir, event, details = {}) {
  const file = path.join(appDir, 'logs', 'student-profile.log');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const safeDetails = { ...details };
  if (safeDetails.error) safeDetails.error = String(safeDetails.error?.message || safeDetails.error).slice(0, 300);
  fs.appendFileSync(file, `${JSON.stringify({ time: new Date().toISOString(), event, ...safeDetails })}\n`, 'utf8');
}

export function resolveStudentKey(record = {}) {
  const studentName = sanitizePathSegment(record.studentName || record.name || '', '');
  const id = sanitizePathSegment(record.studentId || '', '');
  const no = sanitizePathSegment(record.studentNo || record.student_no || '', '');
  const className = sanitizePathSegment(record.className || '', '');
  if (id) return sanitizePathSegment(`${id}_${studentName || '未填写'}`);
  if (no) return sanitizePathSegment(`${no}_${studentName || '未填写'}`);
  if (className && studentName) return sanitizePathSegment(`${className}_${studentName}`);
  return `anonymous_${Math.abs(JSON.stringify(record || {}).split('').reduce((sum, ch) => ((sum * 31) + ch.charCodeAt(0)) | 0, 7)).toString(16)}`;
}

function dateOnly(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function archiveIndexPath(localDir) {
  return path.join(localDir, 'archive-index.json');
}

function readExistingIndex(localDir) {
  return readJsonFile(archiveIndexPath(localDir), { items: [] });
}

function normalizeArchiveEntry(archiveRecord, reportJson = {}, metadata = {}) {
  return {
    archiveId: archiveRecord.id,
    essayId: archiveRecord.essayId || '',
    essayTitle: archiveRecord.essayTitle || metadata.essayTitle || '',
    className: archiveRecord.className || metadata.className || '',
    studentId: archiveRecord.studentId || metadata.studentId || '',
    studentName: archiveRecord.studentName || metadata.studentName || '',
    grade: archiveRecord.grade || metadata.grade || '',
    schoolName: archiveRecord.schoolName || metadata.schoolName || '',
    createdAt: archiveRecord.createdAt || metadata.createdAt || '',
    nasPath: archiveRecord.nasPath || metadata.nasPath || '',
    provider: archiveRecord.provider || metadata.provider || '',
    model: archiveRecord.model || metadata.model || '',
    score: reportJson.score ?? archiveRecord.score ?? metadata.score ?? null,
    maxScore: reportJson.maxScore || archiveRecord.maxScore || metadata.maxScore || 60,
    level: reportJson.level || reportJson.grade || archiveRecord.level || archiveRecord.gradeText || metadata.grade || '',
    wordCount: metadata.wordCount || archiveRecord.wordCount || 0,
    report: reportJson
  };
}

function buildProfile({ studentKey, className, entries, scoreHistory, abilityHistory, issueStatistics, trainingPlan }) {
  const first = entries[0] || {};
  const latest = entries.at(-1) || {};
  return {
    studentKey,
    studentId: first.studentId || '',
    studentName: first.studentName || '',
    className,
    grade: first.grade || '',
    schoolName: first.schoolName || '',
    essayCount: entries.length,
    firstEssayAt: first.createdAt || '',
    latestEssayAt: latest.createdAt || '',
    averageScore: scoreHistory.statistics.average,
    highestScore: scoreHistory.statistics.highest,
    lowestScore: scoreHistory.statistics.lowest,
    latestScore: scoreHistory.statistics.latest,
    scoreTrend: scoreHistory.statistics.trend,
    currentLevel: latest.level || '',
    strongestAbility: abilityHistory.statistics.strongestAbility || '',
    weakestAbility: abilityHistory.statistics.weakestAbility || '',
    topIssues: issueStatistics.issues.slice(0, 5),
    recommendedTraining: trainingPlan.priority,
    lastUpdatedAt: new Date().toISOString(),
    profileVersion: PROFILE_VERSION
  };
}

export function generateProfileSummary({ profile, scoreHistory, abilityHistory, issueStatistics, trainingPlan }) {
  const scoreItems = scoreHistory.items.map((item) => `- ${item.createdAt || ''} ${item.essayTitle || ''}：${item.score}/${item.maxScore}（${item.level || '未评级'}）`).join('\n') || '- 样本不足';
  const ability = abilityHistory.statistics.averages.map((item) => `- ${item.dimension}：${item.average}`).join('\n') || '- 样本不足';
  const issues = issueStatistics.issues.slice(0, 6).map((item) => `- ${item.label}：${item.count} 次`).join('\n') || '- 暂无高频问题';
  const plan = trainingPlan.weeklyPlan.map((item) => `- 第${item.day}天 ${item.title}：${item.task}`).join('\n');
  return `# 学生成长档案

## 基本信息

- 学生：${profile.studentName || '未填写'}
- 学号：${profile.studentId || '未填写'}
- 班级：${profile.className || '未填写'}
- 作文数量：${profile.essayCount}

## 作文总体情况

平均分 ${profile.averageScore}，最高分 ${profile.highestScore}，最低分 ${profile.lowestScore}，最近得分 ${profile.latestScore}。

## 分数变化

趋势：${profile.scoreTrend}

${scoreItems}

## 能力变化

${ability}

## 稳定优势

${profile.strongestAbility || '样本不足'}

## 高频问题

${issues}

## 最近进步

${scoreHistory.statistics.change > 0 ? `最近一次提升 ${scoreHistory.statistics.change} 分。` : '继续观察后续作文表现。'}

## 当前短板

${profile.weakestAbility || '样本不足'}

## 7天训练计划

${plan}

## 教师关注建议

优先关注 ${profile.weakestAbility || '逻辑论证'} 与 ${profile.topIssues[0]?.label || '论证展开'}，用短周期修改任务跟踪变化。
`;
}

function summarySections(markdown) {
  return markdown.split(/\n## /).map((block, index) => {
    if (index === 0) return { title: '学生成长档案', content: block.replace(/^# 学生成长档案/, '').trim() || ' ' };
    const [title, ...rest] = block.split('\n');
    return { title: title.trim(), content: rest.join('\n').trim() || ' ' };
  });
}

async function writeProfileArtifacts(localDir, data, reportDate) {
  const reportsDir = path.join(localDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  atomicWriteJson(path.join(localDir, 'profile.json'), data.profile);
  atomicWriteJson(path.join(localDir, 'latest-report.json'), data.latestReport);
  atomicWriteJson(path.join(localDir, 'score-history.json'), data.scoreHistory);
  atomicWriteJson(path.join(localDir, 'ability-history.json'), data.abilityHistory);
  atomicWriteJson(path.join(localDir, 'issue-statistics.json'), data.issueStatistics);
  atomicWriteJson(path.join(localDir, 'training-plan.json'), data.trainingPlan);
  atomicWriteJson(path.join(localDir, 'archive-index.json'), data.archiveIndex);
  atomicWriteText(path.join(localDir, 'summary.md'), data.summaryMarkdown);
  const base = `${reportDate}-growth-report`;
  atomicWriteText(path.join(reportsDir, `${base}.md`), data.summaryMarkdown);
  fs.writeFileSync(path.join(reportsDir, `${base}.docx`), await sectionsToDocxBuffer('学生成长档案', summarySections(data.summaryMarkdown)));
  fs.writeFileSync(path.join(reportsDir, `${base}.pdf`), await sectionsToPdfBuffer('学生成长档案', summarySections(data.summaryMarkdown)));
}

export async function createOrUpdateProfile({ appDir = process.cwd(), archiveRecord, reportJson = {}, metadata = {}, client, logger = console } = {}) {
  const studentKey = resolveStudentKey({ ...archiveRecord, ...metadata });
  const className = sanitizePathSegment(archiveRecord.className || metadata.className || '未填写');
  const localDir = profileLocalDir(appDir, className, studentKey);
  const archiveIndex = readExistingIndex(localDir);
  const entry = normalizeArchiveEntry(archiveRecord, reportJson, metadata);
  const existingIndex = archiveIndex.items.findIndex((item) => item.archiveId === entry.archiveId);
  if (existingIndex >= 0) archiveIndex.items[existingIndex] = entry;
  else archiveIndex.items.push(entry);
  archiveIndex.items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  const scoreHistory = updateScoreHistory(archiveIndex.items.map((item) => ({
    archiveId: item.archiveId,
    essayTitle: item.essayTitle,
    score: item.score,
    maxScore: item.maxScore,
    level: item.level,
    createdAt: item.createdAt
  })));
  const abilityHistory = updateAbilityHistory(archiveIndex.items.map((item) => ({ archiveId: item.archiveId, createdAt: item.createdAt, report: item.report })));
  const issueStatistics = updateIssueStatistics(archiveIndex.items.map((item) => ({ archiveId: item.archiveId, createdAt: item.createdAt, report: item.report })));
  const trainingPlan = generateTrainingPlan({
    essayCount: archiveIndex.items.length,
    topIssues: issueStatistics.issues.slice(0, 5),
    weakestAbilities: [abilityHistory.statistics.weakestAbility].filter(Boolean)
  });
  const profile = buildProfile({ studentKey, className, entries: archiveIndex.items, scoreHistory, abilityHistory, issueStatistics, trainingPlan });
  const summaryMarkdown = generateProfileSummary({ profile, scoreHistory, abilityHistory, issueStatistics, trainingPlan });
  const latestReport = { generatedAt: new Date().toISOString(), profile, scoreHistory, abilityHistory, issueStatistics, trainingPlan };
  const data = { profile, latestReport, scoreHistory, abilityHistory, issueStatistics, trainingPlan, archiveIndex, summaryMarkdown };
  const reportDate = dateOnly(entry.createdAt);

  logProfile(appDir, 'profile update started', { studentKey, archiveId: entry.archiveId });
  await writeProfileArtifacts(localDir, data, reportDate);
  const upload = await uploadProfileDirectory({ appDir, client, archiveId: entry.archiveId, studentKey, className, localDir, logger });
  logProfile(appDir, upload.queued ? 'profile update queued' : 'profile update completed', { studentKey, archiveId: entry.archiveId, queued: Boolean(upload.queued) });
  return { studentKey, className, localDir, remoteBase: profileRemoteBase(className, studentKey), profile, queued: Boolean(upload.queued), upload };
}

export function getStudentProfile(appDir = process.cwd(), studentKey) {
  const root = profileRoot(appDir);
  if (!fs.existsSync(root)) return null;
  for (const className of fs.readdirSync(root)) {
    const localDir = path.join(root, className, sanitizePathSegment(studentKey));
    if (!fs.existsSync(localDir)) continue;
    return {
      profile: readJsonFile(path.join(localDir, 'profile.json'), null),
      scoreHistory: readJsonFile(path.join(localDir, 'score-history.json'), { items: [], statistics: {} }),
      abilityHistory: readJsonFile(path.join(localDir, 'ability-history.json'), { dimensions: {}, statistics: {} }),
      issueStatistics: readJsonFile(path.join(localDir, 'issue-statistics.json'), { issues: [] }),
      trainingPlan: readJsonFile(path.join(localDir, 'training-plan.json'), { weeklyPlan: [] }),
      archiveIndex: readJsonFile(path.join(localDir, 'archive-index.json'), { items: [] }),
      summaryMarkdown: fs.existsSync(path.join(localDir, 'summary.md')) ? fs.readFileSync(path.join(localDir, 'summary.md'), 'utf8') : ''
    };
  }
  return null;
}

export function listStudentProfiles(appDir = process.cwd(), filters = {}) {
  const root = profileRoot(appDir);
  const rows = [];
  if (fs.existsSync(root)) {
    for (const className of fs.readdirSync(root)) {
      const classDir = path.join(root, className);
      if (!fs.statSync(classDir).isDirectory()) continue;
      for (const studentKey of fs.readdirSync(classDir)) {
        const profile = readJsonFile(path.join(classDir, studentKey, 'profile.json'), null);
        if (profile) rows.push(profile);
      }
    }
  }
  let items = rows;
  if (filters.className) items = items.filter((item) => item.className === filters.className);
  if (filters.grade) items = items.filter((item) => item.grade === filters.grade);
  if (filters.trend) items = items.filter((item) => item.scoreTrend === filters.trend);
  if (filters.keyword) items = items.filter((item) => `${item.studentKey}${item.studentName}${item.studentId}${item.className}`.includes(filters.keyword));
  const sortBy = filters.sortBy || 'lastUpdatedAt';
  const sortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc';
  items = [...items].sort((a, b) => {
    const result = String(a[sortBy] || '').localeCompare(String(b[sortBy] || ''), 'zh-CN');
    return sortOrder === 'asc' ? result : -result;
  });
  const page = Math.max(1, Number(filters.page || 1));
  const pageSize = Math.min(100, Math.max(1, Number(filters.pageSize || 20)));
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}

async function readArchiveJson(client, record, fileName) {
  const file = (record.files || []).find((item) => item.name === fileName || item.remotePath?.endsWith(`/${fileName}`));
  if (!file) return {};
  const buffer = await client.downloadFile(file.remotePath);
  return JSON.parse(buffer.toString('utf8'));
}

export async function rebuildStudentProfiles({ appDir = process.cwd(), client, logger = console } = {}) {
  const archivePath = path.join(appDir, 'data', 'archive-records.json');
  const archiveStore = readJsonFile(archivePath, { records: [] });
  const seen = new Set();
  let rebuilt = 0;
  let archivesSkipped = 0;
  let failures = 0;
  logProfile(appDir, 'rebuild started', { archives: archiveStore.records.length });
  for (const record of archiveStore.records || []) {
    if (!record?.id || seen.has(record.id)) continue;
    seen.add(record.id);
    try {
      const reportJson = record.reportJson || await readArchiveJson(client, record, 'report.json');
      const metadata = record.metadata || await readArchiveJson(client, record, 'metadata.json').catch(() => ({}));
      if (!reportJson || !Object.keys(reportJson).length) {
        archivesSkipped += 1;
        continue;
      }
      await createOrUpdateProfile({ appDir, archiveRecord: record, reportJson, metadata, client, logger });
      rebuilt += 1;
    } catch (error) {
      archivesSkipped += 1;
      logger.warn?.('学生档案重建跳过损坏归档', { archiveId: record?.id, message: String(error?.message || error).slice(0, 200) });
    }
  }
  logProfile(appDir, 'rebuild completed', { rebuilt, archivesScanned: archiveStore.records.length, archivesSkipped, failures });
  return { rebuilt, archivesScanned: archiveStore.records.length, archivesSkipped, failures };
}

export async function retryPendingProfileUpdates({ appDir = process.cwd(), client, logger = console } = {}) {
  return retryQueue({ appDir, client, logger });
}

export function updateStudentGrowthProfileAsync({ appDir, archiveRecord, reportJson, metadata, client, logger = console } = {}) {
  setImmediate(() => {
    createOrUpdateProfile({ appDir, archiveRecord, reportJson, metadata, client, logger }).catch((error) => {
      logger.warn?.('学生成长档案后台更新失败，已忽略以保护作文归档主流程', { message: String(error?.message || error).slice(0, 200) });
    });
  });
}

export async function rebuildStudentProfile({ appDir = process.cwd(), studentKey, client, logger = console } = {}) {
  const archivePath = path.join(appDir, 'data', 'archive-records.json');
  const archiveStore = readJsonFile(archivePath, { records: [] });
  let count = 0;
  for (const record of archiveStore.records || []) {
    if (resolveStudentKey(record) !== studentKey) continue;
    const reportJson = record.reportJson || await readArchiveJson(client, record, 'report.json');
    const metadata = record.metadata || await readArchiveJson(client, record, 'metadata.json').catch(() => ({}));
    await createOrUpdateProfile({ appDir, archiveRecord: record, reportJson, metadata, client, logger });
    count += 1;
  }
  return { rebuilt: count, studentKey };
}

export function createDefaultProfileClient(env = process.env) {
  return createZSpaceClient({ env });
}
