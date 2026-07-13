import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const databasePath = path.join(rootDir, 'data/essay-review.sqlite');

test('510 class roster only contains the official 60 imported students', () => {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const rows = database.prepare(`
    SELECT u.username, u.name, s.student_no
    FROM class_students cs
    JOIN classes c ON c.id = cs.class_id
    JOIN students s ON s.id = cs.student_id
    JOIN users u ON u.id = s.user_id
    WHERE c.name = '510'
    ORDER BY CAST(s.student_no AS INTEGER), s.student_no, u.name
  `).all();

  assert.equal(rows.length, 60);
  assert.equal(rows.some((row) => row.username === 'student' || row.name === '林同学'), false);
  assert.deepEqual(rows.map((row) => Number(row.student_no)), Array.from({ length: 60 }, (_, index) => index + 1));
});

test('administrator seed and login role are removed from production code', () => {
  const initSource = readFileSync(path.join(rootDir, 'server/src/db/init.js'), 'utf8');
  const authSource = readFileSync(path.join(rootDir, 'server/src/routes/auth.js'), 'utf8');

  assert.doesNotMatch(initSource, /admin|管理员/);
  assert.match(authSource, /student', 'teacher/);
});
