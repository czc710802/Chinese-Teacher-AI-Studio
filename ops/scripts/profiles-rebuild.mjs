#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadServerEnv } from '../../server/src/config/env.js';
import { createZSpaceClient } from '../../server/src/services/zspace-storage.js';
import { rebuildStudentProfiles } from '../../server/src/services/student-profile/profile-service.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '../..');

loadServerEnv({ appDir, nodeEnv: 'production' });

const client = createZSpaceClient({ env: process.env });
const result = await rebuildStudentProfiles({ appDir, client });

console.log(`Profiles rebuilt=${result.rebuilt}`);
console.log(`Archives scanned=${result.archivesScanned}`);
console.log(`Archives skipped=${result.archivesSkipped}`);
console.log(`Failures=${result.failures}`);

if (result.failures > 0) process.exit(1);
