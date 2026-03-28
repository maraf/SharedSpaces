
## Team Updates (2026-03-27)

**Issue #135 completed (Copy and move items between spaces):**
- **Kaylee:** Implemented POST /v1/spaces/{sourceSpaceId}/items/{itemId}/transfer endpoint with dual-token auth, quota locks, file streaming, and SignalR broadcasts. Key design: server-generated destination item IDs, serializable transactions on destination space only, broadcast ordering (ItemAdded → ItemDeleted).
- **Wash:** Built client transfer UI — "Send to…" button, space-picker modal with Copy/Move buttons, loading states, error feedback in modal, success via existing syncMessage banner. Also fixed Issue #100 (pending share card layout unification). Added 4 Playwright screenshot tests (button + modal, desktop + mobile).
- **Zoe:** Wrote 11 integration tests covering copy/move for text/file items, quota enforcement, token validation, revoked member rejection. Fixed critical JWT MapInboundClaims bug in transfer endpoint: handler now preserves original claim names (matches JwtAuthenticationExtensions.cs). Wrote 35 Vitest tests for client transfer feature (11 API + 24 component tests in space-api.test.ts and space-view.test.ts). All 447 Vitest + 36 Playwright tests passing.
- **Cross-agent pattern:** Dual-token authorization ensures user membership in both spaces; serializable transactions + quota locks prevent TOCTOU on destination; stream-based file copy suits large files. Established for reuse in future cross-space operations.
- **PR #136 ready for merge.**

## Team Updates (2026-03-28)

**Issue #134 in progress (File preview support):**
- **Zoe:** Created `getPreviewType()` helper in `src/SharedSpaces.Client/src/lib/file-preview.ts` and 80 Vitest tests in `file-preview.test.ts`. Helper maps filename extensions to preview types: image (8 exts), video (mp4/webm only — browser-native), audio (6 exts), pdf, text (20+ code/data/plain extensions), none (everything else). Tests cover all categories, case insensitivity, edge cases (empty, no extension, double extensions, hidden files, dot-only, trailing dots), non-browser-native video exclusion, and previewable/non-previewable boundaries. All 527 Vitest tests passing (80 new + 447 existing).
- **Wash:** Implementation pending — UI tests to follow once component work lands.

## Learnings

- **Client test patterns for transfer feature (2026-03-27):**
  - API tests in `space-api.test.ts` use `mockFetch()` / `mockFetchReject()` helpers and test URL construction, request body (JSON.parse of body), auth headers, and error status codes (401/403/413/500/network).
  - Component tests in `space-view.test.ts` access private state/methods via `(element as any)` cast. Must set `isLoading = false` before mounting to DOM for render tests, otherwise "Loading space…" is shown.
  - Lit's `nothing` sentinel is `Symbol(lit-nothing)`, not `undefined` — import `nothing` from 'lit' for assertions.
  - Nested Lit template content (e.g. inside `.map()` or ternary) appears as dynamic values, not in static `strings` array of the outer TemplateResult. DOM-based assertions (mount + `innerHTML`) work for nested content.
  - `transferItem()` sends POST with JSON body `{ destinationSpaceId, destinationToken, action }` and `Content-Type: application/json` header alongside Bearer auth.
  - Key test files: `src/SharedSpaces.Client/src/features/space-view/space-api.test.ts`, `src/SharedSpaces.Client/src/features/space-view/space-view.test.ts`.
  - Playwright screenshots for transfer UI verify button placement, modal layout, loading states, and responsive design (390×844 mobile, 1280×720 desktop). Mobile layout checked for text overflow, button wrapping, truncation.

- **File preview helper design (2026-03-28):**
  - Created `getPreviewType()` as a pure function in `src/SharedSpaces.Client/src/lib/file-preview.ts` — returns `'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none'`.
  - Only browser-native video formats (mp4, webm) are previewable — mov, avi, mkv etc. return 'none'. Same approach as audio (mp3, wav, ogg, m4a, flac, aac).
  - Uses `Set` for extension lookups — O(1) per check, cleaner than `includes()` on arrays.
  - Edge case: `filename.toLowerCase().split('.').pop()` gets last extension, so `archive.tar.gz` → `'gz'` → `'none'`. Also handles no-extension files by checking if extracted "extension" equals the full lowered filename.
  - Test file uses `it.each` for parametric tests — clean coverage of 80+ extension/filename combinations in compact form.
  - Key design decision: HTML/CSS are 'text' preview (source code view), not rendered — matches the "text modal" requirement from spec.

- **File preview modal UI tests (2026-03-28):**
  - Wrote 29 Vitest tests in `space-view.test.ts` covering handleFilePreviewClick, per-type rendering, loading state, error handling, too-large guard, closeFilePreview cleanup, and integration flows.
  - For DOM rendering tests: set `isLoading = false` + set all `filePreview*` state fields before `appendChild` + `requestUpdate` + `await updateComplete`. Query elements directly (light DOM).
  - Mock `fetch` to return `{ ok, status, blob: async () => blob }` for download endpoint calls. Text preview reads `blob.text()`, binary types use `URL.createObjectURL(blob)`.
  - Mock `URL.createObjectURL` / `URL.revokeObjectURL` via `vi.spyOn(URL, ...)` — verified createObjectURL is called for binary types but NOT for text, and revokeObjectURL is called on close.
  - Error paths: 401/404 from SpaceApiError close the preview and set `connectionErrorType = 'auth'`; other errors set `filePreviewError` and keep the modal open with a "Download instead" fallback button.
  - Too-large guard: `isFileTooLargeForPreview()` is checked before fetch — sets error immediately without network call. Tested with image >10MB and text >1MB limits from `PREVIEW_SIZE_LIMITS`.
  - Integration tests follow the open→verify→close→verify pattern matching the transfer feature tests. Also tested fail→close→reopen to verify clean state.
  - All 556 Vitest tests passing (29 new + 527 existing).

---

## Team Update: File Preview Session (2026-03-28)

**Session:** 2026-03-28T09:38:17Z  
**Topic:** File Preview Implementation (Issue #134)  
**Coordinated with:** Wash (Frontend Dev), Coordinator (Integration Agent)

**Summary:** Your 80 test cases for getPreviewType() (commit a8f01d9) locked the API contract and were integrated with Wash's file preview modal (commit 43a53e1). The Coordinator consolidated duplicate modules (commit 58c33fc). All decisions merged into squad decisions.md.

**Impact on your work:**
- API contract fully documented in decisions.md: video (mp4, webm only), audio (broad support), text (20+ languages + structured data), 'none' for archives/Office/executables
- Next test areas: Cross-browser codec compatibility, edge case validation, performance testing for large files

**Decisions documented:** File Preview Type Detection API contract (your decision locked by tests)
