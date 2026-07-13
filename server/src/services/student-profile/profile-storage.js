import fs from 'node:fs';
import path from 'node:path';
import { sanitizePathSegment } from '../zspace-storage.js';
import { enqueueProfileUpdate } from './profile-queue.js';

export const PROFILE_VERSION = '1.0';

export function profileRoot(appDir) {
  return path.join(appDir, 'data', 'student-profiles');
}

export function profileLocalDir(appDir, className, studentKey) {
  return path.join(profileRoot(appDir), sanitizePathSegment(className || '未填写'), sanitizePathSegment(studentKey || 'anonymous'));
}

export function profileRemoteBase(className, studentKey) {
  return path.posix.join('02_学生档案', sanitizePathSegment(className || '未填写'), sanitizePathSegment(studentKey || 'anonymous'));
}

export function atomicWriteJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, filePath);
}

export function atomicWriteText(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, String(text || ''), 'utf8');
  fs.renameSync(tmp, filePath);
}

export function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function contentTypeFor(name) {
  if (name.endsWith('.json')) return 'application/json; charset=utf-8';
  if (name.endsWith('.md')) return 'text/markdown; charset=utf-8';
  if (name.endsWith('.pdf')) return 'application/pdf';
  if (name.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}

export async function uploadProfileDirectory({ appDir, client, archiveId, studentKey, className, localDir, logger = console } = {}) {
  const remoteBase = profileRemoteBase(className, studentKey);
  if (!client?.config?.enabled) return { uploaded: false, skipped: true, remoteBase };
  try {
    await client.ensureDirectory?.(remoteBase);
    for (const name of fs.readdirSync(localDir)) {
      const filePath = path.join(localDir, name);
      if (!fs.statSync(filePath).isFile()) continue;
      const remotePath = path.posix.join(remoteBase, name);
      await client.deleteFile?.(remotePath).catch(() => {});
      await client.uploadBuffer(remotePath, fs.readFileSync(filePath), contentTypeFor(name));
    }
    const reportsDir = path.join(localDir, 'reports');
    if (fs.existsSync(reportsDir)) {
      await client.ensureDirectory?.(path.posix.join(remoteBase, 'reports'));
      for (const name of fs.readdirSync(reportsDir)) {
        const filePath = path.join(reportsDir, name);
        if (!fs.statSync(filePath).isFile()) continue;
          const remotePath = path.posix.join(remoteBase, 'reports', name);
          await client.deleteFile?.(remotePath).catch(() => {});
          await client.uploadBuffer(remotePath, fs.readFileSync(filePath), contentTypeFor(name));
      }
    }
    return { uploaded: true, queued: false, remoteBase };
  } catch (error) {
    const task = enqueueProfileUpdate({ appDir, archiveId, studentKey, className, localDir, remoteBase, error });
    logger.warn?.('学生成长档案 NAS 同步失败，已进入队列', { studentKey, message: String(error?.message || error).slice(0, 200) });
    return { uploaded: false, queued: true, remoteBase, task };
  }
}
