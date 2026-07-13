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
  button.value = { command: value };
  return button;
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
  const advantages = Array.isArray(result.coreAdvantages) && result.coreAdvantages.length ? result.coreAdvantages.slice(0, 2).join('；') : '暂无';
  const problems = Array.isArray(result.mainProblems) && result.mainProblems.length ? result.mainProblems.slice(0, 2).join('；') : '暂无';
  const suggestions = Array.isArray(result.nextTraining) && result.nextTraining.length ? result.nextTraining.slice(0, 2).join('；') : '暂无';
  const actions = [];
  if (links.reportUrl) actions.push(buttonElement('查看完整报告', { url: links.reportUrl }));
  if (links.docxUrl) actions.push(buttonElement('下载 Word', { url: links.docxUrl }, 'default'));
  if (links.pdfUrl) actions.push(buttonElement('下载 PDF', { url: links.pdfUrl }, 'default'));
  if (links.profileUrl) actions.push(buttonElement('查看成长档案', { url: links.profileUrl }, 'default'));
  if (!actions.length) {
    actions.push(
      buttonElement('查看完整报告', 'essay-result'),
      buttonElement('下载 Word', 'essay-download-word', 'default'),
      buttonElement('下载 PDF', 'essay-download-pdf', 'default'),
      buttonElement('加入学生档案', 'essay-profile', 'default')
    );
  }

  return baseCard('作文 AI 批改结果', 'Chinese Teacher AI Studio', [
    textElement(`**总分**：${result.totalScore ?? '暂无'} / ${result.fullScore ?? 60}`),
    textElement(`**等级**：${result.level || '暂无'}`),
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
