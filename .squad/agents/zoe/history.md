
## Team Updates (2026-03-27)

**Issue #135 completed (Copy and move items between spaces):**
- **Kaylee:** Implemented POST /v1/spaces/{sourceSpaceId}/items/{itemId}/transfer endpoint with dual-token auth, quota locks, file streaming, and SignalR broadcasts. Key design: server-generated destination item IDs, serializable transactions on destination space only, broadcast ordering (ItemAdded → ItemDeleted).
- **Wash:** Built client transfer UI — "Send to…" button, space-picker modal with Copy/Move buttons, loading states, error feedback in modal, success via existing syncMessage banner. Also fixed Issue #100 (pending share card layout unification). Added 4 Playwright screenshot tests (button + modal, desktop + mobile).
- **Zoe:** Wrote 11 integration tests covering copy/move for text/file items, quota enforcement, token validation, revoked member rejection. Fixed critical JWT MapInboundClaims bug in transfer endpoint: handler now preserves original claim names (matches JwtAuthenticationExtensions.cs). Wrote 35 Vitest tests for client transfer feature (11 API + 24 component tests in space-api.test.ts and space-view.test.ts). All 447 Vitest + 36 Playwright tests passing.
- **Cross-agent pattern:** Dual-token authorization ensures user membership in both spaces; serializable transactions + quota locks prevent TOCTOU on destination; stream-based file copy suits large files. Established for reuse in future cross-space operations.
- **PR #136 ready for merge.**

## Learnings

- **Client test patterns for transfer feature (2026-03-27):**
  - API tests in `space-api.test.ts` use `mockFetch()` / `mockFetchReject()` helpers and test URL construction, request body (JSON.parse of body), auth headers, and error status codes (401/403/413/500/network).
  - Component tests in `space-view.test.ts` access private state/methods via `(element as any)` cast. Must set `isLoading = false` before mounting to DOM for render tests, otherwise "Loading space…" is shown.
  - Lit's `nothing` sentinel is `Symbol(lit-nothing)`, not `undefined` — import `nothing` from 'lit' for assertions.
  - Nested Lit template content (e.g. inside `.map()` or ternary) appears as dynamic values, not in static `strings` array of the outer TemplateResult. DOM-based assertions (mount + `innerHTML`) work for nested content.
  - `transferItem()` sends POST with JSON body `{ destinationSpaceId, destinationToken, action }` and `Content-Type: application/json` header alongside Bearer auth.
  - Key test files: `src/SharedSpaces.Client/src/features/space-view/space-api.test.ts`, `src/SharedSpaces.Client/src/features/space-view/space-view.test.ts`.
  - Playwright screenshots for transfer UI verify button placement, modal layout, loading states, and responsive design (390×844 mobile, 1280×720 desktop). Mobile layout checked for text overflow, button wrapping, truncation.
