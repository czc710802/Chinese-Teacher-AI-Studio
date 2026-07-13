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
