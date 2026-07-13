# P1.5 Essay Engine Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the essay grading engine so DeepSeek returns and all report surfaces preserve a full high-school-teacher style critique while keeping Feishu, NAS, student profiles, teacher dashboard, and exports compatible.

**Architecture:** Keep the existing service boundaries. Expand the server prompt JSON contract, normalize the new fields in `apps/essay-ai`, and render the same structured analysis in Markdown, archive Word/PDF sections, and signed public HTML reports.

**Tech Stack:** Node.js ESM, node:test, existing DeepSeek AI router, existing archive/export pipeline, existing Feishu signed file access.

---

### Task 1: Lock The P1.5 Contract With Tests

**Files:**
- Create: `server/test/essay-engine-p15.test.js`
- Modify: none

- [x] **Step 1: Write failing tests**

The test must verify:
- `buildReviewPrompt()` asks for the three required teacher identities.
- The prompt contains all P1.5 JSON fields and minimum length requirements.
- `normalizeReview()` preserves new P1.5 fields.
- `buildEssayReportMarkdown()`, `generateArchiveMarkdown()`, and `renderReportHtml()` expose the new sections.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test server/test/essay-engine-p15.test.js`

Expected before implementation: FAIL because P1.5 fields are not yet normalized or rendered.

### Task 2: Upgrade Prompt And Normalization

**Files:**
- Modify: `server/src/services/prompt.js`
- Modify: `apps/essay-ai/src/gradingService.js`
- Modify: `server/src/services/openai.js`

- [ ] **Step 1: Expand prompt**

Add the P1.5 identity, detailed section requirements, JSON fields, and explicit backward-compatible legacy fields.

- [ ] **Step 2: Normalize P1.5 fields**

Map snake_case and camelCase variants into stable frontend fields without removing legacy fields.

- [ ] **Step 3: Expand local mock fallback**

Keep demo fallback structurally complete so development/test mode does not regress into shallow reports.

### Task 3: Upgrade Report Surfaces

**Files:**
- Modify: `apps/essay-ai/src/reportService.js`
- Modify: `server/src/services/archive-pipeline.js`
- Modify: `server/src/services/file-access.js`
- Modify: `server/src/services/exporter.js`

- [ ] **Step 1: Render full P1.5 Markdown**

Include overall evaluation,审题立意,结构,逻辑,语言,素材,高考评分,逐段精修,教师评语,训练任务,成长分析.

- [ ] **Step 2: Preserve fields into archive JSON and Word/PDF sections**

Ensure P1.1 archive files contain the same deep analysis and remain readable by P1.2/P1.3.

- [ ] **Step 3: Render public HTML report**

Signed report pages must show the same sections and retain download buttons.

### Task 4: Documentation And Comparison

**Files:**
- Create: `docs/ESSAY_ENGINE_COMPARE.md`
- Modify: `docs/AI批改规则.md`

- [ ] **Step 1: Document old/current/new differences**

Separate evidence from public production HTML from evidence found in local source.

- [ ] **Step 2: Document the new grading contract**

Describe required sections, JSON compatibility, and report delivery constraints.

### Task 5: Verification

**Commands:**
- `node --test server/test/essay-engine-p15.test.js`
- `npm run lint`
- `npm test`
- `npm run build`
- `npm run archive:smoke`
- `npm run feishu:file-smoke`
- `npm run prod:status`

- [ ] **Step 1: Run focused tests**
- [ ] **Step 2: Run regression tests and build**
- [ ] **Step 3: Run smoke checks that protect P1.1-P1.4**
- [ ] **Step 4: Record limits for the requested 10-essay old/new comparison if live old-baseline data is not available from the public page**
