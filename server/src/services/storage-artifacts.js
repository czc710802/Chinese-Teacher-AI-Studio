import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';

function isEnabled(storageService) {
  return Boolean(storageService?.rawConfig?.enabled);
}

function safeDateStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function yearFromDate(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isFinite(date.getFullYear()) ? String(date.getFullYear()) : String(new Date().getFullYear());
}

function warn(logger, message, error) {
  logger?.warn?.(message, { message: error?.message || String(error || '') });
}

function safeJson(value) {
  try {
    return JSON.stringify(value || {}, null, 2);
  } catch {
    return '{}';
  }
}

function reviewMarkdown({ context = {}, review = {} } = {}) {
  const score = review.total_score ?? review.totalScore ?? '';
  const full = review.full_score ?? review.fullScore ?? 60;
  const level = review.level || '';
  const strengths = Array.isArray(review.strengths) ? review.strengths : review.coreAdvantages || [];
  const problems = Array.isArray(review.problems) ? review.problems : review.mainProblems || [];
  const suggestions = Array.isArray(review.suggestions) ? review.suggestions : [];
  const suggestionText = suggestions.map((item) => typeof item === 'string' ? item : (item.focus || item.diagnosis || item.action || JSON.stringify(item))).join('\n- ');
  return `# 作文自动批改报告

- 作文ID：${context.essay_id || ''}
- 学生：${context.student_name || ''}
- 班级：${context.class_name || ''}
- 标题：${context.essay_title || ''}
- 总分：${score} / ${full}
- 等级：${level}

## 主要优点
${strengths.length ? strengths.map((item) => `- ${item}`).join('\n') : '- 暂无'}

## 主要问题
${problems.length ? problems.map((item) => `- ${item}`).join('\n') : '- 暂无'}

## 修改建议
${suggestionText ? `- ${suggestionText}` : '- 暂无'}

## 原始 JSON

\`\`\`json
${safeJson(review)}
\`\`\`
`;
}

async function writeReviewDocx(filePath, markdown) {
  const children = markdown.split(/\n{2,}/).map((block, index) => {
    if (block.startsWith('# ')) return new Paragraph({ text: block.replace(/^#\s+/, ''), heading: HeadingLevel.TITLE });
    if (block.startsWith('## ')) return new Paragraph({ text: block.replace(/^##\s+/, ''), heading: HeadingLevel.HEADING_2 });
    return new Paragraph({ children: [new TextRun(block.replace(/```json|```/g, '').trim() || ' ')] });
  });
  if (!children.length) children.push(new Paragraph({ text: '作文自动批改报告', heading: HeadingLevel.TITLE }));
  const doc = new Document({ sections: [{ children }] });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, await Packer.toBuffer(doc));
}

function writeReviewPdf(filePath, markdown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const stream = fs.createWriteStream(filePath);
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);
    const fontCandidates = [
      '/Library/Fonts/Arial Unicode.ttf',
      '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
      '/System/Library/Fonts/STHeiti Medium.ttc'
    ];
    const fontPath = fontCandidates.find((candidate) => fs.existsSync(candidate));
    if (fontPath) doc.font(fontPath);
    doc.fontSize(18).text('作文自动批改报告');
    doc.moveDown();
    doc.fontSize(10).text(markdown.replace(/```json|```/g, ''), { lineGap: 4 });
    doc.end();
  });
}

export function getEssayStorageContext(database, essayId) {
  return database.prepare(`
    SELECT e.id AS essay_id, e.created_at, e.title AS essay_title,
           s.id AS student_id, u.name AS student_name,
           c.id AS class_id, c.name AS class_name
    FROM essays e
    JOIN students s ON s.id = e.student_id
    JOIN users u ON u.id = s.user_id
    JOIN assignments a ON a.id = e.assignment_id
    JOIN classes c ON c.id = a.class_id
    WHERE e.id = ?
  `).get(essayId);
}

function essayBaseRemotePath(storageService, context) {
  return storageService.createStudentDirectory({
    classId: context.class_id,
    className: context.class_name,
    studentId: context.student_id,
    studentName: context.student_name,
    year: yearFromDate(context.created_at),
    essayId: context.essay_id
  }).remotePath;
}

export async function recordOriginalArtifact({ storageService, database, essayId, files = [], text = '', logger = console } = {}) {
  if (!isEnabled(storageService)) return [];
  try {
    const context = getEssayStorageContext(database, essayId);
    if (!context) return [];
    const baseRemotePath = essayBaseRemotePath(storageService, context);
    const saved = [];
    for (const [index, file] of files.entries()) {
      if (!file?.path || !fs.existsSync(file.path)) continue;
      saved.push(await storageService.saveFile({
        localPath: file.path,
        remotePath: path.posix.join(baseRemotePath, 'original', `${index + 1}-${file.originalname || path.basename(file.path)}`),
        originalName: file.originalname || path.basename(file.path),
        metadata: { stage: 'original', essayId, source: 'upload' }
      }));
    }
    if (text) {
      saved.push(await storageService.saveFile({
        content: text,
        remotePath: path.posix.join(baseRemotePath, 'original', 'submitted-text.txt'),
        originalName: 'submitted-text.txt',
        metadata: { stage: 'original', essayId, source: 'text' }
      }));
    }
    return saved;
  } catch (error) {
    warn(logger, 'NAS 原文归档失败，已保留本地业务数据', error);
    return [];
  }
}

export async function recordOcrArtifact({ storageService, database, essayId, text = '', files = [], logger = console } = {}) {
  if (!isEnabled(storageService)) return [];
  try {
    const saved = [];
    let baseRemotePath = path.posix.join('resources', 'ocr', safeDateStamp());
    if (essayId) {
      const context = getEssayStorageContext(database, essayId);
      if (context) baseRemotePath = path.posix.join(essayBaseRemotePath(storageService, context), 'ocr');
    }
    saved.push(await storageService.saveFile({
      content: text,
      remotePath: path.posix.join(baseRemotePath, 'ocr-text.txt'),
      originalName: 'ocr-text.txt',
      metadata: { stage: 'ocr', essayId: essayId || null }
    }));
    saved.push(await storageService.saveFile({
      content: JSON.stringify({
        essayId: essayId || null,
        text,
        textLength: String(text || '').length,
        files: files.map((file) => ({
          originalName: file.originalname || file.filename || '',
          size: file.size || 0,
          mimetype: file.mimetype || ''
        })),
        createdAt: new Date().toISOString()
      }, null, 2),
      remotePath: path.posix.join(baseRemotePath, 'ocr-result.json'),
      originalName: 'ocr-result.json',
      metadata: { stage: 'ocr-json', essayId: essayId || null }
    }));
    return saved;
  } catch (error) {
    warn(logger, 'NAS OCR 归档失败，已保留本地业务数据', error);
    return [];
  }
}

export async function recordReviewArtifact({ storageService, database, essayId, review, logger = console } = {}) {
  if (!isEnabled(storageService)) return null;
  try {
    const context = getEssayStorageContext(database, essayId);
    if (!context) return null;
    const baseRemotePath = path.posix.join(essayBaseRemotePath(storageService, context), 'review');
    const saved = await storageService.saveFile({
      content: JSON.stringify({
        essayId,
        savedAt: new Date().toISOString(),
        review
      }, null, 2),
      remotePath: path.posix.join(baseRemotePath, 'ai-review.json'),
      originalName: 'ai-review.json',
      metadata: { stage: 'review', essayId }
    });
    await recordReviewReportArtifacts({ storageService, database, essayId, review, logger });
    return saved;
  } catch (error) {
    warn(logger, 'NAS 批改结果归档失败，已保留本地业务数据', error);
    return null;
  }
}

export async function recordReviewReportArtifacts({ storageService, database, essayId, review, logger = console } = {}) {
  if (!isEnabled(storageService)) return [];
  try {
    const context = getEssayStorageContext(database, essayId);
    if (!context) return [];
    const baseRemotePath = path.posix.join(essayBaseRemotePath(storageService, context), 'export');
    const localBase = path.join(storageService.rawConfig?.appDir || path.resolve(process.cwd()), 'server', 'storage-artifacts', 'auto-reports', String(essayId));
    const markdown = reviewMarkdown({ context, review });
    const mdPath = path.join(localBase, 'auto-review-report.md');
    const docxPath = path.join(localBase, 'auto-review-report.docx');
    const pdfPath = path.join(localBase, 'auto-review-report.pdf');
    fs.mkdirSync(localBase, { recursive: true });
    fs.writeFileSync(mdPath, markdown);
    await writeReviewDocx(docxPath, markdown);
    await writeReviewPdf(pdfPath, markdown);
    return [
      await storageService.saveFile({ localPath: mdPath, remotePath: path.posix.join(baseRemotePath, 'auto-review-report.md'), originalName: 'auto-review-report.md', metadata: { stage: 'auto-review-markdown', essayId } }),
      await storageService.saveFile({ localPath: docxPath, remotePath: path.posix.join(baseRemotePath, 'auto-review-report.docx'), originalName: 'auto-review-report.docx', metadata: { stage: 'auto-review-docx', essayId } }),
      await storageService.saveFile({ localPath: pdfPath, remotePath: path.posix.join(baseRemotePath, 'auto-review-report.pdf'), originalName: 'auto-review-report.pdf', metadata: { stage: 'auto-review-pdf', essayId } })
    ];
  } catch (error) {
    warn(logger, 'NAS 自动批改报告归档失败，已保留本地业务数据', error);
    return [];
  }
}

export async function recordStudentProfileSnapshot({ storageService, database, studentId, logger = console } = {}) {
  if (!isEnabled(storageService)) return null;
  try {
    const profile = database.prepare(`
      SELECT sp.*, s.id AS student_id, u.name AS student_name, c.id AS class_id, c.name AS class_name
      FROM student_profiles sp
      JOIN students s ON s.id = sp.student_id
      JOIN users u ON u.id = s.user_id
      LEFT JOIN class_students cs ON cs.student_id = s.id
      LEFT JOIN classes c ON c.id = cs.class_id
      WHERE sp.student_id = ?
      ORDER BY c.id
      LIMIT 1
    `).get(studentId);
    if (!profile) return null;
    const classSegment = profile.class_id ? `${profile.class_id}-${profile.class_name || 'class'}` : 'unassigned';
    const studentSegment = `${profile.student_id}-${profile.student_name || 'student'}`;
    return await storageService.saveFile({
      content: JSON.stringify(profile, null, 2),
      remotePath: path.posix.join('classes', classSegment, 'students', studentSegment, yearFromDate(profile.updated_at), 'profile', `profile-${safeDateStamp()}.json`),
      originalName: 'student-profile.json',
      metadata: { stage: 'student-profile', studentId }
    });
  } catch (error) {
    warn(logger, 'NAS 学生成长档案归档失败，已保留本地业务数据', error);
    return null;
  }
}

export async function recordExportArtifact({ storageService, database, filePath, targetType, targetId, logger = console } = {}) {
  if (!isEnabled(storageService) || !filePath || !fs.existsSync(filePath)) return null;
  try {
    let remoteBase = path.posix.join('resources', 'exports', targetType || 'unknown');
    if (targetType === 'essay') {
      const context = getEssayStorageContext(database, targetId);
      if (context) remoteBase = path.posix.join(essayBaseRemotePath(storageService, context), 'export');
    } else if (targetType === 'student_profile') {
      remoteBase = path.posix.join('resources', 'student-profiles', String(targetId || 'unknown'), 'export');
    } else if (targetType) {
      remoteBase = path.posix.join('resources', 'exports', targetType, String(targetId || 'all'));
    }
    return await storageService.saveFile({
      localPath: filePath,
      remotePath: path.posix.join(remoteBase, path.basename(filePath)),
      originalName: path.basename(filePath),
      metadata: { stage: 'export', targetType, targetId }
    });
  } catch (error) {
    warn(logger, 'NAS 导出文件归档失败，已保留本地业务数据', error);
    return null;
  }
}

export async function recordEssayAiArtifact({ storageService, record, files = [], logger = console } = {}) {
  if (!isEnabled(storageService) || !record?.id) return [];
  try {
    const baseRemotePath = path.posix.join('resources', 'essay-ai', String(record.id));
    const saved = [];
    for (const [index, file] of files.entries()) {
      if (!file?.path || !fs.existsSync(file.path)) continue;
      saved.push(await storageService.saveFile({
        localPath: file.path,
        remotePath: path.posix.join(baseRemotePath, 'original', `${index + 1}-${file.originalname || file.filename || path.basename(file.path)}`),
        originalName: file.originalname || file.filename || path.basename(file.path),
        metadata: { stage: 'essay-ai-original', recordId: record.id }
      }));
    }
    if (record.text) {
      saved.push(await storageService.saveFile({
        content: record.text,
        remotePath: path.posix.join(baseRemotePath, 'ocr', 'recognized-text.txt'),
        originalName: 'recognized-text.txt',
        metadata: { stage: 'essay-ai-text', recordId: record.id }
      }));
    }
    saved.push(await storageService.saveFile({
      content: JSON.stringify(record, null, 2),
      remotePath: path.posix.join(baseRemotePath, 'review', 'record.json'),
      originalName: 'record.json',
      metadata: { stage: 'essay-ai-record', recordId: record.id }
    }));
    if (record.reportMarkdown) {
      saved.push(await storageService.saveFile({
        content: record.reportMarkdown,
        remotePath: path.posix.join(baseRemotePath, 'export', 'report.md'),
        originalName: 'report.md',
        metadata: { stage: 'essay-ai-report', recordId: record.id }
      }));
    }
    return saved;
  } catch (error) {
    warn(logger, 'NAS Essay AI 归档失败，已保留本地业务数据', error);
    return [];
  }
}
