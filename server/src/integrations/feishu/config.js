const DEFAULT_BOT_NAME = 'Chinese Teacher AI Studio';

function normalize(value) {
  return String(value || '').trim();
}

function parseBoolean(value, fallback = false) {
  const normalized = normalize(value).toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function isProductionEnv(env = process.env) {
  return String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

export function isFeishuBusinessEnabled(env = process.env) {
  return parseBoolean(env.FEISHU_BUSINESS_ENABLED, !isProductionEnv(env));
}

export function buildFeishuBusinessMigrationNotice(env = process.env, {
  publicOrigin = env.PUBLIC_APP_ORIGIN || env.FEISHU_REPORT_PUBLIC_BASE_URL || 'https://pi.zhenwanyue.icu'
} = {}) {
  const origin = String(publicOrigin || 'https://pi.zhenwanyue.icu').trim().replace(/\/+$/, '') || 'https://pi.zhenwanyue.icu';
  return [
    '作文教学业务已迁移至 Chinese Teacher AI Studio 网页平台，请打开以下入口使用。',
    `教师入口：${origin}/teacher`,
    `学生入口：${origin}/student-mobile`
  ].join('\n');
}

export function loadFeishuConfig(env = process.env) {
  const appId = normalize(env.FEISHU_APP_ID);
  const appSecret = normalize(env.FEISHU_APP_SECRET);
  const verificationToken = normalize(env.FEISHU_VERIFICATION_TOKEN);
  const encryptKey = normalize(env.FEISHU_ENCRYPT_KEY);
  const webhookUrl = normalize(env.FEISHU_WEBHOOK_URL);
  const secret = normalize(env.FEISHU_SECRET);
  const botName = normalize(env.FEISHU_BOT_NAME) || DEFAULT_BOT_NAME;
  const requestedReplyMode = normalize(env.FEISHU_REPLY_MODE).toLowerCase();
  const replyMode = requestedReplyMode === 'reply' ? 'reply' : 'send';
  const restartConfirmToken = normalize(env.FEISHU_RESTART_CONFIRM_TOKEN);
  const fileUploadEnabled = parseBoolean(env.FEISHU_FILE_UPLOAD_ENABLED, false);
  const reportCardEnabled = parseBoolean(env.FEISHU_REPORT_CARD_ENABLED, true);
  const reportPaginationEnabled = parseBoolean(env.FEISHU_REPORT_PAGINATION_ENABLED, true);
  const reportPublicBaseUrl = normalize(env.FEISHU_REPORT_PUBLIC_BASE_URL);
  const reportSignedUrlEnabled = parseBoolean(env.REPORT_SIGNED_URL_ENABLED ?? env.FEISHU_REPORT_SIGNED_URL_ENABLED, true);
  const reportSignedUrlExpiresIn = Number(normalize(env.REPORT_SIGNED_URL_EXPIRES_IN || env.FEISHU_FILE_LINK_TTL_SECONDS || '86400') || 86400);
  const maxCardTextLength = Number(normalize(env.FEISHU_MAX_CARD_TEXT_LENGTH || '0') || 0);
  const maxMessageLength = Number(normalize(env.FEISHU_MAX_MESSAGE_LENGTH || '0') || 0);
  const businessEnabled = isFeishuBusinessEnabled(env);
  const studentSubmissionEnabled = parseBoolean(env.FEISHU_STUDENT_SUBMISSION_ENABLED, businessEnabled);
  const teacherReviewEnabled = parseBoolean(env.FEISHU_TEACHER_REVIEW_ENABLED, businessEnabled);
  const regradingEnabled = parseBoolean(env.FEISHU_REGRADING_ENABLED, businessEnabled);
  const systemNotificationEnabled = parseBoolean(env.FEISHU_SYSTEM_NOTIFICATION_ENABLED, true);
  const adminOpenIds = normalize(env.FEISHU_ADMIN_OPEN_IDS)
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    appId,
    appSecret,
    verificationToken,
    encryptKey,
    webhookUrl,
    secret,
    botName,
    replyMode,
    restartConfirmToken,
    adminOpenIds,
    appConfigured: Boolean(appId && appSecret),
    webhookConfigured: Boolean(webhookUrl),
    secretConfigured: Boolean(secret),
    fileUploadEnabled,
    reportCardEnabled,
    reportPaginationEnabled,
    reportPublicBaseUrl,
    reportSignedUrlEnabled,
    reportSignedUrlExpiresIn,
    maxCardTextLength,
    maxMessageLength,
    businessEnabled,
    studentSubmissionEnabled,
    teacherReviewEnabled,
    regradingEnabled,
    systemNotificationEnabled
  };
}
