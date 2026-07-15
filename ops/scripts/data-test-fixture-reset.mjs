import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureSystemTestFixture } from '../../server/src/services/legacy-cleanup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(__dirname, '../..');

const result = ensureSystemTestFixture(appDir);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
