import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildEssayReportPageCard,
  parseEssayCardActionValue
} from '../src/integrations/feishu/cards.js';

test('feishu report page cards expose pager actions and page metadata', () => {
  const card = buildEssayReportPageCard({
    totalScore: 54,
    fullScore: 60,
    level: '一类文',
    overallEvaluation: '立意明确，论证完整。',
    strengths: ['观点清晰', '结构完整', '语言自然'],
    problems: ['论证展开略浅'],
    suggestions: ['补强因果链', '增加反方回应']
  }, {
    archiveId: 'archive-1',
    page: 2,
    totalPages: 10,
    links: {
      reportUrl: 'https://pi.zhenwanyue.icu/report/archive-1',
      pdfUrl: 'https://pi.zhenwanyue.icu/api/files/archive-1/pdf',
      docxUrl: 'https://pi.zhenwanyue.icu/api/files/archive-1/docx'
    }
  });

  const serialized = JSON.stringify(card);
  assert.match(serialized, /第 2 页/);
  assert.match(serialized, /essay-report-page/);
  assert.match(serialized, /essay-report-overview/);
  assert.match(serialized, /上一页/);
  assert.match(serialized, /下一页/);
  assert.match(serialized, /查看归档报告/);
});

test('feishu card action values can be parsed from json strings', () => {
  const value = parseEssayCardActionValue('{"command":"essay-report-page","archiveId":"archive-1","page":3}');
  assert.equal(value.command, 'essay-report-page');
  assert.equal(value.archiveId, 'archive-1');
  assert.equal(value.page, 3);
});
