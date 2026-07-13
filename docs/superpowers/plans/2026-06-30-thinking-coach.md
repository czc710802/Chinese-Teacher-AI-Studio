# Thinking Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add logic-thinking analysis, Socratic questioning, deep revision coaching, student growth tracking, and teacher class thinking analytics to the existing essay review system.

**Architecture:** Extend the existing `raw_json` review payload rather than creating a parallel subsystem. Render new fields in `ReviewPage`, aggregate them in `profile.js` and `analytics.js`, and keep historical reviews readable through fallback data.

**Tech Stack:** React 19, Vite, Express 4, SQLite via `node:sqlite`, Node test runner, Recharts.

---

### Task 1: Lock Behavior With Failing Tests

**Files:**
- Modify: `server/test/ui-flow.test.js`
- Modify: `server/test/student-access.test.js`
- Create: `server/test/thinking-analytics.test.js`

- [ ] Add tests that require `prompt.js` to output `logic_thinking_score`, `thinking_depth`, `thinking_improvement`, `socratic_questions`, and `thinking_coach`.
- [ ] Add tests that require `ReviewPage` to render `ThinkingCoachPanel`, `逻辑思维能力`, `思维深度`, `苏格拉底式追问`, and `深度修改闭环`.
- [ ] Add tests that require `StudentProfile` to render `思维成长档案` with the six ability names.
- [ ] Add tests that require teacher analytics to expose `thinkingWeaknesses`, `thinkingAbilityAverages`, and `thinkingTeachingSuggestions`.
- [ ] Run the new tests and confirm they fail because the feature is missing.

### Task 2: Extend AI Review Contract

**Files:**
- Modify: `server/src/services/prompt.js`
- Modify: `server/src/services/openai.js`

- [ ] Update the prompt scoring rules to add `逻辑思维能力（30分）`.
- [ ] Add explicit instructions for viewpoint clarity, argument structure, reasoning errors, material use, and depth levels.
- [ ] Add JSON schema fields for the Thinking Coach payload.
- [ ] Update `mockReview()` with realistic example data for every new field.
- [ ] Run Task 1 prompt tests and confirm they pass.

### Task 3: Render Student Thinking Coach

**Files:**
- Modify: `client/src/main.jsx`
- Modify: `client/src/styles/app.css`

- [ ] Add `defaultThinkingCoachReport()` to normalize missing fields.
- [ ] Add `ThinkingCoachPanel` and mount it in `ReviewPage` after `多维分析`.
- [ ] Keep UI dense and teacher-tool-like: no marketing hero, no decorative cards inside cards.
- [ ] Add CSS for score grid, depth badge, question list, and revision loop.
- [ ] Run UI tests and confirm student result expectations pass.

### Task 4: Add Student Thinking Growth

**Files:**
- Modify: `server/src/services/profile.js`
- Modify: `client/src/main.jsx`

- [ ] Aggregate ability scores from review `raw_json.logic_thinking_score`.
- [ ] Store ability summary in `growth_report` and `personalized_suggestions` without schema changes.
- [ ] Render a `思维成长档案` panel in `StudentProfile`.
- [ ] Run student profile tests and confirm they pass.

### Task 5: Add Teacher Class Thinking Analytics

**Files:**
- Modify: `server/src/routes/analytics.js`
- Modify: `client/src/main.jsx`
- Modify: `client/src/styles/app.css`

- [ ] Parse review `raw_json` inside `classAnalytics`.
- [ ] Return class-level weak thinking abilities, ability averages, and teaching suggestions.
- [ ] Mount `TeacherInsightPanel` back into `TeacherHome` as `班级思维分析`.
- [ ] Show the top weak abilities and suggested teaching actions.
- [ ] Run analytics and UI tests.

### Task 6: Update Docs and Verify

**Files:**
- Modify: `docs/AI批改规则.md`
- Modify: `docs/作文评分标准.md`
- Modify: `docs/学生端功能说明.md`
- Modify: `docs/教师端功能说明.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `/Users/chenxiansheng/Desktop/workspace/踩坑日志.txt`

- [ ] Document the Thinking Coach contract and role boundaries.
- [ ] Add changelog entry.
- [ ] Run full server tests.
- [ ] Run frontend build.
- [ ] Append the session note to root `踩坑日志.txt`.
