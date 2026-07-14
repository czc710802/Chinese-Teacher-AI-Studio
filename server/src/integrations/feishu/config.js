const DEFAULT_BOT_NAME = 'Chinese Teacher AI Studio';

function normalize(value) {
  return String(value || '').trim();
}

function parseBoolean(value, fallback = false) {
  const normalized = normalize(value).toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
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
    maxMessageLength
  };
}
