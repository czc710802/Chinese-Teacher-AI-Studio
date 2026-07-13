import fs from 'node:fs';
import path from 'node:path';

export function getEssayAiPaths(appDir = path.resolve(process.cwd())) {
  return {
    dataDir: path.join(appDir, 'data', 'essay-ai'),
    uploadsDir: path.join(appDir, 'server', 'uploads', 'essay-ai'),
    storePath: path.join(appDir, 'data', 'essay-ai', 'records.json')
  };
}

export function ensureEssayAiDirs(appDir = path.resolve(process.cwd())) {
  const paths = getEssayAiPaths(appDir);
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.mkdirSync(paths.uploadsDir, { recursive: true });
  return paths;
}

function readStore(appDir = path.resolve(process.cwd())) {
  const { storePath } = ensureEssayAiDirs(appDir);
  if (!fs.existsSync(storePath)) {
    return { version: 1, items: [] };
  }

  try {
    const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    if (Array.isArray(data)) {
      return { version: 1, items: data };
    }
    if (Array.isArray(data.items)) {
      return { version: data.version || 1, items: data.items };
    }
  } catch {
    // fall through to empty store
  }
  return { version: 1, items: [] };
}

function writeStore(appDir = path.resolve(process.cwd()), store = { version: 1, items: [] }) {
  const { storePath } = ensureEssayAiDirs(appDir);
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
  return storePath;
}

export function saveEssayRecord(appDir, record) {
  const store = readStore(appDir);
  const index = store.items.findIndex((item) => item.id === record.id);
  if (index >= 0) {
    store.items[index] = record;
  } else {
    store.items.unshift(record);
  }
  store.items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  writeStore(appDir, store);
  return record;
}

export function listEssayRecords(appDir, limit = 20) {
  const store = readStore(appDir);
  return store.items
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, limit);
}

export function findEssayRecord(appDir, id) {
  if (!id) return null;
  const store = readStore(appDir);
  return store.items.find((item) => String(item.id) === String(id)) || null;
}

export function updateEssayRecord(appDir, id, patch) {
  const store = readStore(appDir);
  const index = store.items.findIndex((item) => String(item.id) === String(id));
  if (index < 0) return null;
  store.items[index] = {
    ...store.items[index],
    ...patch,
    updatedAt: patch.updatedAt || new Date().toISOString()
  };
  writeStore(appDir, store);
  return store.items[index];
}

