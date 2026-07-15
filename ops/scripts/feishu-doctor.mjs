#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { loadServerEnv } from '../../server/src/config/env.js';
import { loadFeishuConfig } from '../../server/src/integrations/feishu/config.js';
import { getTenantAccessToken } from '../../server/src/integrations/feishu/client.js';
import { createZSpaceClient } from '../../server/src/services/zspace-storage.js';
import { sectionsToDocxBuffer, sectionsToPdfBuffer } from '../../server/src/services/exporter.js';
import { getPublicAccessStatus } from '../../server/src/services/public-access.js';
import { db } from '../../server/src/db/connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');
const reportDir = path.join(appDir, 'reports', 'feishu-doctor');

function statusLabel(ok, warn = false) {
  if (ok === true) return 'PASS';
  if (warn) return 'WARN';
  return 'FAIL';
}

function printCheck(label, ok, detail = '', warn = false) {
  const prefix = statusLabel(ok, warn);
  console.log(`${prefix} ${label}${detail ? ` - ${detail}` : ''}`);
}

function presence(value) {
  if (value == null) return 'MISSING';
  return String(value).trim() === '' ? 'EMPTY' : 'SET';
}

function parseBoolean(value, fallback = false) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const bodyText = await response.text();
  let bodyJson = null;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    bodyJson = null;
  }
  return { status: response.status, ok: response.ok, bodyText, bodyJson };
}

function safeGitCheck(filePath) {
  try {
    const result = execFileSync('git', ['ls-files', '--error-unmatch', filePath], {
      cwd: appDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return Boolean(String(result || '').trim());
  } catch {
    return false;
  }
}

function redactSummary(env) {
  return {
    FEISHU_APP_ID: presence(env.FEISHU_APP_ID),
    FEISHU_APP_SECRET: presence(env.FEISHU_APP_SECRET),
    FEISHU_VERIFICATION_TOKEN: presence(env.FEISHU_VERIFICATION_TOKEN),
    FEISHU_ENCRYPT_KEY: presence(env.FEISHU_ENCRYPT_KEY),
    FEISHU_FILE_UPLOAD_ENABLED: presence(env.FEISHU_FILE_UPLOAD_ENABLED),
    FEISHU_REPORT_CARD_ENABLED: presence(env.FEISHU_REPORT_CARD_ENABLED),
    FEISHU_REPORT_PAGINATION_ENABLED: presence(env.FEISHU_REPORT_PAGINATION_ENABLED),
    FEISHU_FILE_LINK_SECRET: presence(env.FEISHU_FILE_LINK_SECRET),
    FEISHU_FILE_LINK_TTL_SECONDS: presence(env.FEISHU_FILE_LINK_TTL_SECONDS),
    FEISHU_BUSINESS_ENABLED: presence(env.FEISHU_BUSINESS_ENABLED),
    FEISHU_STUDENT_SUBMISSION_ENABLED: presence(env.FEISHU_STUDENT_SUBMISSION_ENABLED),
    FEISHU_TEACHER_REVIEW_ENABLED: presence(env.FEISHU_TEACHER_REVIEW_ENABLED),
    FEISHU_REGRADING_ENABLED: presence(env.FEISHU_REGRADING_ENABLED),
    FEISHU_SYSTEM_NOTIFICATION_ENABLED: presence(env.FEISHU_SYSTEM_NOTIFICATION_ENABLED),
    FEISHU_REPORT_PUBLIC_BASE_URL: presence(env.FEISHU_REPORT_PUBLIC_BASE_URL)
  };
}

async function main() {
  loadServerEnv({ appDir, nodeEnv: 'production' });
  const env = process.env;
  const config = loadFeishuConfig(env);
  const publicStatus = getPublicAccessStatus({ appDir, env });

  console.log('== Feishu Doctor ==');
  console.log(JSON.stringify(redactSummary(env), null, 2));

  printCheck('FEISHU_APP_ID', Boolean(env.FEISHU_APP_ID));
  printCheck('FEISHU_APP_SECRET', Boolean(env.FEISHU_APP_SECRET));
  printCheck('FEISHU_VERIFICATION_TOKEN', Boolean(env.FEISHU_VERIFICATION_TOKEN), '用于事件签名校验', true);
  printCheck('FEISHU_ENCRYPT_KEY', Boolean(env.FEISHU_ENCRYPT_KEY), '仅在加密回调时必需', true);
  printCheck('FEISHU_FILE_UPLOAD_ENABLED', parseBoolean(env.FEISHU_FILE_UPLOAD_ENABLED), `effective=${config.fileUploadEnabled}`);
  printCheck(
    'FEISHU_REPORT_CARD_ENABLED',
    'FEISHU_REPORT_CARD_ENABLED' in env || config.reportCardEnabled,
    `effective=${config.reportCardEnabled}`,
    !('FEISHU_REPORT_CARD_ENABLED' in env)
  );
  printCheck(
    'FEISHU_REPORT_PAGINATION_ENABLED',
    'FEISHU_REPORT_PAGINATION_ENABLED' in env || config.reportPaginationEnabled,
    `effective=${config.reportPaginationEnabled}`,
    !('FEISHU_REPORT_PAGINATION_ENABLED' in env)
  );
  printCheck('FEISHU_FILE_LINK_SECRET', Boolean(env.FEISHU_FILE_LINK_SECRET));
  printCheck('FEISHU_FILE_LINK_TTL_SECONDS', Boolean(env.FEISHU_FILE_LINK_TTL_SECONDS), `value=${String(env.FEISHU_FILE_LINK_TTL_SECONDS || '86400').trim() || '86400'}`);
  printCheck('FEISHU_BUSINESS_ENABLED', Boolean('FEISHU_BUSINESS_ENABLED' in env || config.businessEnabled), `effective=${config.businessEnabled}`, !('FEISHU_BUSINESS_ENABLED' in env));
  printCheck('FEISHU_STUDENT_SUBMISSION_ENABLED', Boolean('FEISHU_STUDENT_SUBMISSION_ENABLED' in env || config.studentSubmissionEnabled), `effective=${config.studentSubmissionEnabled}`, !('FEISHU_STUDENT_SUBMISSION_ENABLED' in env));
  printCheck('FEISHU_TEACHER_REVIEW_ENABLED', Boolean('FEISHU_TEACHER_REVIEW_ENABLED' in env || config.teacherReviewEnabled), `effective=${config.teacherReviewEnabled}`, !('FEISHU_TEACHER_REVIEW_ENABLED' in env));
  printCheck('FEISHU_REGRADING_ENABLED', Boolean('FEISHU_REGRADING_ENABLED' in env || config.regradingEnabled), `effective=${config.regradingEnabled}`, !('FEISHU_REGRADING_ENABLED' in env));
  printCheck('FEISHU_SYSTEM_NOTIFICATION_ENABLED', Boolean('FEISHU_SYSTEM_NOTIFICATION_ENABLED' in env || config.systemNotificationEnabled), `effective=${config.systemNotificationEnabled}`, !('FEISHU_SYSTEM_NOTIFICATION_ENABLED' in env));
  printCheck(
    'FEISHU_REPORT_PUBLIC_BASE_URL',
    Boolean(env.FEISHU_REPORT_PUBLIC_BASE_URL || config.reportPublicBaseUrl || env.PUBLIC_APP_ORIGIN),
    `effective=${config.reportPublicBaseUrl || env.PUBLIC_APP_ORIGIN || 'https://pi.zhenwanyue.icu'}`,
    !env.FEISHU_REPORT_PUBLIC_BASE_URL
  );

  try {
    await db.prepare('SELECT 1 AS ok').get();
    printCheck('DATABASE', true, 'sqlite connected');
  } catch (error) {
    printCheck('DATABASE', false, String(error?.message || error || 'database error'));
  }

  try {
    fs.mkdirSync(reportDir, { recursive: true });
    const probe = path.join(reportDir, 'write-test.txt');
    fs.writeFileSync(probe, `feishu-doctor-${Date.now()}\n`, 'utf8');
    fs.unlinkSync(probe);
    printCheck('REPORT_DIR', true, reportDir);
  } catch (error) {
    printCheck('REPORT_DIR', false, String(error?.message || error || 'report dir not writable'));
  }

  try {
    const pdf = await sectionsToPdfBuffer('Feishu Doctor', [{ title: '检查', content: ['PDF 生成探针'] }]);
    const docx = await sectionsToDocxBuffer('Feishu Doctor', [{ title: '检查', content: ['DOCX 生成探针'] }]);
    printCheck('PDF_GENERATION', pdf.length > 0, `bytes=${pdf.length}`);
    printCheck('DOCX_GENERATION', docx.length > 0, `bytes=${docx.length}`);
  } catch (error) {
    printCheck('PDF/DOCX_GENERATION', false, String(error?.message || error || 'generation failed'));
  }

  try {
    const token = await getTenantAccessToken({ env });
    if (token.ok) {
      printCheck('TENANT_ACCESS_TOKEN', true, `expire=${String(token.expire || '')}`);
    } else {
      printCheck('TENANT_ACCESS_TOKEN', false, token.reason || 'token not available');
    }
  } catch (error) {
    printCheck('TENANT_ACCESS_TOKEN', false, String(error?.message || error || 'token request failed'));
  }

  const callbackUrl = `${publicStatus.url || env.PUBLIC_APP_ORIGIN || 'https://pi.zhenwanyue.icu'}/api/feishu/webhook`;
  try {
    const verificationBody = {
      type: 'url_verification',
      challenge: 'feishu-doctor',
      token: env.FEISHU_VERIFICATION_TOKEN || ''
    };
    const callback = await fetchJson(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(verificationBody)
    });
    printCheck('PUBLIC_CALLBACK', callback.status >= 200 && callback.status < 500, `status=${callback.status}`);
  } catch (error) {
    printCheck('PUBLIC_CALLBACK', false, String(error?.message || error || 'callback request failed'));
  }

  try {
    const healthUrl = `${publicStatus.url || env.PUBLIC_APP_ORIGIN || 'https://pi.zhenwanyue.icu'}/api/feishu/health`;
    const health = await fetchJson(healthUrl);
    printCheck('PUBLIC_HEALTH', health.status === 200, `status=${health.status}`);
  } catch (error) {
    printCheck('PUBLIC_HEALTH', false, String(error?.message || error || 'health request failed'));
  }

  try {
    const zspaceClient = createZSpaceClient({ env });
    const status = await zspaceClient.testConnection();
    printCheck('NAS_WEBDAV', Boolean(status.connected && status.writable), `baseUrl=${status.baseUrl || ''}`);
  } catch (error) {
    printCheck('NAS_WEBDAV', false, String(error?.message || error || 'webdav check failed'));
  }

  printCheck('CLOUDFLARE_DOMAIN', Boolean(publicStatus.enabled && publicStatus.url), `origin=${publicStatus.url || 'missing'}`);
  printCheck('GIT_SECRET_RISK', !(safeGitCheck('.env.production') || safeGitCheck('.env.local') || safeGitCheck('.env')), 'tracked env files should stay placeholder-only', true);

  console.log('== Summary ==');
  console.log(JSON.stringify({
    publicOrigin: publicStatus.url || '',
    reportBaseUrl: config.reportPublicBaseUrl || env.PUBLIC_APP_ORIGIN || 'https://pi.zhenwanyue.icu',
    fileUploadEnabled: config.fileUploadEnabled,
    businessEnabled: config.businessEnabled,
    studentSubmissionEnabled: config.studentSubmissionEnabled,
    teacherReviewEnabled: config.teacherReviewEnabled,
    regradingEnabled: config.regradingEnabled,
    systemNotificationEnabled: config.systemNotificationEnabled,
    reportCardEnabled: config.reportCardEnabled,
    reportPaginationEnabled: config.reportPaginationEnabled
  }, null, 2));
}

main().catch((error) => {
  console.error(`FAIL doctor - ${String(error?.message || error || 'unknown error')}`);
  process.exit(1);
});
