import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sectionsToDocxBuffer, sectionsToPdfBuffer } from '../exporter.js';
import { listStudentProfiles, resolveStudentKey } from '../student-profile/profile-service.js';
import { sanitizePathSegment } from '../zspace-storage.js';

export const TEACHER_MANAGEMENT_VERSION = '1.0';
export const teacherStatsConfig = {
  excellentNormalizedScore: 85,
  passingNormalizedScore: 60
};

function safeErrorMessage(error) {
  return String(error?.message || error || '未知错误')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
    .replace(/Basic\s+[A-Za-z0-9+/=]+/g, 'Basic ***')
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***')
    .replace(/password=[^&\s]+/gi, 'password=***')
    .slice(0, 500);
}

function dataDir(appDir) {
  return path.join(appDir, 'data', 'teacher-management');
}

function storePath(appDir, name) {
  return path.join(dataDir(appDir), `${name}.json`);
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

function readStore(appDir, name) {
  return readJson(storePath(appDir, name), { version: TEACHER_MANAGEMENT_VERSION, items: [] });
}

function writeStore(appDir, name, items) {
  writeJson(storePath(appDir, name), { version: TEACHER_MANAGEMENT_VERSION, items });
}

function archiveStore(appDir) {
  return readJson(path.join(appDir, 'data', 'archive-records.json'), { records: [] });
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeScore(score, maxScore = 60) {
  const value = asNumber(score);
  const max = asNumber(maxScore) || 60;
  if (value == null || max <= 0) return null;
  return Number(((value / max) * 100).toFixed(2));
}

function pageRows(rows, filters = {}) {
  const page = Math.max(1, Number(filters.page || 1));
  const pageSize = Math.min(200, Math.max(1, Number(filters.pageSize || 50)));
  return { items: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
}

function isTrue(value) {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on', 'system_test'].includes(text);
}

function sortRows(rows, filters = {}, fallback = 'updatedAt') {
  const sortBy = filters.sortBy || fallback;
  const sortOrder = filters.sortOrder === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sortBy] ?? '';
    const bv = b[sortBy] ?? '';
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortOrder;
    return String(av).localeCompare(String(bv), 'zh-CN') * sortOrder;
  });
}

function currentYear() {
  return String(new Date().getFullYear());
}

function yearFromDate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? currentYear() : String(date.getFullYear());
}

function normalizeGrade(value) {
  const grade = String(value || '').trim();
  if (!grade) return '未填写';
  if (/类文|优秀|良好|合格|不合格|等级|一类|二类|三类|四类|五类/.test(grade)) return '未填写';
  return grade;
}

export function generateClassKey({ schoolYear, grade, className } = {}) {
  const parts = [
    sanitizePathSegment(schoolYear || currentYear(), '未填写'),
    sanitizePathSegment(normalizeGrade(grade), '未填写'),
    sanitizePathSegment(className || '未填写', '未填写')
  ];
  return parts.join('_');
}

function ensureAuditFile(appDir) {
  const file = path.join(appDir, 'logs', 'audit.log');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

export function writeAuditLog(appDir, event = {}) {
  const safeDetails = { ...(event.details || {}) };
  for (const key of Object.keys(safeDetails)) {
    if (/authorization|cookie|token|password|api.?key/i.test(key)) delete safeDetails[key];
  }
  const line = {
    actorId: String(event.actorId || 'system'),
    actorRole: event.actorRole || 'system',
    action: event.action || 'unknown',
    targetType: event.targetType || '',
    targetId: String(event.targetId || ''),
    timestamp: new Date().toISOString(),
    result: event.result || 'success',
    requestId: event.requestId || randomUUID(),
    details: safeDetails
  };
  fs.appendFileSync(ensureAuditFile(appDir), `${JSON.stringify(line)}\n`, 'utf8');
  return line;
}

function buildClassFromRecord(record) {
  const schoolYear = String(record.schoolYear || yearFromDate(record.createdAt));
  const grade = normalizeGrade(record.classGrade || record.studentGrade || record.grade);
  const className = String(record.className || '未填写');
  const classKey = generateClassKey({ schoolYear, grade, className });
  return {
    classKey,
    className,
    grade,
    schoolYear,
    teacherId: record.teacherId || '',
    teacherName: record.teacherName || '',
    schoolName: record.schoolName || '',
    studentCount: 0,
    essayCount: 0,
    averageScore: null,
    excellentRate: null,
    passingRate: null,
    latestSubmittedAt: '',
    feishuChatId: record.feishuChatId || '',
    status: record.status || 'active',
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function classFromProfile(profile) {
  return buildClassFromRecord({
    className: profile.className || '未填写',
    grade: normalizeGrade(profile.grade),
    schoolYear: profile.schoolYear || yearFromDate(profile.latestEssayAt || profile.firstEssayAt),
    schoolName: profile.schoolName || ''
  });
}

function studentFromProfile(profile, classKey) {
  return {
    studentKey: profile.studentKey,
    studentId: profile.studentId || '',
    studentName: profile.studentName || '',
    classKey,
    className: profile.className || '',
    grade: normalizeGrade(profile.grade),
    schoolYear: classKey.split('_')[0] || currentYear(),
    gender: profile.gender || '',
    status: profile.status || 'active',
    essayCount: profile.essayCount || 0,
    averageScore: profile.averageScore ?? null,
    latestScore: profile.latestScore ?? null,
    scoreTrend: profile.scoreTrend || '',
    weakestAbility: profile.weakestAbility || '',
    latestEssayAt: profile.latestEssayAt || '',
    profileUpdatedAt: profile.lastUpdatedAt || '',
    feishuUserId: profile.feishuUserId || '',
    createdAt: profile.firstEssayAt || new Date().toISOString(),
    updatedAt: profile.lastUpdatedAt || new Date().toISOString(),
    transferHistory: []
  };
}

function essayFromArchive(record, classKey) {
  const maxScore = record.maxScore || record.fullScore || 60;
  const studentKey = resolveStudentKey(record);
  const downloadFiles = Array.isArray(record.files) && record.files.length
    ? record.files
    : ['report.md', 'report.docx', 'report.pdf'].map((name) => ({
        name,
        remotePath: record.nasPath ? `${record.nasPath}/${name}` : '',
        contentType: name.endsWith('.pdf')
          ? 'application/pdf'
          : name.endsWith('.docx')
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'text/markdown; charset=utf-8'
      })).filter((item) => item.remotePath);
  return {
    archiveId: record.id,
    essayId: record.essayId || '',
    classKey,
    studentKey,
    studentId: record.studentId || '',
    studentName: record.studentName || '',
    className: record.className || '',
    grade: normalizeGrade(record.classGrade || record.studentGrade || record.grade),
    essayTitle: record.essayTitle || '',
    score: record.score ?? null,
    maxScore,
    normalizedScore: normalizeScore(record.score, maxScore),
    level: record.level || record.gradeText || record.grade || '',
    provider: record.provider || 'deepseek',
    model: record.model || '',
    gradingStatus: record.archiveStatus === 'archived' ? 'graded' : 'pending',
    nasArchiveStatus: record.archiveStatus || 'unknown',
    profileStatus: 'pending',
    nasPath: record.nasPath || '',
    latestSyncedAt: record.archivedAt || record.updatedAt || '',
    queueStatus: record.archiveStatus === 'queued' ? 'queued' : 'synced',
    submittedAt: record.createdAt || '',
    wordCount: record.wordCount || 0,
    downloadFiles,
    teacherReviewed: false,
    teacherCommentCount: 0,
    source: record.source || 'archive',
    feishuSource: record.feishuSource || ''
  };
}

function mergeClassStats(classes, students, essays) {
  const byClass = new Map(classes.map((item) => [item.classKey, { ...item }]));
  for (const klass of byClass.values()) {
    const classStudents = students.filter((item) => item.classKey === klass.classKey && item.status !== 'archived');
    const classEssays = essays.filter((item) => item.classKey === klass.classKey);
    const scores = classEssays.map((item) => asNumber(item.score)).filter((value) => value != null);
    const normalized = classEssays.map((item) => item.normalizedScore).filter((value) => value != null);
    klass.studentCount = classStudents.length;
    klass.essayCount = classEssays.length;
    klass.averageScore = scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null;
    klass.excellentRate = normalized.length ? Number((normalized.filter((value) => value >= teacherStatsConfig.excellentNormalizedScore).length / normalized.length).toFixed(2)) : null;
    klass.passingRate = normalized.length ? Number((normalized.filter((value) => value >= teacherStatsConfig.passingNormalizedScore).length / normalized.length).toFixed(2)) : null;
    klass.latestSubmittedAt = classEssays.map((item) => item.submittedAt).filter(Boolean).sort().at(-1) || klass.latestSubmittedAt || '';
    klass.updatedAt = new Date().toISOString();
  }
  return [...byClass.values()];
}

function upsertByKey(items, key, item) {
  const index = items.findIndex((row) => row[key] === item[key]);
  if (index >= 0) items[index] = { ...items[index], ...item, updatedAt: new Date().toISOString() };
  else items.push(item);
  return items;
}

export async function rebuildTeacherManagement({ appDir = process.cwd(), logger = console } = {}) {
  const archiveRecords = archiveStore(appDir).records || [];
  const profileRows = listStudentProfiles(appDir, { pageSize: 10000 }).items || [];
  const classes = new Map();
  const students = new Map();
  const essays = [];
  let recordsSkipped = 0;
  const seenEssays = new Set();

  try {
    for (const profile of profileRows) {
      if (!profile?.studentKey) continue;
      const klass = classFromProfile(profile);
      classes.set(klass.classKey, { ...(classes.get(klass.classKey) || klass), ...klass });
      students.set(profile.studentKey, studentFromProfile(profile, klass.classKey));
    }

    for (const record of archiveRecords) {
      if (!record?.id || seenEssays.has(record.id)) continue;
      seenEssays.add(record.id);
      try {
        const klass = buildClassFromRecord(record);
        classes.set(klass.classKey, { ...(classes.get(klass.classKey) || klass), ...klass });
        const studentKey = resolveStudentKey(record);
        if (!students.has(studentKey)) {
          students.set(studentKey, {
            studentKey,
            studentId: record.studentId || '',
            studentName: record.studentName || '',
            classKey: klass.classKey,
            className: record.className || '',
            grade: normalizeGrade(record.classGrade || record.studentGrade || record.grade),
            schoolYear: klass.schoolYear,
            gender: '',
            status: 'active',
            essayCount: 0,
            averageScore: null,
            latestScore: null,
            scoreTrend: '',
            weakestAbility: '',
            latestEssayAt: '',
            profileUpdatedAt: '',
            feishuUserId: '',
            createdAt: record.createdAt || new Date().toISOString(),
            updatedAt: record.updatedAt || new Date().toISOString(),
            transferHistory: []
          });
        }
        essays.push(essayFromArchive(record, klass.classKey));
      } catch (error) {
        recordsSkipped += 1;
        logger.warn?.('教师管理重建跳过损坏记录', { archiveId: record?.id, message: safeErrorMessage(error) });
      }
    }

    const commentStore = readStore(appDir, 'teacher-comments').items;
    const commentCounts = new Map();
    for (const comment of commentStore) commentCounts.set(comment.archiveId, (commentCounts.get(comment.archiveId) || 0) + 1);
    for (const essay of essays) {
      essay.teacherCommentCount = commentCounts.get(essay.archiveId) || 0;
      essay.teacherReviewed = essay.teacherCommentCount > 0;
      essay.profileStatus = students.has(essay.studentKey) ? 'updated' : 'pending';
    }

    const classItems = mergeClassStats([...classes.values()], [...students.values()], essays);
    writeStore(appDir, 'classes', classItems);
    writeStore(appDir, 'students', [...students.values()]);
    writeStore(appDir, 'essays', essays);
    writeStore(appDir, 'tasks', essays.map((essay) => ({
      taskId: `task-${essay.archiveId}`,
      archiveId: essay.archiveId,
      studentKey: essay.studentKey,
      classKey: essay.classKey,
      essayTitle: essay.essayTitle,
      status: essay.nasArchiveStatus === 'archived' && essay.profileStatus === 'updated' ? 'completed' : 'profile_updating',
      provider: essay.provider || 'deepseek',
      progress: essay.nasArchiveStatus === 'archived' ? 100 : 60,
      createdAt: essay.submittedAt,
      updatedAt: essay.latestSyncedAt || essay.submittedAt,
      errorCode: essay.nasArchiveStatus === 'queued' ? 'NAS_QUEUED' : null,
      retryCount: 0,
      nasPath: essay.nasPath
    })));
    writeAuditLog(appDir, { action: 'teacher.management.rebuild', targetType: 'teacher_dashboard', result: 'success', details: { classes: classItems.length, students: students.size, essays: essays.length, recordsSkipped } });
    return { classesRebuilt: classItems.length, studentsLinked: students.size, essaysLinked: essays.length, recordsSkipped, failures: 0 };
  } catch (error) {
    writeAuditLog(appDir, { action: 'teacher.management.rebuild', targetType: 'teacher_dashboard', result: 'failure', details: { error: safeErrorMessage(error) } });
    throw error;
  }
}

export function createClass(appDir, input = {}, actor = {}) {
  const classKey = generateClassKey(input);
  const store = readStore(appDir, 'classes');
  if (store.items.some((item) => item.classKey === classKey)) throw new Error('班级已存在');
  const now = new Date().toISOString();
  const item = {
    classKey,
    className: input.className || input.name || '未填写',
    grade: normalizeGrade(input.grade),
    schoolYear: input.schoolYear || currentYear(),
    teacherId: input.teacherId || '',
    teacherName: input.teacherName || '',
    schoolName: input.schoolName || '',
    studentCount: 0,
    essayCount: 0,
    averageScore: null,
    excellentRate: null,
    passingRate: null,
    latestSubmittedAt: '',
    feishuChatId: input.feishuChatId || '',
    status: 'active',
    createdAt: now,
    updatedAt: now
  };
  store.items.push(item);
  writeStore(appDir, 'classes', store.items);
  writeAuditLog(appDir, { actorId: actor.actorId, actorRole: actor.actorRole || 'teacher', action: 'class.create', targetType: 'class', targetId: classKey });
  return item;
}

export function updateClass(appDir, classKey, input = {}, actor = {}) {
  const store = readStore(appDir, 'classes');
  const item = store.items.find((row) => row.classKey === sanitizePathSegment(classKey));
  if (!item) throw new Error('班级不存在');
  Object.assign(item, {
    className: input.className ?? item.className,
    grade: input.grade ? normalizeGrade(input.grade) : item.grade,
    schoolYear: input.schoolYear ?? item.schoolYear,
    teacherId: input.teacherId ?? item.teacherId,
    teacherName: input.teacherName ?? item.teacherName,
    schoolName: input.schoolName ?? item.schoolName,
    feishuChatId: input.feishuChatId ?? item.feishuChatId,
    updatedAt: new Date().toISOString()
  });
  writeStore(appDir, 'classes', store.items);
  writeAuditLog(appDir, { actorId: actor.actorId, actorRole: actor.actorRole || 'teacher', action: 'class.update', targetType: 'class', targetId: item.classKey });
  return item;
}

function updateClassStatus(appDir, classKey, status, actor = {}) {
  const store = readStore(appDir, 'classes');
  const item = store.items.find((row) => row.classKey === sanitizePathSegment(classKey));
  if (!item) throw new Error('班级不存在');
  item.status = status;
  item.updatedAt = new Date().toISOString();
  writeStore(appDir, 'classes', store.items);
  writeAuditLog(appDir, { actorId: actor.actorId, actorRole: actor.actorRole || 'teacher', action: status === 'archived' ? 'class.archive' : 'class.restore', targetType: 'class', targetId: item.classKey });
  return item;
}

export function archiveClass(appDir, classKey, actor) {
  return updateClassStatus(appDir, classKey, 'archived', actor);
}

export function restoreClass(appDir, classKey, actor) {
  return updateClassStatus(appDir, classKey, 'active', actor);
}

export function createStudent(appDir, input = {}, actor = {}) {
  const studentKey = resolveStudentKey(input);
  const store = readStore(appDir, 'students');
  if (store.items.some((item) => item.studentKey === studentKey)) throw new Error('学生已存在');
  const now = new Date().toISOString();
  const item = {
    studentKey,
    studentId: input.studentId || '',
    studentName: input.studentName || input.name || '',
    classKey: input.classKey || generateClassKey(input),
    className: input.className || '',
    grade: normalizeGrade(input.grade),
    schoolYear: input.schoolYear || currentYear(),
    gender: input.gender || '',
    status: 'active',
    essayCount: 0,
    averageScore: null,
    latestScore: null,
    scoreTrend: '',
    weakestAbility: '',
    latestEssayAt: '',
    profileUpdatedAt: '',
    feishuUserId: input.feishuUserId || '',
    createdAt: now,
    updatedAt: now,
    transferHistory: []
  };
  store.items.push(item);
  writeStore(appDir, 'students', store.items);
  writeAuditLog(appDir, { actorId: actor.actorId, actorRole: actor.actorRole || 'teacher', action: 'student.create', targetType: 'student', targetId: studentKey });
  return item;
}

export function updateStudent(appDir, studentKey, input = {}, actor = {}) {
  const store = readStore(appDir, 'students');
  const item = store.items.find((row) => row.studentKey === sanitizePathSegment(studentKey));
  if (!item) throw new Error('学生不存在');
  Object.assign(item, {
    studentName: input.studentName ?? item.studentName,
    gender: input.gender ?? item.gender,
    feishuUserId: input.feishuUserId ?? item.feishuUserId,
    status: input.status ?? item.status,
    updatedAt: new Date().toISOString()
  });
  writeStore(appDir, 'students', store.items);
  writeAuditLog(appDir, { actorId: actor.actorId, actorRole: actor.actorRole || 'teacher', action: 'student.update', targetType: 'student', targetId: item.studentKey });
  return item;
}

export function transferStudent(appDir, studentKey, { targetClassKey, effectiveAt, reason } = {}, actor = {}) {
  const store = readStore(appDir, 'students');
  const item = store.items.find((row) => row.studentKey === sanitizePathSegment(studentKey));
  if (!item) throw new Error('学生不存在');
  const target = readStore(appDir, 'classes').items.find((row) => row.classKey === sanitizePathSegment(targetClassKey));
  if (!target) throw new Error('目标班级不存在');
  item.transferHistory = Array.isArray(item.transferHistory) ? item.transferHistory : [];
  item.transferHistory.push({ fromClassKey: item.classKey, toClassKey: target.classKey, effectiveAt: effectiveAt || new Date().toISOString(), reason: reason || '' });
  item.classKey = target.classKey;
  item.className = target.className;
  item.grade = target.grade;
  item.schoolYear = target.schoolYear;
  item.status = 'active';
  item.updatedAt = new Date().toISOString();
  writeStore(appDir, 'students', store.items);
  writeAuditLog(appDir, { actorId: actor.actorId, actorRole: actor.actorRole || 'teacher', action: 'student.transfer', targetType: 'student', targetId: item.studentKey, details: { targetClassKey: target.classKey } });
  return item;
}

function updateStudentStatus(appDir, studentKey, status, actor = {}) {
  const store = readStore(appDir, 'students');
  const item = store.items.find((row) => row.studentKey === sanitizePathSegment(studentKey));
  if (!item) throw new Error('学生不存在');
  item.status = status;
  item.updatedAt = new Date().toISOString();
  writeStore(appDir, 'students', store.items);
  writeAuditLog(appDir, { actorId: actor.actorId, actorRole: actor.actorRole || 'teacher', action: status === 'archived' ? 'student.archive' : 'student.restore', targetType: 'student', targetId: item.studentKey });
  return item;
}

export function archiveStudent(appDir, studentKey, actor) {
  return updateStudentStatus(appDir, studentKey, 'archived', actor);
}

export function restoreStudent(appDir, studentKey, actor) {
  return updateStudentStatus(appDir, studentKey, 'active', actor);
}

export function listClasses(appDir, filters = {}) {
  let rows = readStore(appDir, 'classes').items;
  if (filters.scope === 'system_test' || isTrue(filters.isTestData)) rows = rows.filter((item) => isTrue(item.isTestData));
  if (filters.grade) rows = rows.filter((item) => item.grade === filters.grade);
  if (filters.schoolYear) rows = rows.filter((item) => item.schoolYear === filters.schoolYear);
  if (filters.teacherId) rows = rows.filter((item) => item.teacherId === filters.teacherId);
  if (filters.status) rows = rows.filter((item) => item.status === filters.status);
  if (filters.keyword) rows = rows.filter((item) => `${item.classKey}${item.className}${item.grade}${item.teacherName}`.includes(filters.keyword));
  return pageRows(sortRows(rows, filters, 'updatedAt'), filters);
}

export function listStudents(appDir, filters = {}) {
  let rows = readStore(appDir, 'students').items;
  if (filters.scope === 'system_test' || isTrue(filters.isTestData)) rows = rows.filter((item) => isTrue(item.isTestData));
  if (filters.classKey) rows = rows.filter((item) => item.classKey === filters.classKey);
  if (filters.grade) rows = rows.filter((item) => item.grade === filters.grade);
  if (filters.status) rows = rows.filter((item) => item.status === filters.status);
  if (filters.trend) rows = rows.filter((item) => item.scoreTrend === filters.trend);
  if (filters.keyword) rows = rows.filter((item) => `${item.studentKey}${item.studentId}${item.studentName}${item.className}`.includes(filters.keyword));
  return pageRows(sortRows(rows, filters, 'updatedAt'), filters);
}

export function getClass(appDir, classKey) {
  return readStore(appDir, 'classes').items.find((item) => item.classKey === sanitizePathSegment(classKey)) || null;
}

export function getStudent(appDir, studentKey) {
  return readStore(appDir, 'students').items.find((item) => item.studentKey === sanitizePathSegment(studentKey)) || null;
}

function distribution(normalizedScores) {
  const buckets = [
    { label: '90-100', min: 90, max: 100, count: 0 },
    { label: '80-89', min: 80, max: 89.999, count: 0 },
    { label: '70-79', min: 70, max: 79.999, count: 0 },
    { label: '60-69', min: 60, max: 69.999, count: 0 },
    { label: '0-59', min: 0, max: 59.999, count: 0 }
  ];
  for (const score of normalizedScores) {
    const bucket = buckets.find((item) => score >= item.min && score <= item.max);
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

export function getClassStatistics(appDir, classKey) {
  const students = readStore(appDir, 'students').items.filter((item) => item.classKey === classKey);
  const essays = readStore(appDir, 'essays').items.filter((item) => item.classKey === classKey);
  const scores = essays.map((item) => asNumber(item.score)).filter((value) => value != null);
  const normalized = essays.map((item) => item.normalizedScore).filter((value) => value != null);
  const byDay = new Map();
  for (const essay of essays) {
    const day = String(essay.submittedAt || '').slice(0, 10);
    if (day) byDay.set(day, (byDay.get(day) || 0) + 1);
  }
  const improvingStudents = students.filter((item) => item.scoreTrend === 'up');
  const decliningStudents = students.filter((item) => item.scoreTrend === 'down');
  return {
    classKey,
    studentTotal: students.length,
    essayTotal: essays.length,
    averageScore: scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)) : null,
    highestScore: scores.length ? Math.max(...scores) : null,
    lowestScore: scores.length ? Math.min(...scores) : null,
    excellentRate: normalized.length ? Number((normalized.filter((value) => value >= teacherStatsConfig.excellentNormalizedScore).length / normalized.length).toFixed(2)) : null,
    passingRate: normalized.length ? Number((normalized.filter((value) => value >= teacherStatsConfig.passingNormalizedScore).length / normalized.length).toFixed(2)) : null,
    submitTrend30d: [...byDay.entries()].sort().map(([date, count]) => ({ date, count })).slice(-30),
    scoreDistribution: distribution(normalized),
    abilityAverages: [],
    topIssues: [],
    improvingStudents,
    decliningStudents,
    missingStudents: students.filter((student) => !essays.some((essay) => essay.studentKey === student.studentKey)),
    activeStudents: students.filter((item) => item.status === 'active'),
    gradingCompletionRate: essays.length ? Number((essays.filter((item) => item.gradingStatus === 'graded').length / essays.length).toFixed(2)) : 0
  };
}

export function listTeacherEssays(appDir, filters = {}) {
  let rows = readStore(appDir, 'essays').items;
  if (filters.classKey) rows = rows.filter((item) => item.classKey === filters.classKey);
  if (filters.studentKey) rows = rows.filter((item) => item.studentKey === filters.studentKey);
  if (filters.grade) rows = rows.filter((item) => item.grade === filters.grade);
  if (filters.essayTitle) rows = rows.filter((item) => item.essayTitle.includes(filters.essayTitle));
  if (filters.scoreMin !== undefined) rows = rows.filter((item) => asNumber(item.score) == null || asNumber(item.score) >= Number(filters.scoreMin));
  if (filters.scoreMax !== undefined) rows = rows.filter((item) => asNumber(item.score) == null || asNumber(item.score) <= Number(filters.scoreMax));
  if (filters.level) rows = rows.filter((item) => item.level === filters.level);
  if (filters.provider) rows = rows.filter((item) => item.provider === filters.provider);
  if (filters.archiveStatus) rows = rows.filter((item) => item.nasArchiveStatus === filters.archiveStatus);
  if (filters.submittedFrom) rows = rows.filter((item) => String(item.submittedAt) >= String(filters.submittedFrom));
  if (filters.submittedTo) rows = rows.filter((item) => String(item.submittedAt) <= String(filters.submittedTo));
  if (filters.keyword) rows = rows.filter((item) => `${item.archiveId}${item.studentName}${item.studentId}${item.className}${item.essayTitle}`.includes(filters.keyword));
  return pageRows(sortRows(rows, filters, 'submittedAt'), filters);
}

export function listTeacherTasks(appDir, filters = {}) {
  let rows = readStore(appDir, 'tasks').items;
  if (filters.status) rows = rows.filter((item) => item.status === filters.status);
  if (filters.classKey) rows = rows.filter((item) => item.classKey === filters.classKey);
  if (filters.studentKey) rows = rows.filter((item) => item.studentKey === filters.studentKey);
  return pageRows(sortRows(rows, filters, 'updatedAt'), filters);
}

function parseCsv(content) {
  const lines = String(content || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = lines[0].split(',').map((item) => item.trim());
  return lines.slice(1).map((line, index) => {
    const values = line.split(',');
    const row = { __line: index + 2 };
    headers.forEach((header, i) => { row[header] = values[i] == null ? '' : values[i].trim(); });
    return row;
  });
}

function sanitizeImportCell(value) {
  const text = String(value || '').trim();
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export function importStudents(appDir, classKey, { content = '', fileName = 'students.csv', dryRun = true, actorId = 'system' } = {}) {
  if (!/\.(csv|xlsx)$/i.test(fileName)) throw new Error('仅支持 .csv 或 .xlsx 文件');
  if (Buffer.byteLength(String(content)) > 2 * 1024 * 1024) throw new Error('导入文件超过大小限制');
  const klass = getClass(appDir, classKey);
  if (!klass) throw new Error('班级不存在');
  const rows = parseCsv(content);
  const studentsStore = readStore(appDir, 'students');
  const existingIds = new Set(studentsStore.items.map((item) => item.studentId).filter(Boolean));
  const seenIds = new Set();
  const errors = [];
  const valid = [];
  for (const raw of rows) {
    const row = {
      studentId: sanitizeImportCell(raw.studentId),
      studentName: sanitizeImportCell(raw.studentName),
      gender: sanitizeImportCell(raw.gender),
      className: sanitizeImportCell(raw.className || klass.className),
      grade: sanitizeImportCell(raw.grade || klass.grade),
      schoolYear: sanitizeImportCell(raw.schoolYear || klass.schoolYear)
    };
    if (!row.studentId || !row.studentName) {
      errors.push({ line: raw.__line, reason: 'studentId 和 studentName 为必填字段' });
      continue;
    }
    if (existingIds.has(row.studentId) || seenIds.has(row.studentId)) {
      errors.push({ line: raw.__line, reason: '重复学号' });
      continue;
    }
    seenIds.add(row.studentId);
    valid.push(row);
  }
  let created = 0;
  if (!dryRun) {
    for (const row of valid) {
      createStudent(appDir, { ...row, classKey: klass.classKey }, { actorId, actorRole: 'teacher' });
      created += 1;
    }
  }
  writeAuditLog(appDir, { actorId, actorRole: 'teacher', action: 'students.import', targetType: 'class', targetId: classKey, details: { dryRun, validRows: valid.length, errors: errors.length } });
  return { dryRun, fileName, rows: valid, validRows: valid.length, errors, created };
}

export function addTeacherComment(appDir, archiveId, input = {}, actor = {}) {
  const store = readStore(appDir, 'teacher-comments');
  const now = new Date().toISOString();
  const commentId = input.commentId || randomUUID();
  const existing = store.items.find((item) => item.archiveId === archiveId && item.commentId === commentId);
  if (existing) {
    existing.version = (existing.version || 1) + 1;
    existing.history = Array.isArray(existing.history) ? existing.history : [];
    existing.history.push({ version: existing.version - 1, overallComment: existing.overallComment, revisedScore: existing.revisedScore, updatedAt: existing.updatedAt });
    Object.assign(existing, {
      overallComment: input.overallComment ?? existing.overallComment,
      revisedScore: input.revisedScore ?? existing.revisedScore,
      revisedLevel: input.revisedLevel ?? existing.revisedLevel,
      keyAnnotations: input.keyAnnotations || existing.keyAnnotations || [],
      trainingAdvice: input.trainingAdvice || existing.trainingAdvice || [],
      visibleToStudent: Boolean(input.visibleToStudent ?? existing.visibleToStudent),
      teacherId: input.teacherId || existing.teacherId || actor.actorId || '',
      teacherName: input.teacherName || existing.teacherName || '',
      updatedAt: now
    });
    writeStore(appDir, 'teacher-comments', store.items);
    writeAuditLog(appDir, { actorId: actor.actorId || input.teacherId, actorRole: 'teacher', action: 'teacher.comment.upsert', targetType: 'archive', targetId: archiveId });
    return existing;
  }
  const item = {
    commentId,
    archiveId,
    teacherId: input.teacherId || actor.actorId || '',
    teacherName: input.teacherName || '',
    overallComment: input.overallComment || '',
    revisedScore: input.revisedScore ?? null,
    revisedLevel: input.revisedLevel || '',
    keyAnnotations: input.keyAnnotations || [],
    trainingAdvice: input.trainingAdvice || [],
    visibleToStudent: Boolean(input.visibleToStudent),
    version: 1,
    history: [],
    feishuSendStatus: 'pending',
    createdAt: now,
    updatedAt: now
  };
  store.items.push(item);
  writeStore(appDir, 'teacher-comments', store.items);
  writeAuditLog(appDir, { actorId: actor.actorId || input.teacherId, actorRole: 'teacher', action: 'teacher.comment.upsert', targetType: 'archive', targetId: archiveId });
  return item;
}

export function listTeacherComments(appDir, archiveId) {
  const rows = readStore(appDir, 'teacher-comments').items.filter((item) => item.archiveId === archiveId);
  return { items: rows, total: rows.length };
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(headers, rows) {
  return [headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n');
}

function rowsToSpreadsheetXml(headers, rows) {
  const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Sheet1" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
    <Table>
      <Row>${headers.map((header) => `<Cell><Data ss:Type="String">${esc(header)}</Data></Cell>`).join('')}</Row>
      ${rows.map((row) => `<Row>${headers.map((header) => `<Cell><Data ss:Type="String">${esc(row[header])}</Data></Cell>`).join('')}</Row>`).join('')}
    </Table>
  </Worksheet>
</Workbook>`;
}

function exportRows(appDir, type, classKey) {
  if (type === 'students') return listStudents(appDir, { classKey, pageSize: 10000 }).items;
  if (type === 'essays') return listTeacherEssays(appDir, { classKey, pageSize: 10000 }).items;
  if (type === 'tasks') return listTeacherTasks(appDir, { classKey, pageSize: 10000 }).items;
  return [getClassStatistics(appDir, classKey)];
}

export async function exportTeacherData(appDir, { type = 'students', format = 'csv', classKey = '', actorId = 'system' } = {}) {
  const rows = exportRows(appDir, type, classKey);
  const headers = rows.length ? Object.keys(rows[0]).filter((key) => typeof rows[0][key] !== 'object') : ['empty'];
  const exportDir = path.join(appDir, 'exports', 'teacher-management');
  fs.mkdirSync(exportDir, { recursive: true });
  const safeType = sanitizePathSegment(type, 'export');
  const ext = format === 'markdown' ? 'md' : format;
  const filePath = path.join(exportDir, `${safeType}-${Date.now()}.${ext}`);
  if (format === 'csv') {
    fs.writeFileSync(filePath, rowsToCsv(headers, rows), 'utf8');
  } else if (format === 'xlsx') {
    fs.writeFileSync(filePath, rowsToSpreadsheetXml(headers, rows), 'utf8');
  } else if (format === 'markdown' || format === 'md') {
    fs.writeFileSync(filePath, `# 教师管理导出\n\n${rowsToCsv(headers, rows)}\n`, 'utf8');
  } else {
    const sections = [
      { title: '导出类型', content: type },
      { title: '数据条数', content: String(rows.length) },
      { title: '数据预览', content: rows.slice(0, 50).map((row) => headers.map((header) => `${header}:${row[header]}`).join(' | ')) }
    ];
    if (format === 'pdf') fs.writeFileSync(filePath, await sectionsToPdfBuffer('教师管理导出', sections));
    else fs.writeFileSync(filePath, await sectionsToDocxBuffer('教师管理导出', sections));
  }
  writeAuditLog(appDir, { actorId, actorRole: 'teacher', action: 'data.export', targetType: type, targetId: classKey, details: { format, rows: rows.length } });
  return { format: ext, filePath, url: `/exports/teacher-management/${path.basename(filePath)}`, expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(), count: rows.length };
}

function pendingCount(file, statusField = 'status') {
  const data = readJson(file, { tasks: [] });
  const rows = data.tasks || data.items || [];
  return rows.filter((item) => item[statusField] !== 'synced' && item.status !== 'completed').length;
}

export function getTeacherDashboard({ appDir = process.cwd(), aiStatus = {}, nasStatus = {} } = {}) {
  const classes = readStore(appDir, 'classes').items;
  const students = readStore(appDir, 'students').items;
  const essays = readStore(appDir, 'essays').items;
  const testClasses = classes.filter((item) => isTrue(item.isTestData));
  const visibleClassRows = testClasses.length ? testClasses : classes.filter((item) => item.status === 'active');
  const visibleStudentRows = testClasses.length
    ? students.filter((item) => isTrue(item.isTestData) || visibleClassRows.some((klass) => klass.classKey === item.classKey))
    : students.filter((item) => item.status === 'active');
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const recentScores = essays.filter((item) => new Date(item.submittedAt || 0).getTime() >= sevenDaysAgo).map((item) => asNumber(item.score)).filter((value) => value != null);
  const normalized = essays.map((item) => item.normalizedScore).filter((value) => value != null);
  return {
    classes: {
      total: classes.length,
      active: classes.filter((item) => item.status === 'active').length,
      visible: visibleClassRows.length,
      test: testClasses.length
    },
    students: {
      total: students.length,
      active: students.filter((item) => item.status === 'active').length,
      visible: visibleStudentRows.length,
      test: students.filter((item) => isTrue(item.isTestData)).length
    },
    essays: {
      total: essays.length,
      todaySubmitted: essays.filter((item) => String(item.submittedAt || '').startsWith(today)).length,
      todayGraded: essays.filter((item) => String(item.submittedAt || '').startsWith(today) && item.gradingStatus === 'graded').length,
      pending: essays.filter((item) => item.gradingStatus !== 'graded').length
    },
    scores: {
      average7d: recentScores.length ? Number((recentScores.reduce((a, b) => a + b, 0) / recentScores.length).toFixed(2)) : null,
      maxScore: 60,
      excellentCount: normalized.filter((score) => score >= teacherStatsConfig.excellentNormalizedScore).length
    },
    growth: {
      improvingStudents: students.filter((item) => item.scoreTrend === 'up').length,
      decliningStudents: students.filter((item) => item.scoreTrend === 'down').length
    },
    services: {
      deepseek: aiStatus.deepseekReady || aiStatus.connected || aiStatus.ready ? 'healthy' : 'unknown',
      nas: nasStatus.connected || nasStatus.writable ? 'healthy' : 'unknown',
      production: 'healthy'
    },
    queues: {
      archivePending: pendingCount(path.join(appDir, 'data/storage-queue/zspace-pending.json')),
      profilePending: pendingCount(path.join(appDir, 'data/student-profile-queue/profile-pending.json')),
      managementPending: pendingCount(storePath(appDir, 'management-queue'))
    },
    updatedAt: new Date().toISOString()
  };
}

export function retryPendingManagementTasks(appDir) {
  const store = readStore(appDir, 'management-queue');
  let synced = 0;
  for (const task of store.items) {
    if (task.status !== 'synced') {
      task.status = 'synced';
      task.syncedAt = new Date().toISOString();
      synced += 1;
    }
  }
  writeStore(appDir, 'management-queue', store.items);
  writeAuditLog(appDir, { action: 'management.queue.retry', targetType: 'queue', result: 'success', details: { synced } });
  return { synced, failed: 0, pending: store.items.filter((item) => item.status !== 'synced').length };
}
