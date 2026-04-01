
## Team Updates (2026-03-27)

**Issue #135 completed (Copy and move items between spaces):**
- **Kaylee:** Implemented POST /v1/spaces/{sourceSpaceId}/items/{itemId}/transfer endpoint with dual-token auth, quota locks, file streaming, and SignalR broadcasts. Key design: server-generated destination item IDs, serializable transactions on destination space only, broadcast ordering (ItemAdded → ItemDeleted).
- **Wash:** Built client transfer UI — "Send to…" button, space-picker modal with Copy/Move buttons, loading states, error feedback in modal, success via existing syncMessage banner. Also fixed Issue #100 (pending share card layout unification). Added 4 Playwright screenshot tests (button + modal, desktop + mobile).
- **Zoe:** Wrote 11 integration tests covering copy/move for text/file items, quota enforcement, token validation, revoked member rejection. Fixed critical JWT MapInboundClaims bug in transfer endpoint: handler now preserves original claim names (matches JwtAuthenticationExtensions.cs). Wrote 35 Vitest tests for client transfer feature (11 API + 24 component tests in space-api.test.ts and space-view.test.ts). All 447 Vitest + 36 Playwright tests passing.
- **Cross-agent pattern:** Dual-token authorization ensures user membership in both spaces; serializable transactions + quota locks prevent TOCTOU on destination; stream-based file copy suits large files. Established for reuse in future cross-space operations.
- **PR #136 ready for merge.**

## Team Updates (2026-03-28)

**Issue #134 in progress (File preview support):**
- **Zoe:** Created `getPreviewType()` helper in `src/SharedSpaces.Client/src/features/space-view/file-preview.ts` and 80 Vitest tests in `file-preview.test.ts`. Helper maps filename extensions to preview types: image (8 exts), video (mp4/webm only — browser-native), audio (6 exts), pdf, text (20+ code/data/plain extensions), none (everything else). Tests cover all categories, case insensitivity, edge cases (empty, no extension, double extensions, hidden files, dot-only, trailing dots), non-browser-native video exclusion, and previewable/non-previewable boundaries. All 527 Vitest tests passing (80 new + 447 existing).
- **Wash:** Implementation pending — UI tests to follow once component work lands.

## Learnings

- **Migration snapshot validation (2026-03-29):**
  - Created `MigrationSnapshotTests.MigrationSnapshot_ShouldMatchCurrentModel` test to catch EF Core migration snapshot desync bugs at test time, not server startup.
  - Test compares the current `AppDbContext` model against the last migration's `AppDbContextModelSnapshot` using `IMigrationsModelDiffer.HasDifferences()`.
  - Both models must be initialized with `IModelRuntimeInitializer.Initialize(model, designTime: true, validationLogger: null)` before calling `GetRelationalModel()` for comparison — raw models from `IMigrationsAssembly.ModelSnapshot.Model` and `IModelSource.GetModel()` are not finalized and will throw `InvalidOperationException`.
  - Test uses SQLite (not InMemoryDatabase) because migrations require a real database provider — `options.UseSqlite("DataSource=:memory:")`.
  - Key services retrieved from `DbContext.GetInfrastructure().GetRequiredService<T>()`: `IMigrationsModelDiffer`, `IMigrationsAssembly`, `IModelRuntimeInitializer`, `IModelSource`.
  - Test file: `tests/SharedSpaces.Server.Tests/MigrationSnapshotTests.cs`.
  - This prevents production crashes from missing entities in Designer.cs files (e.g., the `SharedLink` desync that caused the original crash).

- **Client test patterns for transfer feature (2026-03-27):**
  - API tests in `space-api.test.ts` use `mockFetch()` / `mockFetchReject()` helpers and test URL construction, request body (JSON.parse of body), auth headers, and error status codes (401/403/413/500/network).
  - Component tests in `space-view.test.ts` access private state/methods via `(element as any)` cast. Must set `isLoading = false` before mounting to DOM for render tests, otherwise "Loading space…" is shown.
  - Lit's `nothing` sentinel is `Symbol(lit-nothing)`, not `undefined` — import `nothing` from 'lit' for assertions.
  - Nested Lit template content (e.g. inside `.map()` or ternary) appears as dynamic values, not in static `strings` array of the outer TemplateResult. DOM-based assertions (mount + `innerHTML`) work for nested content.
  - `transferItem()` sends POST with JSON body `{ destinationSpaceId, destinationToken, action }` and `Content-Type: application/json` header alongside Bearer auth.
  - Key test files: `src/SharedSpaces.Client/src/features/space-view/space-api.test.ts`, `src/SharedSpaces.Client/src/features/space-view/space-view.test.ts`.
  - Playwright screenshots for transfer UI verify button placement, modal layout, loading states, and responsive design (390×844 mobile, 1280×720 desktop). Mobile layout checked for text overflow, button wrapping, truncation.

- **File preview helper design (2026-03-28):**
  - Created `getPreviewType()` as a pure function in `src/SharedSpaces.Client/src/features/space-view/file-preview.ts` — returns `'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none'`.
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

## Team Update (2026-03-29)

**Issue #159 in progress (Optional name for shared link):**
- **Zoe:** Added 5 integration tests to `tests/SharedSpaces.Server.Tests/SharedLinkEndpointTests.cs` for the new optional `Name` property on SharedLink:
  1. `CreateSharedLink_WithName_Returns201WithName` — POST with `{ "name": "My shared link" }` returns the name in the response
  2. `CreateSharedLink_WithEmptyStringName_ReturnsCreatedWithNullName` — POST with `{ "name": "" }` treats empty as null (backward compatibility)
  3. `CreateSharedLink_WithLongName_Succeeds` — POST with 200-character name succeeds
  4. `ListSharedLinks_IncludesNameInResponse` — GET returns name in list for named links, null for unnamed
  5. Updated existing `CreateSharedLink_ForTextItem_Returns201WithLinkDetails` to assert `Name` is null when not provided
- Updated `CreateSharedLinkAsync()` helper to accept optional `name` parameter and send JSON body `{ "name": "..." }` when provided
- Updated local `SharedLinkResponse` record to include `string? Name` property (matches production Models.cs)
- Tests compile against current codebase; will pass once Kaylee's server implementation merges
- **Key pattern:** Empty string names are normalized to null for storage — matches existing SharedSpaces pattern for optional strings

## Learnings

- **SharedLink name test patterns (2026-03-29):**
  - Test file: `tests/SharedSpaces.Server.Tests/SharedLinkEndpointTests.cs`
  - Request body pattern: `request.Content = JsonContent.Create(new { Name = name })` for POST with name
  - No request body sent when name is null/omitted — preserves backward compatibility (existing clients sending empty POST still work)
  - Empty string name (`""`) is normalized to null in response — test validates this server behavior
  - Max length test (200 chars) validates entity constraint without triggering validation error
  - List endpoint test creates both named and unnamed links, then verifies both appear correctly in response
  - Public shared endpoint (`/v1/shared/{token}`) does NOT include name in `SharedItemResponse` — name is only for link management UI, not public consumption

### 2026-03-30 · SharedLink Name Feature - Team Integration Update

**Cross-agent coordination completed:**
- Kaylee (Backend) added optional Name property to SharedLink entity, DTOs, endpoints, and migration (build passed)
- Wash (Frontend) updated space-api.ts types and added name input in share modal + display in link list
- Coordinator ensured backward compatibility: `CreateSharedLinkRequest.Name` is nullable, empty strings normalized to null
- Test suite coverage verified: 4 new + 1 updated test case; all 260 tests passing
- Backward compatibility validated: existing links without names unaffected

**Session documented in:**
- `.squad/log/2026-03-30T11-15-22Z-shared-link-name.md`
- Orchestration logs: `2026-03-30T11-15-22Z-kaylee.md`, `2026-03-30T11-15-22Z-wash.md`, `2026-03-30T11-15-22Z-zoe.md`

## Learnings

- **SharedLink name max-length validation test (2026-03-30):**
  - Added `CreateSharedLink_WithOverLimitName_Returns400` in `SharedLinkEndpointTests.cs` — sends 201-char name, asserts `HttpStatusCode.BadRequest`.
  - Mirrors the existing `WithLongName_Succeeds` test (200 chars) as a boundary pair: 200 passes, 201 rejects.
  - Test is ahead of server validation — depends on Kaylee's server-side 400 response for names > 200 chars.
  - PR review feedback from Marek prompted this addition; always check that max-length constraints have both passing and failing boundary tests.

- **Share link encoding/decoding tests (2026-03-30):**
  - Created `src/SharedSpaces.Client/src/lib/share-link.test.ts` — 16 Vitest tests covering base64url encode/decode, encodeShareLinkSegment/decodeShareLinkSegment round-trips, backward compatibility (bare GUID → legacy token + fallback URL), edge cases (missing params, invalid base64, empty string), buildShareUrl, and GitHub Pages 404.html redirect contract.
  - Created `src/SharedSpaces.Client/src/features/shared-item/shared-item-api.test.ts` — 13 Vitest tests for getSharedItem/downloadSharedItem: URL construction with custom API URLs (verifying decoded share link API URL is used, not default), token URL-encoding, trailing slash normalization, error handling (404/500/network).
  - Added 2 server integration tests to `SharedLinkEndpointTests.cs`: `CreateSharedLink_ResponseIncludesServerUrl` (verifies ServerUrl in creation response) and `GetSharedItem_WithRawGuidToken_ReturnsItem_BackwardCompat` (verifies legacy GUID tokens work).
  - Updated test `SharedLinkResponse` record to include `string? ServerUrl = null` to match production DTO.
  - Key test pattern: GitHub Pages SPA redirect contract tests verify the 404.html → index.html → replaceState → app-shell decode pipeline end-to-end using URL encoding/decoding assertions.
  - All 622 Vitest tests and 209 server integration tests passing.

## Team Update: Share Link Implementation Session (2026-03-30)

**Issue #151 (GitHub Pages SPA routing) + Issue #161 (stateless share links) - Completed**

**Coordinated with:** Kaylee (Backend Dev), Wash (Frontend Dev)

**Your contribution:**
- Wrote 31 E2E and unit tests covering the share link implementation:
  - 2 server integration tests: ServerUrl population, backward compatibility for raw GUID tokens
  - 16 share-link module tests: base64url encode/decode, round-trips, backward compat, edge cases
  - 13 shared-item-api tests: URL construction with custom API URLs, token URL-encoding, error handling
- 209 server integration tests passing, 622 client Vitest tests passing

**Cross-agent outcomes:**
- **Kaylee:** Added nullable ServerUrl field to SharedLinkResponse DTO, populated on creation
- **Wash:** Implemented 404.html redirect pattern, created share-link.ts module, updated 4 URL construction sites

**Key decisions executed:**
1. 404.html redirect pattern (no --base ./ change needed)
2. Base64url encode token + API URL as query string for stateless links
3. Backward compatibility for legacy GUID tokens

**Session documented in:**
- .squad/log/2026-03-30T19-19-08-share-link-implementation.md
- .squad/orchestration-log/2026-03-30T19-19-08-zoe.md
- Decisions merged into .squad/decisions.md

## Screenshot Determinism Analysis (2026-03-31)

**Issue:** Screenshot churn caused by dynamic timestamps, UUIDs, and relative-time strings that change on every test run.

**Root cause identified:**
1. **TIER 1 (High churn):** Relative time formatting in item `sharedAt` (space-view.ts:1700, 1747), shared link `createdAt` (space-view.ts:2051), and admin space/member creation dates via `.toLocaleString()` (admin-view.ts:914, 1055)
2. **TIER 2 (Medium churn):** Pending share timestamps (app-shell.ts:795–799), member/item/invitation count buttons
3. **TIER 3 (Low churn):** UUID display in admin view (no layout impact; fixed-width monospace rendering)

**Affected screenshots:** 24 of 58 (42%), primarily admin views, space view with items, and share/pending modals.

**Key finding:** The `formatRelativeTime()` utility in `src/SharedSpaces.Client/src/lib/format-time.ts` returns dynamic strings ("Today", "Yesterday", "3d ago", "Mar 19") based on wall-clock time, causing monthly drift.

**Recommended mitigations (prioritized):**
1. **Tier 1 (lowest risk, 30 min):** Deterministic test fixtures—seed spaces/items with fixed timestamps (e.g., "2025-03-19T12:00:00Z"). Captures real rendering; re-baseline quarterly.
2. **Tier 2 (1–2 hours, permanent):** Mock clock in test suite—freeze Playwright/Vitest time to eliminate monthly drift entirely.
3. **Avoid:** Relative-time removal or masking—defeats purpose of E2E screenshots and regresses UX.

**Decision recorded:** `.squad/decisions/inbox/zoe-screenshot-determinism.md` (full analysis with implementation sequence, file monitoring checklist, and future crew guidance).

**Pattern for future work:** Screenshot determinism = fixture determinism. You can't mock your way out of dynamic test data.

### Screenshot Determinism Initiative — Full Session (2026-04-01)

**Session summary:** Parallel 3-agent investigation into screenshot churn (Wash, Zoe, Mal).

**Outcome:** Unified recommendation for deterministic fixtures + frozen time mocking; hybrid approach approved.

**Key findings across all agents:**
- **Wash's analysis:** 4 mitigation strategies ranked by effort/impact; Phase 1 (freeze time + deterministic UUIDs) estimated 2-3 hours, 80-90% churn reduction
- **Zoe's audit:** 12 churn sources in 3 tiers; 24 high-risk screenshots out of 58; Phase 1 (30 min) → Phase 2 (1-2 hours) → Phase 3 (ongoing)
- **Mal's review:** Cross-agent alignment confirmed; no conflicts; recommendations unified

**Approved mitigation ladder:**
1. Phase 1 (Near-term): Deterministic fixtures + frozen time — ~80% churn elimination
2. Phase 2 (Short-term, optional): Mock clock — ~95% churn elimination
3. Phase 3 (Ongoing): Quarterly re-baselining + monitoring

**Next steps:** Implementation assignment to Kaylee or Wash; validation via 5× consecutive test runs; documentation update in SKILL.md.

**Session outputs:**
- `.squad/log/2026-04-01T11-38-06Z-screenshot-determinism.md` — Session summary
- `.squad/orchestration-log/2026-04-01T11-38-06Z-wash.md` — Wash's work
- `.squad/orchestration-log/2026-04-01T11-38-06Z-zoe.md` — Zoe's work
- `.squad/orchestration-log/2026-04-01T11-38-06Z-mal.md` — Mal's review
- `.squad/decisions.md` — Merged Wash + Zoe decisions
