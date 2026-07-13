import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { benchmarkPaths, ensureBenchmarkDirectories, loadBenchmarkConfig, validateBenchmarkDataset } from './benchmark-config.js';

function safeSegment(value, fallback = '未填写') {
  const cleaned = String(value || fallback)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\.\.+/g, '')
    .trim();
  return cleaned || fallback;
}

function countChineseWords(text = '') {
  const chinese = String(text).match(/[\u4e00-\u9fa5]/g)?.length || 0;
  const words = String(text).replace(/[\u4e00-\u9fa5]/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  return chinese + words;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 10);
}

function parseTextLike(input, sourceType) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  const title = text.match(/^#\s+(.+)$/m)?.[1]
    || text.match(/题目[:：]\s*(.+)/)?.[1]
    || `Benchmark作文-${Date.now()}`;
  const grade = text.match(/年级[:：]\s*(.+)/)?.[1] || '未填写';
  const className = text.match(/班级[:：]\s*(.+)/)?.[1] || '未填写';
  const oldReportText = text.match(/旧平台报告[:：]\s*([\s\S]*?)(?:\n\n正文[:：]|\n正文[:：]|$)/)?.[1] || '';
  const originalEssay = text.match(/正文[:：]\s*([\s\S]*)/)?.[1] || text.replace(/^#.+$/m, '').trim();
  return { title, grade, className, originalEssay, oldReport: oldReportText ? { teacherComment: oldReportText } : null, sourceType };
}

function parseInput(input, sourceType = 'json') {
  if (sourceType === 'json' && typeof input === 'object' && !Buffer.isBuffer(input)) return { ...input };
  if (sourceType === 'json') return JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '{}'));
  return parseTextLike(input, sourceType);
}

function datasetPath(paths, id) {
  return path.join(paths.history, `${safeSegment(id)}.json`);
}

export function normalizeBenchmarkDataset({ appDir, input, sourceType = 'json', now = new Date() } = {}) {
  const config = loadBenchmarkConfig({ appDir });
  const parsed = parseInput(input, sourceType);
  const createdAt = parsed.createdAt || now.toISOString();
  const rawAuthor = parsed.authorId || parsed.studentId || parsed.studentName || parsed.author || parsed.title || 'anonymous';
  const authorId = config.anonymization?.enabled === false
    ? safeSegment(rawAuthor, 'anonymous')
    : `${config.anonymization?.prefix || 'anon'}-${stableHash(rawAuthor)}`;
  const id = parsed.id || `bench-${stableHash(`${parsed.title || ''}:${rawAuthor}:${parsed.originalEssay || ''}`)}`;
  const dataset = {
    id: safeSegment(id, `bench-${Date.now()}`),
    title: safeSegment(parsed.title || '未命名作文'),
    authorId,
    grade: safeSegment(parsed.grade || '未填写'),
    className: safeSegment(parsed.className || '未填写'),
    wordCount: Number.isInteger(parsed.wordCount) ? parsed.wordCount : countChineseWords(parsed.originalEssay || ''),
    originalEssay: String(parsed.originalEssay || parsed.essayText || parsed.text || ''),
    oldReport: parsed.oldReport || parsed.old_report || null,
    newReport: parsed.newReport || null,
    compareResult: parsed.compareResult || null,
    benchmarkScore: parsed.benchmarkScore || null,
    createdAt,
    updatedAt: now.toISOString()
  };
  const validation = validateBenchmarkDataset(dataset);
  if (!validation.ok) throw new Error(`BenchmarkDataset 校验失败：${validation.errors.join('；')}`);
  return dataset;
}

export function importBenchmarkDataset({ appDir, input, sourceType = 'json' } = {}) {
  const paths = ensureBenchmarkDirectories({ appDir });
  const dataset = normalizeBenchmarkDataset({ appDir, input, sourceType });
  fs.writeFileSync(datasetPath(paths, dataset.id), `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  return dataset;
}

export function importBenchmarkFiles({ appDir, files = [] } = {}) {
  return files.map((file) => {
    const ext = path.extname(file.name || file.path || '').slice(1).toLowerCase();
    const sourceType = ext === 'md' ? 'markdown' : ext || 'txt';
    const content = file.content ?? fs.readFileSync(file.path);
    return importBenchmarkDataset({ appDir, input: content, sourceType });
  });
}

export function listBenchmarkDatasets({ appDir, keyword = '', grade = '', className = '', page = 1, pageSize = 100 } = {}) {
  const paths = ensureBenchmarkDirectories({ appDir });
  const rows = fs.readdirSync(paths.history)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(fs.readFileSync(path.join(paths.history, file), 'utf8')))
    .filter((row) => !keyword || JSON.stringify(row).includes(keyword))
    .filter((row) => !grade || row.grade === grade)
    .filter((row) => !className || row.className === className)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const start = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(pageSize));
  return { items: rows.slice(start, start + Number(pageSize)), total: rows.length, page: Number(page), pageSize: Number(pageSize) };
}

export function readBenchmarkDataset({ appDir, id } = {}) {
  const paths = benchmarkPaths({ appDir });
  const file = datasetPath(paths, id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeBenchmarkDataset({ appDir, dataset } = {}) {
  const paths = ensureBenchmarkDirectories({ appDir });
  const validation = validateBenchmarkDataset(dataset);
  if (!validation.ok) throw new Error(`BenchmarkDataset 校验失败：${validation.errors.join('；')}`);
  fs.writeFileSync(datasetPath(paths, dataset.id), `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
  return dataset;
}
