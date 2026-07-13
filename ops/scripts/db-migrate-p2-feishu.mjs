import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { schemaSql } from '../../server/src/db/schema.js';
import {
  applyP2FeishuWorkbenchMigration,
  getP2FeishuWorkbenchMigrationId,
  rollbackP2FeishuWorkbenchMigration
} from '../../server/src/db/migrations/20260713_p2_feishu_workbench.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');
const databasePath = process.env.DATABASE_PATH || path.join(appDir, 'data', 'essay-review.sqlite');
const direction = process.argv.includes('--down') ? 'down' : 'up';

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec('PRAGMA foreign_keys = ON');

if (process.argv.includes('--init-schema')) {
  database.exec(schemaSql);
}

if (direction === 'down') {
  rollbackP2FeishuWorkbenchMigration(database);
} else {
  applyP2FeishuWorkbenchMigration(database);
}

const migration = database.prepare('SELECT * FROM schema_migrations WHERE id = ?').get(getP2FeishuWorkbenchMigrationId());
database.close();

console.log(JSON.stringify({
  ok: true,
  direction,
  databasePath,
  migration: migration || null
}, null, 2));
