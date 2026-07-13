import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { db } from '../db/connection.js';
import { parseJson } from '../utils/json.js';
import { recordExportArtifact } from './storage-artifacts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exportDir = path.resolve(__dirname, '../../exports');
fs.mkdirSync(exportDir, { recursive: true });

function essayReportData(essayId) {
  const essay = db.prepare(`
    SELECT e.*, u.name AS student_name, a.title AS assignment_title, a.prompt, a.full_score
    FROM essays e
    JOIN students s ON s.id = e.student_id
    JOIN users u ON u.id = s.user_id
    JOIN assignments a ON a.id = e.assignment_id
    WHERE e.id = ?
  `).get(essayId);
  const review = db.prepare('SELECT * FROM ai_reviews WHERE essay_id = ? ORDER BY id DESC LIMIT 1').get(essayId);
  const latestUpgrade = db.prepare(`
    SELECT upgraded_text, upgraded_score
    FROM ai_upgrade_records
    WHERE essay_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `).get(essayId);
  if (!essay) throw new Error('作文不存在');
  return { essay, review, latestUpgrade };
}

function addDocSection(children, title, content) {
  children.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_2 }));
  const list = Array.isArray(content) ? content : [content || '暂无'];
  for (const item of list) {
    children.push(new Paragraph({ children: [new TextRun(String(item))] }));
  }
}

function richText(value) {
  if (value == null || value === '') return '暂无';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.length ? value.map(richText).join('\n') : '暂无';
  if (value.focus || value.title || value.type) {
    return [
      value.type ? `【${value.type}】` : '',
      value.focus || value.title || '',
      value.goal ? `目标：${value.goal}` : '',
      value.task ? `任务：${value.task}` : '',
      value.diagnosis ? `诊断：${value.diagnosis}` : '',
      value.logic_analysis ? `逻辑：${value.logic_analysis}` : '',
      value.action_steps ? `步骤：${value.action_steps}` : '',
      value.example_direction ? `示例：${value.example_direction}` : '',
      value.reason ? `理由：${value.reason}` : '',
      value.checkpoint ? `自查：${value.checkpoint}` : ''
    ].filter(Boolean).join(' ');
  }
  if (value.paragraph || value.original || value.revision) {
    return [
      value.paragraph ? `第${value.paragraph}段` : '',
      value.original ? `原文：${value.original}` : '',
      value.problem ? `问题：${value.problem}` : '',
      value.revision ? `修改：${value.revision}` : '',
      value.explanation ? `理由：${value.explanation}` : ''
    ].filter(Boolean).join('\n');
  }
  return Object.entries(value).map(([key, item]) => `${key}：${richText(item)}`).join('\n');
}

function p15ReviewSections(reviewJson = {}) {
  return [
    { title: '总体评价', content: reviewJson.overall_evaluation || reviewJson.teacher_comment || reviewJson.teacher_overall },
    { title: '审题立意', content: reviewJson.topic_intent_analysis || reviewJson.intent_analysis || reviewJson.idea_analysis },
    { title: '结构分析', content: reviewJson.structure_analysis },
    { title: '逻辑分析', content: reviewJson.logic_analysis || reviewJson.thinking_coach?.diagnosis },
    { title: '语言分析', content: reviewJson.language_analysis },
    { title: '素材分析', content: reviewJson.material_analysis || reviewJson.content_analysis },
    { title: '推荐素材', content: richText(reviewJson.recommended_materials) },
    { title: '高考评分', content: richText(reviewJson.gaokao_scoring || reviewJson.gaokao_dimensions) },
    { title: '逐段精修', content: richText(reviewJson.paragraph_refinements || reviewJson.paragraph_rewrites) },
    { title: '教师评语', content: reviewJson.teacher_comment || reviewJson.teacher_overall },
    { title: '训练任务', content: richText(reviewJson.training_tasks || reviewJson.next_training) },
    { title: '成长分析', content: richText(reviewJson.growth_analysis) }
  ];
}

export function sectionsToPdfBuffer(title, sections) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    writePdfContent(doc, title, sections);
    doc.end();
  });
}

function writePdfContent(doc, title, sections) {
  const fontCandidates = [
    '/Library/Fonts/Arial Unicode.ttf',
    '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
    '/System/Library/Fonts/STHeiti Medium.ttc'
  ];
  const fontPath = fontCandidates.find((candidate) => fs.existsSync(candidate));
  if (fontPath) doc.font(fontPath);
  doc.fontSize(20).text(title);
  doc.moveDown();
  for (const section of sections) {
    doc.fontSize(15).text(section.title);
    doc.fontSize(11).text(Array.isArray(section.content) ? section.content.join('\n') : String(section.content || '暂无'), {
      lineGap: 4
    });
    doc.moveDown();
  }
}

async function writePdf(filePath, title, sections) {
  fs.writeFileSync(filePath, await sectionsToPdfBuffer(title, sections));
}

export async function sectionsToDocxBuffer(title, sections) {
  const children = [new Paragraph({ text: title, heading: HeadingLevel.TITLE })];
  for (const section of sections) addDocSection(children, section.title, section.content);
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

async function writeDocx(filePath, title, sections) {
  fs.writeFileSync(filePath, await sectionsToDocxBuffer(title, sections));
}

export async function exportEssayReport({ essayId, format, userId, storageService }) {
  const { essay, review, latestUpgrade } = essayReportData(essayId);
  const ext = format === 'pdf' ? 'pdf' : 'docx';
  const filename = `essay-${essayId}-${Date.now()}.${ext}`;
  const filePath = path.join(exportDir, filename);
  const reviewJson = review ? JSON.parse(review.raw_json) : {};
  const sections = [
    { title: '作文任务', content: `${essay.assignment_title}\n${essay.prompt}` },
    { title: '学生原文', content: essay.original_text },
    { title: '总分与等级', content: review ? `${review.total_score}/${essay.full_score}，${review.level}` : '暂无 AI 批改' },
    ...p15ReviewSections(reviewJson),
    { title: '分项得分', content: parseJson(review?.dimension_scores, []).map((x) => `${x.name}：${x.score}/${x.full}。${x.comment}`) },
    { title: '主要优点', content: parseJson(review?.strengths, []) },
    { title: '主要问题', content: parseJson(review?.problems, []) },
    { title: '修改建议', content: parseJson(review?.suggestions, []) },
    { title: '升格示范', content: reviewJson.upgraded_paragraph || review?.upgraded_paragraph },
    { title: 'AI批改后的升格文章全文', content: latestUpgrade?.upgraded_text || reviewJson.polished_full_text || '暂无 AI 批改后的升格文章全文' }
  ];
  if (format === 'pdf') await writePdf(filePath, '单篇作文批改报告', sections);
  else await writeDocx(filePath, '单篇作文批改报告', sections);
  db.prepare('INSERT INTO export_records (user_id, export_type, target_type, target_id, file_path) VALUES (?, ?, ?, ?, ?)')
    .run(userId, format, 'essay', essayId, filePath);
  await recordExportArtifact({ storageService, database: db, filePath, targetType: 'essay', targetId: essayId });
  return { filePath, url: `/exports/${filename}` };
}

function managedEssayRows({ teacherUserId, assignmentId, classId, reviewedOnly }) {
  const params = [teacherUserId];
  let where = 'WHERE t.user_id = ?';
  if (assignmentId) {
    where += ' AND a.id = ?';
    params.push(assignmentId);
  }
  if (classId) {
    where += ' AND c.id = ?';
    params.push(classId);
  }
  if (reviewedOnly) where += ' AND ar.id IS NOT NULL';
  return db.prepare(`
    SELECT e.id, e.title, e.original_text, e.created_at, u.name AS student_name,
           a.title AS assignment_title, a.prompt, a.full_score, c.name AS class_name,
           ar.total_score, ar.level, ar.dimension_scores, ar.strengths, ar.problems,
           ar.suggestions, ar.upgraded_paragraph, ar.raw_json,
           aur.upgraded_text AS latest_upgrade, aur.upgraded_score AS latest_upgrade_score
    FROM essays e
    JOIN assignments a ON a.id = e.assignment_id
    JOIN classes c ON c.id = a.class_id
    JOIN teachers t ON t.id = c.teacher_id
    JOIN students s ON s.id = e.student_id
    JOIN users u ON u.id = s.user_id
    LEFT JOIN ai_reviews ar ON ar.essay_id = e.id
    LEFT JOIN ai_upgrade_records aur ON aur.id = (
      SELECT id
      FROM ai_upgrade_records
      WHERE essay_id = e.id
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    )
    ${where}
    ORDER BY a.created_at DESC, e.created_at DESC, e.id DESC
  `).all(...params);
}

function essayRowsToSections(rows) {
  if (!rows.length) return [{ title: '作文记录', content: '暂无可导出的作文。' }];
  return rows.flatMap((row, index) => {
    const reviewJson = row.raw_json ? JSON.parse(row.raw_json) : {};
    return [
      { title: `作文 ${index + 1}：${row.student_name} · ${row.assignment_title}`, content: [`班级：${row.class_name}`, `提交时间：${row.created_at}`, `题目：${row.title || row.assignment_title}`] },
      { title: '学生原文', content: row.original_text },
      { title: '批改结果', content: row.total_score == null ? '暂无 AI 批改' : `${row.total_score}/${row.full_score}，${row.level}` },
      ...p15ReviewSections(reviewJson),
      { title: '分项得分', content: parseJson(row.dimension_scores, []).map((x) => `${x.name}：${x.score}/${x.full}。${x.comment}`) },
      { title: '主要优点', content: parseJson(row.strengths, []) },
      { title: '主要问题', content: parseJson(row.problems, []) },
      { title: '修改建议', content: parseJson(row.suggestions, []) },
      { title: '升格示范', content: reviewJson.upgraded_paragraph || row.upgraded_paragraph },
      { title: '学生端批改结果升格文', content: row.latest_upgrade || reviewJson.polished_full_text || '暂无学生端生成的整篇升格文' }
    ];
  });
}

async function exportEssayRows({ rows, format, userId, targetType, targetId, filenamePrefix, reportTitle, storageService }) {
  const ext = format === 'pdf' ? 'pdf' : 'docx';
  const filename = `${filenamePrefix}-${Date.now()}.${ext}`;
  const filePath = path.join(exportDir, filename);
  const sections = essayRowsToSections(rows);
  if (format === 'pdf') await writePdf(filePath, reportTitle, sections);
  else await writeDocx(filePath, reportTitle, sections);
  db.prepare('INSERT INTO export_records (user_id, export_type, target_type, target_id, file_path) VALUES (?, ?, ?, ?, ?)')
    .run(userId, format, targetType, targetId || 0, filePath);
  await recordExportArtifact({ storageService, database: db, filePath, targetType, targetId: targetId || 0 });
  return { filePath, url: `/exports/${filename}`, count: rows.length };
}

export async function exportAssignmentEssays({ assignmentId, format, userId, storageService }) {
  const rows = managedEssayRows({ teacherUserId: userId, assignmentId, reviewedOnly: false });
  return exportEssayRows({
    rows,
    format,
    userId,
    targetType: 'assignment_essays',
    targetId: assignmentId,
    filenamePrefix: `assignment-essays-${assignmentId}`,
    reportTitle: '班级作业作文汇总',
    storageService
  });
}

export async function exportReviewedEssays({ classId, format, userId, storageService }) {
  const rows = managedEssayRows({ teacherUserId: userId, classId, reviewedOnly: true });
  return exportEssayRows({
    rows,
    format,
    userId,
    targetType: 'reviewed_essays',
    targetId: classId || 0,
    filenamePrefix: classId ? `reviewed-essays-class-${classId}` : 'reviewed-essays-all',
    reportTitle: '批改记录汇总',
    storageService
  });
}

export async function exportStudentProfile({ studentId, format, userId, storageService }) {
  const profile = db.prepare(`
    SELECT sp.*, u.name AS student_name
    FROM student_profiles sp
    JOIN students s ON s.id = sp.student_id
    JOIN users u ON u.id = s.user_id
    WHERE sp.student_id = ?
  `).get(studentId);
  if (!profile) throw new Error('学生档案不存在');
  const ext = format === 'pdf' ? 'pdf' : 'docx';
  const filename = `student-profile-${studentId}-${Date.now()}.${ext}`;
  const filePath = path.join(exportDir, filename);
  const sections = [
    { title: '学生姓名', content: profile.student_name },
    { title: '成长报告', content: profile.growth_report },
    { title: '分数趋势', content: parseJson(profile.score_trend, []).map((x) => `${x.date}：${x.score}分`) },
    { title: '常见问题', content: parseJson(profile.common_problems, []).map((x) => `${x.name}（${x.count}次）`) },
    { title: '个性化提升建议', content: parseJson(profile.personalized_suggestions, []) }
  ];
  if (format === 'pdf') await writePdf(filePath, '学生作文成长档案', sections);
  else await writeDocx(filePath, '学生作文成长档案', sections);
  db.prepare('INSERT INTO export_records (user_id, export_type, target_type, target_id, file_path) VALUES (?, ?, ?, ?, ?)')
    .run(userId, format, 'student_profile', studentId, filePath);
  await recordExportArtifact({ storageService, database: db, filePath, targetType: 'student_profile', targetId: studentId });
  return { filePath, url: `/exports/${filename}` };
}

export async function exportClassReport({ classId, format, userId, analytics, storageService }) {
  const ext = format === 'pdf' ? 'pdf' : 'docx';
  const filename = `class-report-${classId}-${Date.now()}.${ext}`;
  const filePath = path.join(exportDir, filename);
  const sections = [
    { title: '核心数据', content: [`平均分：${analytics.averageScore}`, `最高分：${analytics.maxScore}`, `最低分：${analytics.minScore}`] },
    { title: '未提交名单', content: analytics.missingStudents },
    { title: '常见写作问题', content: analytics.commonProblems.map((x) => `${x.name}（${x.count}次）`) }
  ];
  if (format === 'pdf') await writePdf(filePath, '班级作文统计报告', sections);
  else await writeDocx(filePath, '班级作文统计报告', sections);
  db.prepare('INSERT INTO export_records (user_id, export_type, target_type, target_id, file_path) VALUES (?, ?, ?, ?, ?)')
    .run(userId, format, 'class_report', classId, filePath);
  await recordExportArtifact({ storageService, database: db, filePath, targetType: 'class_report', targetId: classId });
  return { filePath, url: `/exports/${filename}` };
}

export async function exportExcellentEssays({ classId, format, userId, storageService }) {
  const rows = db.prepare(`
    SELECT e.title, e.original_text, u.name AS student_name, ar.total_score, ar.strengths
    FROM essays e JOIN assignments a ON a.id=e.assignment_id JOIN students s ON s.id=e.student_id
    JOIN users u ON u.id=s.user_id JOIN ai_reviews ar ON ar.essay_id=e.id
    WHERE a.class_id=? ORDER BY ar.total_score DESC LIMIT 10
  `).all(classId);
  const ext = format === 'pdf' ? 'pdf' : 'docx';
  const filename = `excellent-essays-${classId}-${Date.now()}.${ext}`;
  const filePath = path.join(exportDir, filename);
  const sections = rows.flatMap((row, index) => [
    { title: `优秀作文 ${index + 1}：${row.student_name} · ${row.title || '未命名'}`, content: `${row.total_score}分\n${row.original_text}` },
    { title: '可借鉴亮点', content: parseJson(row.strengths, []) }
  ]);
  if (format === 'pdf') await writePdf(filePath, '班级优秀作文精选', sections);
  else await writeDocx(filePath, '班级优秀作文精选', sections);
  db.prepare('INSERT INTO export_records (user_id, export_type, target_type, target_id, file_path) VALUES (?, ?, ?, ?, ?)').run(userId, format, 'excellent_essays', classId, filePath);
  await recordExportArtifact({ storageService, database: db, filePath, targetType: 'excellent_essays', targetId: classId });
  return { filePath, url: `/exports/${filename}` };
}
