import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { schemaSql } from '../src/db/schema.js';
import {
  listVisibleEssayReviewHistory,
  selectCanonicalEssayReview
} from '../src/services/essay-grading/review-history.js';

function createFixtureDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(schemaSql);

  const teacherUserId = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run('teacher-a', 'x', 'teacher', '陈老师').lastInsertRowid;
  const studentUserId = database.prepare('INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)').run('student-a', 'x', 'student', '陈振聪').lastInsertRowid;
  const teacherId = database.prepare('INSERT INTO teachers (user_id, title) VALUES (?, ?)').run(teacherUserId, '语文教师').lastInsertRowid;
  const studentId = database.prepare('INSERT INTO students (user_id, student_no, grade) VALUES (?, ?, ?)').run(studentUserId, '503001', '高一').lastInsertRowid;
  const classId = database.prepare('INSERT INTO classes (name, grade, teacher_id) VALUES (?, ?, ?)').run('高一（3）班', '高一', teacherId).lastInsertRowid;
  database.prepare('INSERT INTO class_students (class_id, student_id) VALUES (?, ?)').run(classId, studentId);
  const assignmentId = database.prepare('INSERT INTO assignments (class_id, title, prompt, essay_type, full_score) VALUES (?, ?, ?, ?, ?)').run(classId, '周练', '写一篇作文。', '作文', 60).lastInsertRowid;
  const essayId = database.prepare('INSERT INTO essays (assignment_id, student_id, title, original_text, status, grading_status, created_at, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    assignmentId,
    studentId,
    '周练',
    '这是一篇作文。',
    'submitted',
    'graded',
    '2026-07-23 09:00:00',
    '2026-07-23 09:00:00'
  ).lastInsertRowid;

  return { database, essayId };
}

function insertReview(database, essayId, {
  id,
  versionNumber,
  totalScore,
  level,
  rawJson,
  gradingJobId = `job-${id}`
}) {
  database.prepare(`
    INSERT INTO ai_reviews (
      id, essay_id, version_number, report_version, prompt_version, prompt_text, prompt_mode,
      model, source_type, grading_job_id, rerun_reason, created_by_user_id, created_by_role,
      total_score, level, dimension_scores, strengths, problems, paragraph_comments,
      editable_sentences, suggestions, upgraded_paragraph, good_sentences, next_training, raw_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).run(
    id,
    essayId,
    versionNumber,
    '2.0',
    'p-1',
    '提示词',
    'web',
    'deepseek-chat',
    'web',
    gradingJobId,
    '',
    '',
    '',
    totalScore,
    level,
    JSON.stringify([{ name: '审题立意', score: 20, full: 20 }]),
    JSON.stringify(['优点']),
    JSON.stringify(['问题']),
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify(['建议']),
    '升格文章',
    JSON.stringify([]),
    JSON.stringify(['追问']),
    JSON.stringify(rawJson)
  );
}

test('canonical review selection prefers the latest complete result over a later failed retry', () => {
  const { database, essayId } = createFixtureDatabase();
  insertReview(database, essayId, {
    id: 1,
    versionNumber: 1,
    totalScore: 48,
    level: '二类文',
    rawJson: {
      totalScore: 48,
      grade: '二类文',
      dimensionScores: [{ name: '审题立意', score: 20, full: 20 }],
      thesisAnalysis: '立意清楚',
      contentAnalysis: '内容充实',
      structureAnalysis: '结构完整',
      languageAnalysis: '语言顺畅',
      materialAnalysis: '素材恰当',
      strengths: ['优点'],
      weakSpots: ['问题'],
      typoAnalysis: ['无'],
      sentenceIssues: ['无'],
      revisionSuggestions: ['建议'],
      socraticQuestions: ['为什么这样写？'],
      upgradedEssay: '升格文章',
      summary: '总评',
      reportMetadata: { model: 'deepseek-chat', gradingVersion: 'p1' }
    },
    gradingJobId: 'grading-job-1'
  });
  insertReview(database, essayId, {
    id: 2,
    versionNumber: 2,
    totalScore: 0,
    level: '',
    rawJson: {
      totalScore: 0,
      grade: '',
      dimensionScores: [],
      thesisAnalysis: '',
      contentAnalysis: '',
      structureAnalysis: '',
      languageAnalysis: '',
      materialAnalysis: '',
      strengths: [],
      weakSpots: [],
      typoAnalysis: [],
      sentenceIssues: [],
      revisionSuggestions: [],
      socraticQuestions: [],
      upgradedEssay: '',
      summary: '',
      reportMetadata: { model: 'deepseek-chat', gradingVersion: 'p1' }
    },
    gradingJobId: 'grading-job-2'
  });

  const selected = selectCanonicalEssayReview(database, essayId);
  const visible = listVisibleEssayReviewHistory(database, essayId);

  assert.equal(selected.id, 1);
  assert.equal(selected.total_score, 48);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, 1);
});

test('canonical review selection keeps the latest success when multiple successful versions exist', () => {
  const { database, essayId } = createFixtureDatabase();
  insertReview(database, essayId, {
    id: 11,
    versionNumber: 1,
    totalScore: 46,
    level: '三类文',
    rawJson: {
      totalScore: 46,
      grade: '三类文',
      dimensionScores: [{ name: '审题立意', score: 18, full: 20 }],
      thesisAnalysis: '立意清楚',
      contentAnalysis: '内容较充实',
      structureAnalysis: '结构完整',
      languageAnalysis: '语言顺畅',
      materialAnalysis: '素材恰当',
      strengths: ['优点'],
      weakSpots: ['问题'],
      typoAnalysis: ['无'],
      sentenceIssues: ['无'],
      revisionSuggestions: ['建议'],
      socraticQuestions: ['为什么这样写？'],
      upgradedEssay: '旧版升格文章',
      summary: '旧总评',
      reportMetadata: { model: 'deepseek-chat', gradingVersion: 'p1' }
    },
    gradingJobId: 'grading-job-11'
  });
  insertReview(database, essayId, {
    id: 12,
    versionNumber: 2,
    totalScore: 50,
    level: '二类文',
    rawJson: {
      totalScore: 50,
      grade: '二类文',
      dimensionScores: [{ name: '审题立意', score: 20, full: 20 }],
      thesisAnalysis: '立意更好',
      contentAnalysis: '内容更充实',
      structureAnalysis: '结构更完整',
      languageAnalysis: '语言更顺畅',
      materialAnalysis: '素材更恰当',
      strengths: ['优点'],
      weakSpots: ['问题'],
      typoAnalysis: ['无'],
      sentenceIssues: ['无'],
      revisionSuggestions: ['建议'],
      socraticQuestions: ['为什么这样写？'],
      upgradedEssay: '新版升格文章',
      summary: '新总评',
      reportMetadata: { model: 'deepseek-chat', gradingVersion: 'p1' }
    },
    gradingJobId: 'grading-job-12'
  });

  const selected = selectCanonicalEssayReview(database, essayId);

  assert.equal(selected.id, 12);
  assert.equal(selected.total_score, 50);
});
