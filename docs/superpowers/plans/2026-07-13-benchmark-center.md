# P1.5 Benchmark Center Implementation Plan

## Goal

Build an independent AI grading quality Benchmark Center for Chinese Teacher AI Studio without changing the existing production grading, Feishu, NAS, archive, student profile, or teacher dashboard flows.

## Scope

1. Create the `benchmark/` data area and unified `BenchmarkDataset` schema.
2. Add server-side Benchmark services for import, provider adapters, batch runs, comparison, scoring, reporting, exports, charts, retry, resume, and teacher review.
3. Add `npm run benchmark` and `npm run benchmark:test`.
4. Add Benchmark APIs under `/api/benchmark`.
5. Add a teacher backend page entry for Benchmark Center.
6. Add docs and focused automated tests.

## Design

- Runtime data remains file-based under `benchmark/`, matching existing archive/profile/teacher-management stores.
- Production AI calls are hidden behind Provider Adapters. Benchmark tests default to a mock provider and never call paid APIs.
- Report export reuses existing Word/PDF buffer helpers from `server/src/services/exporter.js`.
- Feishu notification is optional and disabled unless explicitly configured.
- Existing production routes and data stores are read-only dependencies; Benchmark writes only to `benchmark/`.

## Verification

1. Red test for Benchmark service, CLI, API, and frontend wiring.
2. Implement the independent Benchmark module.
3. Run focused Benchmark tests.
4. Run `npm run benchmark:test`.
5. Run `npm run benchmark -- --mock`.
6. Run lint, full test, build, and production status checks where possible.

## Risks

- This directory is not a Git repository, so final output can include commit content but cannot create a real Git commit.
- Full external regression checks involving Cloudflare, Feishu, WebDAV, and production services may require elevated local permissions.
