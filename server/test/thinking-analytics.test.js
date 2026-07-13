import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const analyticsSource = readFileSync(path.join(rootDir, 'server/src/routes/analytics.js'), 'utf8');
const profileSource = readFileSync(path.join(rootDir, 'server/src/services/profile.js'), 'utf8');

test('class analytics aggregates thinking coach fields from review raw json', () => {
  assert.match(analyticsSource, /raw_json/);
  assert.match(analyticsSource, /logic_thinking_score/);
  assert.match(analyticsSource, /thinking_depth/);
  assert.match(analyticsSource, /thinkingWeaknesses/);
  assert.match(analyticsSource, /thinkingAbilityAverages/);
  assert.match(analyticsSource, /thinkingTeachingSuggestions/);
});

test('student profile stores thinking growth summary from logic thinking score', () => {
  assert.match(profileSource, /raw_json/);
  assert.match(profileSource, /logic_thinking_score/);
  assert.match(profileSource, /thinking_growth/);
  assert.match(profileSource, /逻辑能力/);
  assert.match(profileSource, /修改能力/);
});
