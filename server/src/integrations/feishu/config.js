const DEFAULT_BOT_NAME = 'Chinese Teacher AI Studio';

function normalize(value) {
  return String(value || '').trim();
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
  const fileUploadEnabled = ['1', 'true', 'yes', 'on'].includes(normalize(env.FEISHU_FILE_UPLOAD_ENABLED).toLowerCase());
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
    fileUploadEnabled
  };
}
