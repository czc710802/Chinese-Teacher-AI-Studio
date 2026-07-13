import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../server/src/config/env.js';
import { createZSpaceClient } from '../../server/src/services/zspace-storage.js';
import { rebuildTeacherManagement } from '../../server/src/services/teacher-management/teacher-management-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '..', '..');

try {
  const client = createZSpaceClient({ env: process.env });
  const result = await rebuildTeacherManagement({ appDir, client });
  console.log(`Classes rebuilt=${result.classesRebuilt}`);
  console.log(`Students linked=${result.studentsLinked}`);
  console.log(`Essays linked=${result.essaysLinked}`);
  console.log(`Records skipped=${result.recordsSkipped}`);
  console.log(`Failures=${result.failures}`);
} catch (error) {
  console.error(`classes:rebuild failed: ${String(error?.message || error).slice(0, 300)}`);
  process.exitCode = 1;
}
