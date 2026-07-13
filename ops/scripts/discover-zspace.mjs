#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { discoverZspaceNetwork, renderZspaceSetupMarkdown } from '../../server/src/storage/zspace-discovery.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '../..');
const docsPath = path.join(appDir, 'docs', 'ZSPACE_SETUP.md');

const scanTcp = !process.argv.includes('--no-tcp-scan');
const writeDocs = process.argv.includes('--write-docs') || !process.argv.includes('--json-only');

const result = await discoverZspaceNetwork({ scanTcp });
const markdown = renderZspaceSetupMarkdown(result);

if (writeDocs) {
  fs.mkdirSync(path.dirname(docsPath), { recursive: true });
  fs.writeFileSync(docsPath, markdown);
}

if (process.argv.includes('--json') || process.argv.includes('--json-only')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(markdown);
  if (writeDocs) console.log(`\n已写入：${docsPath}`);
}
