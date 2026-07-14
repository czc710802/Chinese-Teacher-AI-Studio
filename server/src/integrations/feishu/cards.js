const TITLE = 'Chinese Teacher AI Studio';

function baseCard(title, subtitle, elements = []) {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: {
        tag: 'plain_text',
        content: title
      },
      subtitle: subtitle
        ? {
            tag: 'plain_text',
            content: subtitle
          }
        : undefined
    },
    elements
  };
}

function textElement(content) {
  return {
    tag: 'div',
    text: {
      tag: 'lark_md',
      content
    }
  };
}

function buttonElement(text, value, type = 'primary') {
  const button = {
    tag: 'button',
    text: {
      tag: 'plain_text',
      content: text
    },
    type
  };
  if (typeof value === 'object' && value?.url) {
    button.url = value.url;
    return button;
  }
  button.value = typeof value === 'object' ? value : { command: value };
  return button;
}

function stringifyPreview(item) {
  if (item == null || item === '') return '';
  if (typeof item === 'string') return item;
  if (typeof item === 'number' || typeof item === 'boolean') return String(item);
  if (Array.isArray(item)) return item.map(stringifyPreview).filter(Boolean).join('；');
  return item.focus || item.title || item.diagnosis || item.task || item.revision || item.reason || item.comment || JSON.stringify(item);
}

function previewList(items = [], limit = 3) {
  return (Array.isArray(items) ? items : [items])
    .slice(0, limit)
    .map(stringifyPreview)
    .filter(Boolean)
    .join('；') || '暂无';
}

function previewText(value = '', fallback = '暂无') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  const sentence = text.match(/^(.{1,80}?[。！？!?；;，,])(?=\s|$)/)?.[1];
  return (sentence || text.slice(0, 80)).trim();
}

function normalizePageList(value, fallback = '暂无') {
  const items = Array.isArray(value) ? value : [value].filter((item) => item !== undefined && item !== null && item !== '');
  if (!items.length) return fallback;
  return items.map((item) => `- ${stringifyPreview(item)}`).join('\n');
}

function normalizeParagraphs(value, fallback = '暂无') {
  const text = normalizePageList(value, fallback);
  return text === fallback ? fallback : text;
}

function collectParagraphItems(result = {}) {
  if (Array.isArray(result.paragraphAnalysis)) return result.paragraphAnalysis;
  if (Array.isArray(result.paragraphRefinements)) return result.paragraphRefinements;
  if (Array.isArray(result.paragraph_comments)) return result.paragraph_comments;
  return [];
}

export function parseEssayCardActionValue(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return { command: String(value) };
  }
}

function buildEssayReportPages(result = {}) {
  return [
    {
      title: '总评与评分',
      body: [
        `**总分**：${result.totalScore ?? result.score?.total ?? '暂无'} / ${result.fullScore ?? result.score?.max ?? 60}`,
        `**等级**：${result.level || result.score?.level || '暂无'}`,
        `**一句话总评**：${previewText(result.overallEvaluation || result.teacherComment || result.teacher_overall || result.summary?.overallComment || '')}`,
        `**主要优点**：${previewList(result.coreAdvantages || result.strengths || result.summary?.mainStrengths || [], 3)}`,
        `**核心问题**：${previewList(result.mainProblems || result.problems || result.summary?.mainProblems || [], 3)}`,
        `**优先修改方向**：${previewList(result.nextTraining || result.suggestions || result.summary?.priorityImprovements || [], 3)}`
      ]
    },
    {
      title: '审题与立意',
      body: [
        `**审题立意**：${previewText(result.topicIntentAnalysis || result.intentAnalysis || result.dimensions?.theme || result.dimensions?.content || '')}`,
        `**内容质量**：${previewText(result.materialAnalysis || result.contentAnalysis || result.dimensions?.content || '')}`,
        `**素材使用**：${previewText(result.materialAnalysis || result.recommendedMaterials || '')}`
      ]
    },
    {
      title: '内容与结构',
      body: [
        `**结构层次**：${previewText(result.structureAnalysis || result.dimensions?.structure || '')}`,
        `**段落分析**：${normalizeParagraphs(result.paragraphAnalysis || result.paragraphRefinements || result.paragraph_comments || [], '暂无段落点评')}`,
        `**开头与结尾**：${previewText(result.openingRevision || result.endingRevision || result.polishedFullText || result.excellentVersion || '')}`
      ]
    },
    {
      title: '逻辑与论证',
      body: [
        `**逻辑分析**：${previewText(result.logicAnalysisText || result.logicAnalysis?.centralClaim || result.logicAnalysis || '')}`,
        `**论证有效性**：${previewText(result.logicAnalysis?.reasoningChain || result.logicAnalysis?.depthSuggestions || result.logicAnalysis || '')}`,
        `**逻辑问题**：${normalizePageList(result.logicAnalysis?.logicalBreaks || result.mainProblems || [], '暂无逻辑问题')}`
      ]
    },
    {
      title: '语言与表达',
      body: [
        `**语言分析**：${previewText(result.languageAnalysis || result.dimensions?.language || '')}`,
        `**错别字与病句**：${normalizePageList(result.typos || result.languageIssues || [], '暂无错别字或病句')}`,
        `**亮点句子**：${normalizePageList(result.goodSentences || [], '暂无亮点句子')}`
      ]
    },
    {
      title: '逐段点评 1',
      body: normalizeParagraphs(collectParagraphItems(result).slice(0, 3), '暂无逐段点评')
    },
    {
      title: '逐段点评 2',
      body: normalizeParagraphs(collectParagraphItems(result).slice(3), '暂无更多逐段点评')
    },
    {
      title: '错别字与病句',
      body: [
        `**错别字**：${normalizePageList(result.typos || [], '暂无错别字')}`,
        `**病句**：${normalizePageList(result.languageIssues || [], '暂无病句')}`,
        `**标点**：${previewText(result.writingStandard || result.dimensions?.writingStandard || '')}`
      ]
    },
    {
      title: '修改方案',
      body: [
        `**修改计划**：${normalizePageList(result.revisionPlan || result.nextTraining || result.suggestions || [], '暂无修改方案')}`,
        `**教师审核**：${previewText(result.teacherReview?.comment || result.teacherComment || result.teacher_overall || '')}`,
        `**最终评分**：${result.teacherReview?.finalScore ?? '暂无'}`
      ]
    },
    {
      title: '示范修改',
      body: [
        `**关键段落示例**：${normalizePageList(result.exampleRevisions || result.rewrittenParagraphs || result.paragraphRefinements || [], '暂无示范修改')}`,
        `**升格文章**：${previewText(result.polishedFullText || result.excellentVersion || '', '暂无')}`
      ]
    }
  ];
}

export function buildEssayReportPageCard(result = {}, { links = {}, archiveId = '', page = 1, totalPages, title = '作文 AI 分页批改报告' } = {}) {
  const pages = buildEssayReportPages(result);
  const maxPages = totalPages && Number.isFinite(Number(totalPages)) ? Math.max(1, Number(totalPages)) : pages.length;
  const currentPage = Math.min(Math.max(1, Number(page) || 1), maxPages);
  const current = pages[currentPage - 1] || pages[0];
  const actions = [];
  if (currentPage > 1) {
    actions.push(buttonElement('上一页', { command: 'essay-report-page', archiveId, page: currentPage - 1 }, 'default'));
  }
  if (currentPage < maxPages) {
    actions.push(buttonElement('下一页', { command: 'essay-report-page', archiveId, page: currentPage + 1 }, 'default'));
  }
  actions.push(buttonElement('返回总览', { command: 'essay-report-overview', archiveId }, 'default'));
  if (links.reportUrl) {
    actions.push(buttonElement('打开完整网页报告', { url: links.reportUrl }, 'default'));
  }
  if (links.pdfUrl) {
    actions.push(buttonElement('下载 PDF', { url: links.pdfUrl }, 'default'));
  }
  if (links.docxUrl) {
    actions.push(buttonElement('下载 Word', { url: links.docxUrl }, 'default'));
  }

  return baseCard(title, `第 ${currentPage} 页 / 共 ${maxPages} 页`, [
    textElement(`**页面**：${current.title}`),
    ...(Array.isArray(current.body) ? current.body.map((item) => textElement(item)) : [textElement(String(current.body || '暂无'))]),
    {
      tag: 'action',
      actions
    }
  ]);
}

export function buildHelpCard() {
  return baseCard(TITLE, '飞书命令菜单', [
    textElement('**帮助 / /help**  \n查看可用命令。'),
    textElement('**状态 / /status**  \n查看系统运行状态。'),
    textElement('**作文 / /essay**  \n进入作文 AI。'),
    textElement('**日报 / /daily**  \n查看最近日报。'),
    textElement('**备份 / /backup**  \n触发一次备份。'),
    textElement('**日志 / /logs**  \n查看最近错误摘要。'),
      {
        tag: 'action',
        actions: [
          buttonElement('帮助', 'help'),
          buttonElement('状态', 'status'),
          buttonElement('作文', 'essay'),
          buttonElement('日报', 'daily'),
          buttonElement('备份', 'backup'),
          buttonElement('日志', 'logs'),
          buttonElement('重启', 'restart')
        ]
      }
    ]);
}

export function buildEssayMenuCard() {
  return baseCard('Chinese Teacher AI Studio｜作文 AI', '作文入口', [
    textElement('**直接粘贴作文**  \n发送 `作文：正文` 或 `/essay 正文`。'),
    textElement('**上传作文图片**  \n选择图片后提交。'),
    textElement('**上传 Word/PDF**  \n先保存文件，再进入识别与批改。'),
    textElement('**查看最近批改**  \n读取最近 20 条记录。'),
    textElement('**查看批改标准**  \n查看当前作文评分标准。'),
    {
      tag: 'action',
      actions: [
        buttonElement('直接粘贴作文', 'essay'),
        buttonElement('上传作文图片', 'essay-upload'),
        buttonElement('上传 Word/PDF', 'essay-upload'),
        buttonElement('查看最近批改', 'essay-history'),
        buttonElement('查看批改标准', 'essay-standard', 'default')
      ]
    }
  ]);
}

export function buildEssayResultCard(result = {}, { links = {} } = {}) {
  const advantages = previewList(result.coreAdvantages || result.strengths || [], 3);
  const problems = previewList(result.mainProblems || result.problems || result.weaknesses || [], 3);
  const suggestions = previewList(result.nextTraining || result.suggestions || [], 3);
  const overallComment = previewText(result.overallEvaluation || result.teacherComment || result.teacher_overall || '');
  const actions = [];
  if (links.reportUrl) actions.push(buttonElement('查看完整报告', { url: links.reportUrl }));
  else if (links.archiveId) actions.push(buttonElement('查看完整报告', { command: 'essay-report-page', archiveId: links.archiveId, page: 1 }));
  actions.push(buttonElement('查看分项评分', { command: 'essay-report-page', archiveId: links.archiveId || '', page: 2 }, 'default'));
  actions.push(buttonElement('查看逐段点评', { command: 'essay-report-page', archiveId: links.archiveId || '', page: 6 }, 'default'));
  actions.push(buttonElement('查看逻辑分析', { command: 'essay-report-page', archiveId: links.archiveId || '', page: 4 }, 'default'));
  actions.push(buttonElement('查看修改示例', { command: 'essay-report-page', archiveId: links.archiveId || '', page: 10 }, 'default'));
  if (links.docxUrl) actions.push(buttonElement('下载 Word', { url: links.docxUrl }, 'default'));
  if (links.pdfUrl) actions.push(buttonElement('下载 PDF', { url: links.pdfUrl }, 'default'));
  if (links.profileUrl) actions.push(buttonElement('查看成长档案', { url: links.profileUrl }, 'default'));
  if (!actions.length) {
    actions.push(
      buttonElement('查看完整报告', 'essay-result'),
      buttonElement('查看分项评分', 'essay-report-page', 'default'),
      buttonElement('查看逐段点评', 'essay-report-page', 'default'),
      buttonElement('查看逻辑分析', 'essay-report-page', 'default'),
      buttonElement('查看修改示例', 'essay-report-page', 'default'),
      buttonElement('加入学生档案', 'essay-profile', 'default')
    );
  }

  return baseCard('作文 AI 批改结果', 'Chinese Teacher AI Studio', [
    textElement(`**总分**：${result.totalScore ?? '暂无'} / ${result.fullScore ?? 60}`),
    textElement(`**等级**：${result.level || '暂无'}`),
    textElement(`**一句话总评**：${overallComment}`),
    textElement(`**核心优点**：${advantages}`),
    textElement(`**主要问题**：${problems}`),
    textElement(`**修改建议**：${suggestions}`),
    textElement(`**下一步训练**：${Array.isArray(result.nextTraining) && result.nextTraining.length ? result.nextTraining[0] : '暂无'}`),
    {
      tag: 'action',
      actions
    }
  ]);
}

export function buildStatusCard(status = {}) {
  return baseCard(TITLE, '系统运行状态', [
    textElement(`**版本**：${status.version || 'unknown'}`),
    textElement(`**后端**：${status.nodeStatus || 'unknown'}`),
    textElement(`**Server**：${status.server || 'unknown'}`),
    textElement(`**Cloudflare Tunnel**：${status.cloudflaredStatus || 'unknown'}`),
    textElement(`**Watchdog**：${status.watchdogStatus || 'unknown'}`),
    textElement(`**备份**：${status.backup || 'unknown'}`),
    textElement(`**资源监控**：${status.resourceMonitor || 'unknown'}`),
    textElement(`**日报**：${status.dailyReport || 'unknown'}`),
    textElement(`**最近备份**：${status.latestBackup?.path || 'none'}`),
    textElement(`**最近日报**：${status.latestDailyReport?.path || 'none'}`),
    textElement(`**本地健康**：${status.localHealth?.ok ? 'PASS' : 'FAIL'}`),
    textElement(`**公网健康**：${status.publicHealth?.ok ? 'PASS' : 'FAIL'}`),
    textElement(`**磁盘使用率**：${status.diskUsage?.capacity || status.diskUsage?.usedPercent || 'unknown'}`)
  ]);
}

export function buildTeacherBindingRequiredCard({ publicOrigin = 'https://pi.zhenwanyue.icu' } = {}) {
  return baseCard('绑定教师身份', 'Chinese Teacher AI Studio', [
    textElement('你还没有绑定教师身份。请向管理员获取一次性教师绑定码。'),
    textElement('收到绑定码后，在本聊天中发送：`绑定教师 TCH-XXXX-XXXX`。'),
    textElement('绑定码短期有效、只能使用一次；系统不会通过姓名或 URL 参数绑定身份。'),
    {
      tag: 'action',
      actions: [
        buttonElement('打开教师端', { url: `${publicOrigin.replace(/\/+$/, '')}/teacher` }),
        buttonElement('系统状态', 'status', 'default')
      ]
    }
  ]);
}

export function buildTeacherBindSuccessCard(summary = {}, { publicOrigin = 'https://pi.zhenwanyue.icu' } = {}) {
  return baseCard('教师身份绑定成功', 'Chinese Teacher AI Studio', [
    textElement(`**教师**：${summary.teacherName || '已绑定教师'}`),
    textElement('现在可以发送 `/workbench` 打开飞书教师工作台。'),
    {
      tag: 'action',
      actions: [
        buttonElement('打开工作台', 'workbench'),
        buttonElement('进入教师端', { url: `${publicOrigin.replace(/\/+$/, '')}/teacher` }, 'default')
      ]
    }
  ]);
}

export function buildTeacherWorkbenchCard(summary = {}, { publicOrigin = 'https://pi.zhenwanyue.icu' } = {}) {
  const origin = String(publicOrigin || 'https://pi.zhenwanyue.icu').replace(/\/+$/, '');
  return baseCard('教师工作台', 'Chinese Teacher AI Studio', [
    textElement(`**教师**：${summary.teacherName || '未识别'}`),
    textElement(`**飞书绑定状态**：${summary.bound ? '已绑定' : '未绑定'}`),
    textElement(`**负责班级**：${summary.classCount ?? 0} 个；**已绑定飞书群**：${summary.boundGroupCount ?? 0} 个`),
    textElement(`**今日截止作业**：${summary.todayDueAssignments ?? 0} 个`),
    textElement(`**待批改**：${summary.pendingGradingCount ?? 0} 篇；**待审核报告**：${summary.pendingReviewCount ?? 0} 篇`),
    textElement(`**未交学生**：${summary.missingStudentCount ?? 0} 人次`),
    textElement(`**系统状态摘要**：${summary.systemStatus || '正常'}`),
    {
      tag: 'action',
      actions: [
        buttonElement('新建作文任务', { url: `${origin}/assignments/new` }),
        buttonElement('我的班级', { url: `${origin}/teacher/classes` }),
        buttonElement('提交进度', { url: `${origin}/teacher/essays` }),
        buttonElement('待审核报告', { url: `${origin}/teacher/reviews` })
      ]
    },
    textElement(`**学生成长档案**：${origin}/student-profiles  \n**班级统计**：${origin}/teacher/classes  \n**AI 备课：建设中**  \n**AI 命题：建设中**  \n**AI PPT：建设中**  \n**教学知识库：建设中**`),
    {
      tag: 'action',
      actions: [
        buttonElement('班级群绑定', { url: `${origin}/teacher/feishu/classes` }, 'default'),
        buttonElement('系统状态', 'status', 'default')
      ]
    }
  ]);
}

export function buildDailyReportCard({ reportPath = '', summary = '' } = {}) {
  return baseCard(TITLE, '最近日报', [
    textElement(`**路径**：${reportPath || '未找到日报'}`),
    textElement(summary ? `**摘要**：${summary}` : '暂无摘要')
  ]);
}

export function buildLogsCard({ summary = '' } = {}) {
  return baseCard(TITLE, '最近错误摘要', [
    textElement(summary || '暂无错误摘要')
  ]);
}

export function buildBackupCard({ ok = false, path = '', message = '' } = {}) {
  return baseCard(TITLE, '备份结果', [
    textElement(`**结果**：${ok ? '成功' : '失败'}`),
    textElement(path ? `**路径**：${path}` : '**路径**：未生成'),
    textElement(message ? `**说明**：${message}` : '**说明**：无'),
  ]);
}

export function buildRestartCard({ confirmToken = '' } = {}) {
  return baseCard(TITLE, '重启确认', [
    textElement('**提示**：已收到重启请求，为避免误操作，需要二次确认。'),
    textElement(confirmToken ? `**确认口令**：${confirmToken}` : '**确认口令**：未配置'),
  ]);
}

export function buildReservedCard(name) {
  return baseCard(TITLE, `${name} 功能预留`, [
    textElement('功能入口已预留，将在 V11.1 接入')
  ]);
}

export { buildEssayReportPages };
