import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function assertInside(baseDir, candidatePath) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedBase, resolvedCandidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('文件路径越界，已拒绝访问');
  }
  return resolvedCandidate;
}

export function writeFileAtomic(filePath, data) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, filePath);
  return filePath;
}

export function copyFileVerified(sourcePath, targetPath) {
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
  const sourceHash = sha256File(sourcePath);
  const targetHash = sha256File(targetPath);
  if (sourceHash !== targetHash) {
    throw new Error('文件 SHA-256 校验失败');
  }
  return { sourceHash, targetHash };
}
