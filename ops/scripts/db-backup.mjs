import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');
const source = process.env.DATABASE_PATH || path.join(appDir, 'data', 'essay-review.sqlite');
const backupDir = process.env.DB_BACKUP_DIR || path.join(appDir, 'data', 'backups');

if (!fs.existsSync(source)) {
  console.error(`FAIL source database not found: ${source}`);
  process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(backupDir, `essay-review-${stamp}.sqlite`);
fs.copyFileSync(source, backup, fs.constants.COPYFILE_EXCL);

const stat = fs.statSync(backup);
const db = new DatabaseSync(backup, { readOnly: true });
const row = db.prepare('PRAGMA integrity_check').get();
db.close();
const integrity = row.integrity_check || Object.values(row)[0];
const result = {
  source,
  backup,
  sizeBytes: stat.size,
  createdAt: new Date(stat.birthtimeMs).toISOString(),
  integrity
};
console.log(JSON.stringify(result, null, 2));
if (integrity !== 'ok') process.exit(1);
