import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { sectionsToDocxBuffer, sectionsToPdfBuffer } from '../exporter.js';

const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

function safeCsvValue(value) {
  const text = String(value ?? '');
  const escaped = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${escaped.replace(/"/g, '""')}"`;
}

export function reportToSections(dataset = {}, report = {}, compare = {}, score = {}) {
  return [
    { title: '样本信息', content: [`题目：${dataset.title}`, `年级：${dataset.grade}`, `班级：${dataset.className}`, `字数：${dataset.wordCount}`] },
    { title: '总体评价', content: report.overall || report.overall_evaluation || '暂无' },
    { title: '审题立意', content: report.topicIntentAnalysis || report.topic_intent_analysis || '暂无' },
    { title: '结构分析', content: report.structureAnalysis || report.structure_analysis || '暂无' },
    { title: '逻辑分析', content: report.logicAnalysis || report.logic_analysis || '暂无' },
    { title: '语言分析', content: report.languageAnalysis || report.language_analysis || '暂无' },
    { title: '素材分析', content: report.materialAnalysis || report.material_analysis || '暂无' },
    { title: '论证分析', content: report.argumentAnalysis || '暂无' },
    { title: '教师点评', content: report.teacherComment || report.teacher_comment || '暂无' },
    { title: '修改建议', content: report.revisionSuggestions || report.suggestions || '暂无' },
    { title: '成长建议', content: report.growthSuggestions || report.training_tasks || report.next_training || '暂无' },
    { title: 'Benchmark 对比', content: `提升项：${compare.summary?.improvedCount || 0}/${compare.summary?.total || 0}` },
    { title: 'Benchmark 评分', content: `总分：${score.totalScore || 0}，均分：${score.averageScore || 0}，提升率：${score.improvementRate || 0}%` }
  ];
}

export function sectionsToMarkdown(title, sections) {
  return [`# ${title}`, ...sections.map((section) => `\n## ${section.title}\n\n${Array.isArray(section.content) ? section.content.join('\n\n') : String(section.content || '暂无')}`)].join('\n');
}

export async function writePerDatasetArtifacts({ dir, dataset, report, compare, score }) {
  fs.mkdirSync(dir, { recursive: true });
  const sections = reportToSections(dataset, report, compare, score);
  fs.writeFileSync(path.join(dir, 'new_report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'compare.json'), `${JSON.stringify(compare, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'benchmark-score.json'), `${JSON.stringify(score, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'report.md'), sectionsToMarkdown(`Benchmark 批改报告：${dataset.title}`, sections), 'utf8');
  fs.writeFileSync(path.join(dir, 'report.docx'), await sectionsToDocxBuffer(`Benchmark 批改报告：${dataset.title}`, sections));
  fs.writeFileSync(path.join(dir, 'report.pdf'), await sectionsToPdfBuffer(`Benchmark 批改报告：${dataset.title}`, sections));
}

export function writeChartArtifacts({ chartsDir, summary }) {
  fs.mkdirSync(chartsDir, { recursive: true });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#f6fbf8"/><text x="60" y="90" font-size="42" fill="#143b34">Benchmark Center</text><text x="60" y="160" font-size="28" fill="#216b5d">Average Score: ${summary.averageScore ?? 0}</text><text x="60" y="215" font-size="28" fill="#216b5d">Improvement: ${summary.averageImprovementRate ?? 0}%</text></svg>`;
  for (const name of ['radar', 'bar', 'line', 'pie', 'model-comparison']) {
    fs.writeFileSync(path.join(chartsDir, `${name}.svg`), svg, 'utf8');
    fs.writeFileSync(path.join(chartsDir, `${name}.png`), transparentPng);
    fs.writeFileSync(path.join(chartsDir, `${name}.pdf`), Buffer.from(`%PDF-1.4\n% ${name} chart placeholder\n%%EOF\n`, 'utf8'));
  }
}

export function summaryToCsv(rows = []) {
  const headers = ['id', 'title', 'provider', 'model', 'score', 'averageScore', 'improvementRate', 'latencyMs', 'status'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((key) => safeCsvValue(row[key])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

export function createZipBuffer(entries = []) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/^\/+/, ''), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || ''), 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 36);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

export async function writeFinalBenchmarkExports({ exportDir, summary, rows }) {
  fs.mkdirSync(exportDir, { recursive: true });
  const sections = [
    { title: '项目概述', content: 'P1.5 Benchmark Center 用于验证作文 AI 批改质量，支持多模型、断点恢复、教师复核和统一导出。' },
    { title: '样本数量', content: String(summary.samples || 0) },
    { title: '评分统计', content: [`平均分：${summary.averageScore || 0}`, `平均提升率：${summary.averageImprovementRate || 0}%`, `成功率：${summary.successRate || 0}%`] },
    { title: '模型比较', content: Object.entries(summary.modelComparison || {}).map(([model, item]) => `${model}：${item.averageScore || 0}`) },
    { title: '最终建议', content: summary.recommendation || '继续保留 Benchmark 周期验证，把教师人工复核作为 Prompt 优化依据。' }
  ];
  const markdown = sectionsToMarkdown('P1.5 AI 批改质量 Benchmark 报告', sections);
  const csv = summaryToCsv(rows);
  fs.writeFileSync(path.join(exportDir, 'Benchmark_Report.md'), markdown, 'utf8');
  fs.writeFileSync(path.join(exportDir, 'Benchmark_Report.docx'), await sectionsToDocxBuffer('P1.5 AI 批改质量 Benchmark 报告', sections));
  fs.writeFileSync(path.join(exportDir, 'Benchmark_Report.pdf'), await sectionsToPdfBuffer('P1.5 AI 批改质量 Benchmark 报告', sections));
  fs.writeFileSync(path.join(exportDir, 'Benchmark_Report.csv'), csv, 'utf8');
  fs.writeFileSync(path.join(exportDir, 'Benchmark_Report.xlsx'), csv, 'utf8');
  fs.writeFileSync(path.join(exportDir, 'Benchmark_Report.zip'), createZipBuffer([
    { name: 'Benchmark_Report.md', data: markdown },
    { name: 'Benchmark_Report.csv', data: csv },
    { name: 'summary.json', data: JSON.stringify(summary, null, 2) }
  ]));
}
