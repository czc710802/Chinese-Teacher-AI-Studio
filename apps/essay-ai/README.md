# Essay AI Module

This module provides the V11.2 essay-analysis flow for Chinese Teacher AI Studio.

- `src/routes.js`: HTTP endpoints for analyze, upload, result, history, download.
- `src/essayService.js`: orchestration layer for OCR, grading, storage, and reporting.
- `src/gradingService.js`: AI grading with OpenAI when configured, mock fallback otherwise.
- `src/ocrService.js`: OCR adapter with safe fallback when OCR is unavailable.
- `src/storageService.js`: JSON record persistence and upload-path helpers.

The production server mounts these routes under `/api/essay`.
