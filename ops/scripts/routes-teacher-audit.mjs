import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..', '..');
const mainSource = fs.readFileSync(path.join(appRoot, 'client', 'src', 'main.jsx'), 'utf8');
const navigationModule = await import(pathToFileURL(path.join(appRoot, 'client', 'src', 'teacher-navigation.js')).href);

const routeMatches = [...mainSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]);
const hrefMatches = [...mainSource.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);

function unique(rows) {
  return [...new Set(rows.filter(Boolean))];
}

const canonicalRoutes = unique(navigationModule.teacherNavigationEntries.map((item) => item.route));
const legacyRoutes = unique((navigationModule.teacherLegacyRedirects || []).map((item) => item.from));
const missingCanonicalRoutes = canonicalRoutes.filter((route) => !routeMatches.includes(route));
const duplicateRoutes = routeMatches.filter((route, index) => routeMatches.indexOf(route) !== index);
const teacherLinks = unique(hrefMatches.filter((href) => href.startsWith('/teacher') || href.startsWith('/classes') || href.startsWith('/assignments/new') || href.startsWith('/archive') || href.startsWith('/student-profiles')));
const pausedFeishuMentions = [...mainSource.matchAll(/\/teacher\/feishu|飞书/g)].length;

const report = {
  canonicalRoutes,
  legacyRoutes,
  missingCanonicalRoutes,
  duplicateRoutes: unique(duplicateRoutes),
  teacherLinks,
  pausedFeishuMentions,
  routeCount: routeMatches.length,
  linkCount: teacherLinks.length,
  status: missingCanonicalRoutes.length || duplicateRoutes.length ? 'fail' : 'pass'
};

console.log(JSON.stringify(report, null, 2));
if (report.status !== 'pass') process.exitCode = 1;
