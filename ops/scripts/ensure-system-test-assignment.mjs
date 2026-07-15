import { initDatabase } from '../../server/src/db/init.js';
import { db } from '../../server/src/db/connection.js';
import { ensureSystemTestAssignment, listAssignmentsForClass } from '../../server/src/services/assignment-access.js';

function argValue(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const classId = Number(argValue('class-id', '0'));
if (!classId) {
  console.error('Usage: node ops/scripts/ensure-system-test-assignment.mjs --class-id=6');
  process.exit(2);
}

initDatabase();

const before = listAssignmentsForClass(db, classId, { dataScope: 'system_test', includeArchived: true }).rows;
const result = ensureSystemTestAssignment(db, {
  classId,
  actorId: 'ops:ensure-system-test-assignment',
  options: { publicOrigin: process.env.PUBLIC_APP_ORIGIN }
});
const after = listAssignmentsForClass(db, classId, { dataScope: 'system_test', includeArchived: true }).rows;

console.log(JSON.stringify({
  ok: result.status === 200,
  status: result.status,
  message: result.message || '',
  classId,
  created: Boolean(result.created),
  archivedDuplicates: Number(result.archivedDuplicates || 0),
  assignmentId: result.assignment?.id || null,
  before: before.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    archived_at: row.archived_at || '',
    deleted_at: row.deleted_at || '',
    data_scope: row.data_scope || ''
  })),
  after: after.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    archived_at: row.archived_at || '',
    deleted_at: row.deleted_at || '',
    data_scope: row.data_scope || ''
  }))
}, null, 2));

if (result.status !== 200) process.exit(1);
