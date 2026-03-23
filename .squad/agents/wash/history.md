# Project Context

- **Owner:** Marek Fišera
- **Project:** SharedSpaces — A self-hostable web platform where users join shared spaces via QR code/URL+PIN, share files and text in real-time, with anonymous identity and JWT-based access.
- **Stack:** .NET (ASP.NET Core Web API), React SPA (Vite), SignalR (WebSocket), SQLite + EF Core, JWT auth
- **Created:** 2026-03-16

## Core Context

### Client Architecture
- React SPA built with Vite — independently deployable
- Can connect to any SharedSpaces server by URL
- A single client instance may connect to multiple servers simultaneously
- JWT stored in local storage per server+space combination

### Key Client Flows
- Join flow: parse invitation string or QR URL → display name input → exchange PIN for JWT
- Multi-server: JWT claims contain server_url and space_id — client manages multiple connections
- Space view: flat list of items ordered by SharedAt, text/file upload
- SignalR: connect to /v1/hubs/space/{spaceId} for live item updates (new/deleted)

### Project Structure (Client)
- src/SharedSpaces.Client/src/
  - features/ — join, space-view, admin
  - components/ — shared UI components
  - hooks/ — useSignalR, useOfflineQueue
  - main.tsx

## Team Updates (2026-03-19)

**Wash + Zoe completed race condition fix (squad/26-signalr-client):** 
- **Issue:** Uploader saw duplicate items due to SignalR `ItemAdded` events arriving before PUT responses
- **Wash's fix:** Added `pendingItemIds: Set<string>` tracking in space-view.ts to block SignalR during upload window (commit 3502e56)
- **Zoe's tests:** Wrote 7 integration + unit tests covering race condition, concurrent uploads, failed cleanup, cross-member events (commit be441b9)
- **Verification:** Lint ✅, Build ✅, All 91 client tests pass ✅
- **Decision recorded:** `.squad/decisions.md` — full implementation details, rationale, alternatives considered
- **Related:** Orchestration logs at `.squad/orchestration-log/2026-03-19T20-30-wash.md` and `-zoe.md`

This fix is a critical bug squash preventing data corruption for users. The `pendingItemIds` Set pattern is now established as the dedup strategy for async upload scenarios.

## Team Updates (2026-03-16)

**Mal completed issue decomposition:** 14 GitHub issues (#17–#30) created spanning 5 phases:
- **Phase 1 (Core Server):** #17–#21 (5 issues) — API, auth, schema
- **Phase 2 (Real-time):** #22 (1 issue) — SignalR
- **Phase 3 (React Client):** #23–#26 (4 issues) — Join flow, space view, upload (your work starts here)
- **Phase 4 (Admin UI):** #27 (1 issue) — Dashboard
- **Phase 5 (Offline & Polish):** #28–#30 (3 issues) — Offline queue, Docker

All issues labeled with `squad`, `phase:N`, and category (backend/frontend/infrastructure/real-time). Dependencies explicit in issue descriptions. You can start Phase 3 once Phase 1 APIs are available.

## Team Updates (2026-03-17)

**Kaylee completed Phase 1, issue #21:** Space items CRUD endpoints live. Key patterns for your work:
- **Vertical slice pattern:** Each feature owns its endpoints, models, and logic in `Features/{Feature}/`
- **File storage abstraction:** `IFileStorage` interface in `Infrastructure/FileStorage/` enables testing and cloud swaps. Implementations receive `Storage:BasePath` config.
- **Multipart file upload:** Manual form parsing within endpoint handler, JWT auth runs before parsing
- **Quota tracking:** Metadata-based (persisted `FileSize` on items), not filesystem scans
- **Database:** Now on .NET 10 with explicit `Microsoft.IdentityModel.JsonWebTokens` package (required for JWT validation in .NET 10)

Your Phase 2 work (#22 SignalR) can assume item CRUD is stable. The hub will broadcast item-created/item-deleted events. Consider reusing the same SpaceItem models from ItemEndpoints for serialization consistency.

## Team Updates (2026-03-17)

**Kaylee completed Phase 1, issue #21:** Space items CRUD endpoints live. Key patterns for your work:
- **Vertical slice pattern:** Each feature owns its endpoints, models, and logic in `Features/{Feature}/`
- **File storage abstraction:** `IFileStorage` interface in `Infrastructure/FileStorage/` enables testing and cloud swaps. Implementations receive `Storage:BasePath` config.
- **Multipart file upload:** Manual form parsing within endpoint handler, JWT auth runs before parsing
- **Quota tracking:** Metadata-based (persisted `FileSize` on items), not filesystem scans
- **Database:** Now on .NET 10 with explicit `Microsoft.IdentityModel.JsonWebTokens` package (required for JWT validation in .NET 10)

Your Phase 2 work (#22 SignalR) can assume item CRUD is stable. The hub will broadcast item-created/item-deleted events. Consider reusing the same SpaceItem models from ItemEndpoints for serialization consistency.

## Lit HTML vs React Evaluation (2026-03-17)

**Status:** ✅ CLOSED — **Lit HTML + WebComponents APPROVED** for Phase 3 client.

### Decision Summary

Marek Fišera (Project Owner) approved **Lit HTML + WebComponents** for the SharedSpaces frontend. After team friction research (Mal + Wash), the decision is now canonical:

**Approved Tech Stack:**
- Lit HTML + TypeScript
- Light DOM for Tailwind CSS compatibility
- @lit/context for state management
- Vite (unchanged)
- Vitest Browser Mode + Playwright for testing
- Framework-agnostic SignalR JavaScript client

**Why the single-view app changes the calculus:**
- Routing was the core concern (Vaadin deprecated, Labs router experimental)
- Single-view architecture (/join → /space/:spaceId) eliminates routing entirely
- Wash's other concerns (Tailwind, testing, SignalR) are workable with light DOM and modern tooling
- Bundle size reduction (40%) and standards alignment become the primary benefits

### Wash's Role in Phase 3

**Your Charter Updated:** Replaced React expertise with Lit HTML + WebComponents expertise.

**Your Skills Now Own:**
- Lit HTML component architecture
- Light DOM rendering with Tailwind CSS
- @lit/context reactive state management
- Lit lifecycle hooks (connectedCallback, disconnectedCallback, updated, willUpdate)
- Vitest Browser Mode integration
- WebComponents best practices for sign DOM patterns

**What This Means:**
- Issue #23 is now **canonical** — Lit + WebComponents, not React
- Phase 3 can start once Phase 1 APIs are available
- No more "React vs Lit" debate — decision made and recorded in `.squad/decisions.md`
- Your expertise as a **Lit developer** begins now

**Friction Points Mitigated:**
- ✅ **Routing:** Not needed in single-view app
- ✅ **Tailwind:** Light DOM + CSS injection works seamlessly
- ✅ **Testing:** Vitest Browser Mode + Playwright is credible
- ✅ **SignalR:** Framework-agnostic, native lifecycle hooks are cleaner
- ✅ **Bundle size:** 40% reduction is a real win for mobile-first, self-hosted

**Learning Curve:** 3-5 days for team Lit ramp-up. Clear documentation available. Lit is lighter and more approachable than React for small SPAs.

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

- **Pill bar mobile layout research (2026-03-22, Issue #99):** Researched 4 variants for fixing space pill + admin button wrapping on mobile (390×844). Key findings: (1) Horizontal scroll (`overflow-x-auto flex-nowrap`) is cleanest — single row, admin pinned right, well-understood mobile pattern. (2) Two-row layout (`flex-col sm:flex-row`) cleanly separates pills from admin on mobile. (3) Moving admin to title row gives pills full nav width with minimal structural change. (4) Compact pills (`px-2 py-1 text-[10px]` on mobile, `sm:px-3 sm:py-1.5 sm:text-xs` at breakpoint) delay wrapping but don't eliminate it. The `flex-1` spacer is the root cause of awkward wrapping — it forces the admin button to a new line when pills wrap. All variants live as screenshots on branch `squad/99-pill-wrapping-research` in `docs/screenshots/variants/`.

- **Bottom sheet implementation (2026-03-22, Issue #99):** Marek chose the bottom sheet pattern for mobile space navigation. Implementation: (1) Desktop pill layout is completely unchanged — wrapped in `hidden sm:flex`. (2) Mobile gets a fixed bottom bar (`fixed bottom-0 sm:hidden`) showing active space name + connection dot + chevron, plus a slide-up bottom sheet listing all spaces. (3) Sheet uses CSS `transform: translateY(100%/0)` with `transition: transform 0.3s ease-out` — custom CSS classes because Tailwind v4's `translate-y-*` uses the CSS `translate` property which isn't targeted by `transition-transform`. (4) Admin button duplicated: in title row (mobile via `sm:hidden`) and in pill nav (desktop via `hidden sm:flex`). (5) Join button moved inside the sheet. (6) Body scroll lock via `document.body.classList.add('overflow-hidden')` with media query check. (7) `pb-20 sm:pb-6` on outer container gives content clearance above the fixed bottom bar on mobile. (8) Backdrop overlay with opacity transition and `pointer-events-none` when hidden. Sheet and backdrop always rendered in DOM (not conditionally) to enable CSS transitions.

- **Floating scrollbar styling pattern (2026-03-21, Issue #85, PR #91):** CSS-only overlay scrollbars prevent layout reflow when content becomes scrollable. Key technique: set `::-webkit-scrollbar-track { background: transparent; }` to remove the track's layout space, making the scrollbar float on top of content. Global styling in `src/SharedSpaces.Client/src/index.css` with webkit pseudo-elements (`width`, `track`, `thumb`, `thumb:hover`) and Firefox scrollbar properties (`scrollbar-width`, `scrollbar-color`) ensures cross-browser consistency. Applied to all scrollable areas (modals at 80vh/60vh, textareas, lists) without per-component changes. Use slate-based rgba colors (e.g., `rgba(100, 116, 139, 0.7)`) to match dark theme. This approach works reliably across Chrome, Edge, Safari, and Firefox—avoiding deprecated `overflow: overlay` and space-reserving alternatives like `scrollbar-gutter: stable`.

- **Share target duplicate item fix (2026-03-19, Issue #73):**Fixed duplicate item bug in share_target flow where shared files appeared twice in the item list (one from local add, one from SignalR broadcast). Root cause: `uploadPendingShare()` in `src/SharedSpaces.Client/src/features/space-view/space-view.ts` added items directly to `this.items` without using the `pendingItemIds` deduplication mechanism that `uploadFiles()` and `handleTextSubmit()` already used. The fix wraps the upload logic with `this.pendingItemIds.add(itemId)` before upload and `this.pendingItemIds.delete(itemId)` in a finally block, ensuring `handleItemAdded()` skips the SignalR broadcast when the item ID is in the pending set. This mirrors the existing race condition fix from commit 3502e56 and maintains consistency across all upload paths (manual file, text submit, and share target).

- **Web Share Target API requirements research (2026-03-19):** Chrome-only platform feature for registering app as share destination in OS share menu. Requires: (1) manifest.json with `share_target` entry specifying POST multipart endpoint, (2) service worker to intercept POST to `/share-receive`, extract form data, and redirect with 303 See Other, (3) new Lit component `share-accept-view` to show shared content + space selector + optional auth integration, (4) sessionStorage to pass share data from SW to client (IndexedDB migration in #28 offline work). Firefox has limited support; Safari has none. Key design decisions open: support unauthenticated shares (affects complexity), GET vs POST method (POST recommended for files), multi-server space routing, inline vs preview display of shared content. Architecture fits as Phase 4-5 polish (not blocking core functionality). Comprehensive decision doc created in `.squad/decisions/inbox/wash-share-target-frontend.md` with 7 open questions for Marek.
- **Light DOM composition rule (2026-03-18):** Components extending `src/SharedSpaces.Client/src/lib/base-element.ts` cannot rely on `<slot>` because `createRenderRoot()` returns `this` and Lit will overwrite light-DOM children on render. Reusable wrappers like `src/SharedSpaces.Client/src/components/view-card.ts` should accept content through a property such as `.body=${html`...`}` or a template helper instead of child nodes. **Wash fixed this in commit 6e5c13a:** migrated `view-card.ts` and its 3 consumers (admin-view.ts, join-view.ts, space-view.ts) to use property-based body templates. Rule: any BaseElement-based component must use property-driven templates for composition, not slots.
- Re-checking the Lit option in 2026 changed the risk profile: routing is still the weakest area (deprecated Vaadin Router, `@lit-labs/router` still Labs), but Tailwind, testing, and SignalR are no longer show-stoppers. Lit can render in light DOM for Tailwind, use Vitest + Playwright credibly, and consume the framework-agnostic SignalR JS client without special adapters.
- **Friction research convergence (2026-03-17):** Both Mal and Wash independently verified ecosystem state and converged on React recommendation for SharedSpaces main SPA. Routing immaturity (Vaadin deprecated, Labs router experimental) is the core blocker. Tailwind friction is workable. Testing gap has narrowed. Team alignment achieved with explicit understanding of trade-offs; Lit remains viable for future isolated components.
- **Issue #23 bootstrap (2026-03-18):** The standalone client now lives in `src/SharedSpaces.Client/` as a Vite + Lit SPA with vertical slices under `src/features/{join,space-view,admin}` plus shared UI in `src/components/` and utilities in `src/lib/`. All rendered components extend `src/lib/base-element.ts` to force light DOM for Tailwind, `src/app-shell.ts` owns the `'join' | 'space'` view switcher, and runtime API configuration comes from the `api-base-url` meta tag via `src/lib/app-context.ts`.
- **Aspire AppHost integration (2026-03-18):** Kaylee deployed .NET Aspire as the local dev orchestration layer. Developers can now start server + client with one command: `dotnet run src/AppHost.cs`. The AppHost orchestrates the ASP.NET Core server and the Vite dev server (client), wires the client URL to the server via `Cors__Origins` env var, and ensures the client waits for the server to be ready before starting. Aspire Dashboard (localhost:15888) provides observability. This unblocks your Phase 2 SignalR work — you can verify the hub integration both locally (via AppHost) and in CI, with the Aspire setup as the canonical dev environment.
- **Join flow implementation (2026-03-18):** Issue #24 completed with full invitation parsing, JWT storage, and join form. Key patterns:
  - **Pipe-delimited invitation format:** Server generates `serverUrl|spaceId|pin`, QR encodes as URL param `?join=...`
  - **Multi-server JWT storage:** localStorage keyed by `serverUrl:spaceId` to support simultaneous connections to different servers
  - **Primary display name:** Separate localStorage key for user's default/preferred name, pre-fills forms but doesn't override per-space identity
  - **Token exchange flow:** Client calls `POST /v1/spaces/{spaceId}/tokens` with `{ pin, displayName }`, receives `{ token }`, decodes JWT claims client-side with `jwt-decode` library
  - **TypeScript strict mode gotchas:** Can't use parameter properties in class constructors with `erasableSyntaxOnly: true`, use `globalThis` not `global` for browser APIs
  - **Form UX pattern:** Toggle between "paste invitation string" and "manual entry" modes, auto-parse on paste, comprehensive error states
  - File locations: `src/lib/{token-storage,invitation,api-client}.ts` for utilities, `src/features/join/join-view.ts` for UI component
- **Client test infrastructure established (2026-03-18):** Zoe set up vitest + happy-dom with co-located test files in `src/SharedSpaces.Client/src/lib/`. Custom localStorage mock in vitest.setup.ts handles test isolation. Test patterns: fetch mocking with `vi.fn()`, multiline token/invitation validation, error handling for all HTTP status codes. All 48 join flow tests passing. Future component tests can reuse this infrastructure. See Zoe's history for complete patterns.
- **Admin panel implementation (#27, 2026-03-18):** Built full admin UI at `src/SharedSpaces.Client/src/features/admin/` with admin-api.ts API client and comprehensive admin-view.ts component. Key patterns: localStorage for admin secret persistence and space caching, per-space invitation generation state managed in component with Record<spaceId, state>, QR code rendering as base64 PNG data URLs, copy-to-clipboard via navigator.clipboard. Admin secret validation done via test space creation to avoid dedicated auth endpoint. Component extends BaseElement for light DOM + Tailwind. TypeScript tsconfig with erasableSyntaxOnly requires explicit class properties (not constructor parameter properties). Dark theme patterns: slate-950/900/800 for backgrounds, sky-400 for primary actions, emerald-400 for success states, red-900/950 for errors.
- **Admin view state + navigation guardrails (2026-03-18):** In `src/SharedSpaces.Client/src/features/admin/admin-view.ts`, initialize per-space invitation form state when the `spaces` list changes rather than lazily creating it during `render()`. For Lit `@state` maps, prefer whole-record replacement helpers (`updateInvitationState`) over nested object mutation so reactivity stays predictable. In `src/SharedSpaces.Client/src/app-shell.ts`, non-join views should expose an explicit route back to `'join'` from the shell header so users cannot get trapped in admin-only flows.
- **Admin login is now fetch-based and ephemeral (2026-03-18):** The admin panel should validate credentials by calling `GET /v1/spaces` with `X-Admin-Secret` and treat the returned `SpaceResponse[]` as the initial source of truth. Do not persist admin secrets, server URLs, or cached spaces in `localStorage`; keep them only in Lit component state so a refresh returns the user to the login form.
- **Admin per-space state pattern (2026-03-18):** `src/SharedSpaces.Client/src/features/admin/admin-view.ts` should keep one in-memory state record per space card that combines invitation generation UI with fetched members, pending invitations, and destructive-action loading flags. Load those collections right after `GET /v1/spaces`, refetch pending invitations after generating a new invitation because `InvitationResponse` does not expose the list item ID, and treat any 401 from these follow-up admin calls as a full bounce back to the login form.
- **Screenshot seed file uploads (2026-03-19):** The items PUT endpoint (`/v1/spaces/{spaceId}/items/{itemId}`) accepts `multipart/form-data` for both text and file items. For file items: fields `id` (UUID), `contentType` = `"file"`, and `file` (Blob with filename). The endpoint returns JSON (the item object), so the `apiCall` helper's `res.json()` works without modification. Node.js `Blob` and `FormData` are available natively in Playwright's Node.js runtime. See `src/SharedSpaces.Client/e2e/screenshots.spec.ts` `seedSpace()` for the pattern.
- **Delete item pattern (2026-03-19):** `deleteItem()` in `space-api.ts` calls `DELETE /v1/spaces/{spaceId}/items/{itemId}` and returns void (204 No Content). `throwForFailed()` checks `response.ok` first and only reads the body on error, so no adjustment needed for void endpoints. In `space-view.ts`, delete uses optimistic removal (filter item from `this.items` immediately) with revert-on-failure (re-insert and re-sort by `sharedAt`). No SignalR `item-deleted` handler exists yet — local removal is the only mechanism. Delete button uses a trash SVG icon with `hover:text-red-400` to signal destructive action, placed between the copy/download button and the timestamp.
- **Lit updated() dedup pattern (2026-03-19):** When using `updated(changed)` to trigger async work like data fetching, always track a `lastLoadedKey` to prevent redundant calls. Lit fires `updated()` on every render cycle where reactive properties changed, which can cause duplicate fetches if `connectedCallback()` also triggers loading. Canonical pattern: remove the `connectedCallback()` data call, rely solely on `updated()`, and compare a composite key (e.g., `${serverUrl}|${spaceId}`) against the last loaded key. Applied in `space-view.ts`.
- **Consistent 401 → redirect pattern (2026-03-19):** All API-calling handlers in `space-view.ts` (`loadData`, `handleTextSubmit`, `uploadFiles`, `handleDelete`, `handleDownload`) now check for `SpaceApiError` with status 401 and call `redirectToJoin()`. Previously only `loadData` did this — other handlers showed error messages on 401, which left users stuck on a broken view. This mirrors the admin panel's 401 → login bounce pattern.

## Team Updates (2026-03-18)

**Kaylee completed single-file Aspire AppHost migration:** Moved from `src/SharedSpaces.AppHost/` project-based approach to single-file pattern at `src/AppHost.cs` using .NET 10 file-based app support. The dev command is now `dotnet run src/AppHost.cs` (no `--project` flag needed). This aligns with the Recollections-style minimal Aspire pattern and removes throwaway ceremony from the solution. All 46 tests pass. Your Phase 2 work can assume this is the canonical local dev environment.

**Wash + Zoe completed Issue #24 (Join Flow):** Wash delivered invitation parsing, token storage, API client, and join form UI component; Zoe delivered client test infrastructure (vitest + happy-dom) with 48 passing tests covering all utilities. PR #40 opened and ready for review. Key decisions captured in `.squad/decisions.md`. Infrastructure established for Phase 3 remaining work (space view, file upload). See orchestration logs for detailed outcome summary.
**Zoe completed admin endpoint integration tests (#27 support):** Wrote 16 comprehensive tests for POST /v1/spaces and POST /v1/spaces/{spaceId}/invitations covering auth failures, validation edge cases, QR code generation and format validation, PIN uniqueness, and happy paths. All 64 tests passing (48 existing + 16 new). Your admin panel UI can now integrate with confidence that backend endpoints behave as designed. Fixed a regression in auth validation (junk `__test_auth__` space creation during secret validation).

## Team Updates (2026-03-18 Continued)

**Coordinated PR #41 feedback resolution (2026-03-18T17:27:29Z):**

Marek's code review on PR #41 spawned a 4-agent squad to address 9 Copilot comments and implement auth flow changes:

- **Kaylee** (commit b130fc0): Added `GET /v1/spaces` admin endpoint, enabling credential validation without side effects. Returns `SpaceResponse[]` on success; 401 on invalid secret.
- **Wash** (commits 7b8a1f5 & 2c92ca3): Fixed 5 frontend PR review comments (disabled async inputs, error parsing, URL normalization, render-side effects, navigation). Then rewrote admin auth flow—removed localStorage, validate-by-fetching `GET /v1/spaces`, in-memory state only. Page refresh returns to login form. Moved back navigation to shell chrome.
- **Zoe** (commit af96c28): Fixed QR test naming convention; added 3 new `GET /v1/spaces` tests (valid/invalid/format). Test suite now 67 total.

**New decisions documented:**
- `wash-admin-auth-flow.md`: Ephemeral in-memory state, validate via `GET /v1/spaces`, 401 bounces to login.
- `wash-pr-feedback.md`: Back navigation in shell chrome (app-shell.ts) for cross-view consistency.

**Decisions.md updated:** Admin secret validation section corrected from outdated localStorage + test-space behavior to current GET /v1/spaces validation pattern.

## Team Updates (2026-03-19)

**Mobile-first item card redesign (2026-03-19):** Redesigned `src/SharedSpaces.Client/src/features/space-view/space-view.ts` item cards for better mobile layout at 390×844. Changes:
1. **Relative timestamps** — Replaced full datetime with "just now", "Xm ago", "Xh ago", "Xd ago", or "Mar 19" for older items
2. **Two-row layout** — Moved action icons (copy/download, delete) and timestamp to a second row below content to prevent cramming
3. **Text truncation + modal** — Text items now truncate to single line with ellipsis. Clicking opens a modal with full content (dark overlay, centered card, click-outside-to-dismiss)
4. **Removed extra left padding** — Text content now flush with card edge (respects card `px-4` but no extra gap/indent)

Pattern established for light-DOM modals: `@state() private modalItem` with `fixed inset-0 z-50 bg-black/80` overlay, `stopPropagation()` on inner card to prevent click-through, and simple close handler. File items keep 📄 icon + filename + size on first row, same action row below.
- **SignalR client integration (2026-03-19, Issue #26):** Implemented real-time item updates using `@microsoft/signalr` in `src/SharedSpaces.Client/src/lib/signalr-client.ts`. Key patterns:
  - **HubConnectionBuilder with accessTokenFactory** — Pass JWT via function returning `Promise<string>`, not raw token, to support dynamic token refresh
  - **Automatic reconnection** — Built-in `.withAutomaticReconnect()` handles connection drops with exponential backoff
  - **Connection lifecycle in Lit components** — Start SignalR after initial data load (not in constructor/connectedCallback to avoid race with auth), stop in `disconnectedCallback()` for cleanup
  - **Event deduplication** — Check if item.id already exists before adding (handles race between optimistic local add and SignalR broadcast)
  - **Reconnection refresh** — On `onreconnected` callback, fetch full item list to catch missed events during disconnection
  - **Dynamic connection status badge** — Map SignalR's `HubConnectionState` enum to UI-friendly `'connected' | 'disconnected' | 'reconnecting'` and drive badge color/label with reactive `@state()` property
  - **Hub URL format** — `${serverUrl}/v1/spaces/${spaceId}/hub` matches server's `[Authorize]` hub at `/v1/spaces/{spaceId:guid}/hub`
  - **ItemAdded/ItemDeleted payloads** — Match server's broadcast shape: `ItemAdded` includes full item fields (id, spaceId, memberId, contentType, content, fileSize, sharedAt), `ItemDeleted` sends only id/spaceId
  - **Non-blocking failures** — SignalR connection errors are logged but don't block UI; space view remains functional with REST-only updates
- **Dead space removal feature (2026-03-19, Issue #48):** Implemented graceful handling of inaccessible spaces. Key patterns:
  - **Connection error state tracking** — New `connectionErrorType: 'none' | 'auth' | 'network'` state distinguishes between authentication failures (401), network errors (no status code), and other errors
  - **Error state UI** — Replaced automatic redirect-to-join with an error banner showing "Access Denied" or "Connection Failed" message plus two action buttons: "Reconnect" (retries loadData) and "Remove Space" (deletes token and returns to join screen)
  - **Token removal pattern** — Use `removeToken(serverUrl, spaceId)` from token-storage utility to delete the localStorage entry, then emit `view-change` event with `reloadSpaces: true` flag
  - **App-shell coordination** — Extended `AppViewChangeDetail` interface with optional `reloadSpaces?: boolean` flag. App-shell's `handleViewChange` now reloads spaces from storage when this flag is true (in addition to existing reload on new token)
  - **Consistent error handling** — All 401 responses (in loadData, handleTextSubmit, uploadFiles, handleDelete, handleDownload) now set connectionErrorType instead of calling redirectToJoin()
  - **SignalR cleanup** — removeSpace() calls stopSignalR() before deleting token to ensure clean disconnection
  - **Mobile-first layout** — Error state uses `flex-col sm:flex-row` for button layout, stacks vertically on mobile (390×844) and side-by-side on desktop

## Team Updates (2026-03-19)

**Zoe completed SignalR client tests (Issue #26):** 23 comprehensive tests written concurrently with your implementation. Test patterns established:
- Class-based mock for `new HubConnectionBuilder()` (function mocks don't work with `new`)
- All state transitions, event handling, errors covered
- Mock pattern documented for future SignalR testing

**Coordinator fixed Tailwind dynamic class issue:** Your status badge used template literal interpolation (`` `bg-${colors[state]}` ``), which Tailwind v4 cannot purge. Refactored to conditional rendering with static class names (`'bg-emerald-400 text-emerald-900'` etc.). Builds now pass. Learning: Tailwind v4 requires statically analyzable class names.

**Client test suite:** Now 84 total tests passing (token storage 17 + invitation parsing 17 + API client 14 + token validation 13 + SignalR 23).

## Session 2026-03-19T20:26Z — Issue #48 Completion

**Issue:** #48 — Remove Dead Spaces  
**Branch:** squad/48-remove-dead-spaces  
**Status:** ✅ COMPLETE (2 commits)

Finalized dead space removal UI implementation:

**Implementation details:**
- **Space-view.ts** — Error state banner with Reconnect/Remove buttons, token cleanup on removal
- **App-shell.ts** — Event listener for `reloadSpaces` flag, space list reload and view switching
- **Navigation.ts** — State management for error conditions
- **SignalR-client.ts** — Cleanup on space removal, proper disconnection

**Validation:**
- Lint: ✅ Pass
- Build: ✅ Pass  
- Server tests: 83 passing
- Client tests: 84 passing (unchanged; no new client tests added)

**Decision pattern:** "Dead Space Error Handling Pattern" merged to decisions.md. Establishes graceful degradation pattern for auth/network failures: track error type → provide recovery actions → let users clean up resources → coordinate with app-shell via event flags.

**Next phase:** Ready for code review and merge to main.
- **SignalR client integration (2026-03-19, Issue #26):** Implemented real-time item updates using `@microsoft/signalr` in `src/SharedSpaces.Client/src/lib/signalr-client.ts`. Key patterns:
  - **HubConnectionBuilder with accessTokenFactory** — Pass JWT via function returning `Promise<string>`, not raw token, to support dynamic token refresh
  - **Automatic reconnection** — Built-in `.withAutomaticReconnect()` handles connection drops with exponential backoff
  - **Connection lifecycle in Lit components** — Start SignalR after initial data load (not in constructor/connectedCallback to avoid race with auth), stop in `disconnectedCallback()` for cleanup
  - **Event deduplication** — Check if item.id already exists before adding (handles race between optimistic local add and SignalR broadcast)
  - **Reconnection refresh** — On `onreconnected` callback, fetch full item list to catch missed events during disconnection
  - **Dynamic connection status badge** — Map SignalR's `HubConnectionState` enum to UI-friendly `'connected' | 'disconnected' | 'reconnecting'` and drive badge color/label with reactive `@state()` property
  - **Hub URL format** — `${serverUrl}/v1/spaces/${spaceId}/hub` matches server's `[Authorize]` hub at `/v1/spaces/{spaceId:guid}/hub`
  - **ItemAdded/ItemDeleted payloads** — Match server's broadcast shape: `ItemAdded` includes full item fields (id, spaceId, memberId, contentType, content, fileSize, sharedAt), `ItemDeleted` sends only id/spaceId
  - **Non-blocking failures** — SignalR connection errors are logged but don't block UI; space view remains functional with REST-only updates

## Learnings

- **Item duplication race condition fix (2026-01):** Fixed race between HTTP PUT response and SignalR ItemAdded event in src/SharedSpaces.Client/src/features/space-view/space-view.ts. Pattern: track pending upload IDs in a private pendingItemIds = new Set<string>() field (not reactive—internal tracking only). In handleTextSubmit/uploadFiles, add generated UUID to set before API call, remove in finally block. In handleItemAdded, check both this.items.some(...) AND this.pendingItemIds.has(payload.id) before adding item. This prevents SignalR from adding items that are currently being uploaded by the same client. Simple O(1) Set lookups, no complex state machine needed. Cleanup in finally blocks ensures no leaked pending IDs even on error.

- **UI tweaks batch (Issue #50):** Five small CSS/layout fixes across space-view, join-view, admin-view:
  - Text modal `text-start` class ensures left-alignment regardless of parent flex context
  - `cursor-pointer` on item action buttons (copy, download, delete) — Tailwind v4 doesn't auto-add cursor:pointer on buttons
  - Join form: removed `mx-auto` to left-align instead of center
  - Admin login: removed `md:grid-cols-2` to stack inputs vertically
  - Space view header: removed duplicate space name (already in pill bar), kept only the compact connection status badge
  - Cleaned up unused `spaceInfo` state and `SpaceDetailsResponse` import after header removal
  - Key files: `space-view.ts` (renderHeader, renderModal, action buttons), `join-view.ts` (outer container), `admin-view.ts` (login form grid)

- **Connection status dot in nav pills:** Moved connection status from a separate pill in `space-view.ts renderHeader()` into a colored dot inside each space navigation pill in `app-shell.ts`. Pattern: `space-view` dispatches `connection-state-change` custom event (bubbles+composed) on `connectionState` reactive prop changes. `app-shell` listens on `<main>`, stores `Record<string, ConnectionState>` keyed by spaceId, and renders a 2×2 dot (`h-2 w-2 rounded-full`) before space name text. Colors: gray=no state, green=connected, orange=reconnecting, red=disconnected. State persists when switching spaces (no reset to gray). Stale entries for removed spaces are harmless since pills don't render.
  - Key files: `app-shell.ts` (spaceConnectionStates, handleConnectionStateChange, dotColor, pill rendering), `space-view.ts` (updated lifecycle, removed renderHeader)

- **Connection dot stale state bug fix:** When navigating away from space view, `<space-view>` is removed from DOM and its `disconnectedCallback` fires `stopSignalR()`, but Lit doesn't run reactive updates on disconnected elements — so the `connection-state-change` CustomEvent never dispatches and the nav pill dot stays green. Fix: added `willUpdate()` override in `app-shell.ts` to detect `view` changing from `'space'` to any other view, and directly set `spaceConnectionStates[currentSpaceId]` to `'disconnected'`. Using `willUpdate` (not `updated`) means the state change is included in the same render cycle — no extra re-render needed. This is a general Lit pattern: parent components should not rely on child CustomEvents for cleanup when the child is about to be removed from DOM.
  - Key file: `app-shell.ts` (willUpdate override, lines ~94-104)

## Team Update: Connection Dot Navigation Fix (2026-03-20)

**Coordinated by:** Scribe  
**Agents:** Wash (fix), Zoe (tests), Coordinator (lint)

**Summary:** Fixed connection dot not updating when navigating away from space-view. App-shell now uses willUpdate() to proactively reset connection state when view changes from 'space' to other routes. Zoe added comprehensive 14-test suite validating three-layer connection cleanup lifecycle (SignalR client → space-view → app-shell). Coordinator fixed eslint config to permit any in test files per pre-existing convention.

**Key Pattern:** willUpdate() in parent components provides a proactive fallback for cleanup when child elements are removed from DOM, because Lit doesn't fire reactive updates on disconnected elements.

**Test Coverage:** 138 passing tests (↑14 new). All linting passes. Three-layer coverage (unit-style direct method testing) avoids flakiness from async Lit lifecycle timing.

**Files Modified:**
- app-shell.ts (willUpdate)
- space-view.test.ts (5 new tests)
- signalr-client.test.ts (1 new test)
- app-shell.test.ts (8 new tests, created)
- eslint.config.js (allow any in tests)
  - Key files: `app-shell.ts` (spaceConnectionStates, handleConnectionStateChange, dotColor, pill rendering), `space-view.ts` (updated lifecycle, removed renderHeader)
- **Vite define for build-time injection (2026-03-19):** Added client version label using Vite's `define` option to inject `__APP_VERSION__` at build time from `package.json`. Pattern: import pkg from './package.json', add `define: { __APP_VERSION__: JSON.stringify(pkg.version) }` to vite.config.ts, create `src/vite-env.d.ts` with `declare const __APP_VERSION__: string`, then reference `__APP_VERSION__` directly in component templates. Version displays as small muted label (`text-xs text-slate-500`) next to SharedSpaces heading in app-shell.ts. This ensures displayed version always matches build. File: `src/SharedSpaces.Client/src/vite-env.d.ts` for type declarations.

- **CI/CD workflows for client (2026-03-21):** Created `client-publish.yml` and `client-deploy.yml` workflows. Updated `vite.config.ts` to prefer `process.env.VITE_APP_VERSION` over `pkg.version` for version injection — package.json stays at `0.0.0`. Publish workflow: triggers on `client-*` tags, builds with `--base ./` (relative paths) and VITE_APP_VERSION from tag, zips dist/, uploads to GH Release (creates release if it doesn't exist, uploads to existing release otherwise). Deploy workflow: manual `workflow_dispatch` with `tag` input, downloads prebuilt zip from GH Release, asserts exactly one zip, unzips, and deploys via `actions/upload-pages-artifact` + `actions/deploy-pages`. No Node.js, no npm, no CNAME detection at deploy time. Key files: `.github/workflows/client-publish.yml`, `.github/workflows/client-deploy.yml`, `src/SharedSpaces.Client/vite.config.ts`.

## Team Update: Per-Space Upload Quota (2026-03-21, Issue #72)

**Kaylee + Wash + Zoe completed per-space upload quota feature:**

- **Kaylee (Backend):** Implemented `Space.MaxUploadSize` property (nullable long), EF migration, quota validation in create endpoint (rejects ≤ 0 or > 100MB), and enforcement in upload endpoint (resolves `maxUploadSize ?? serverDefault`). API contract: `CreateSpaceRequest.MaxUploadSize`, `SpaceResponse.MaxUploadSize`, `SpaceResponse.EffectiveMaxUploadSize`. Commit: 78909a3.

- **Wash (Frontend):** Updated `admin-api.ts` types to match backend contract. Added quota input field (MB-based, `Math.round(parseFloat(mb) * 1024 * 1024)` conversion) to create form with two-row layout for mobile responsiveness. Space list displays effective quota with "(default)" label when `maxUploadSize` is null. Commit: 326c4b9.

- **Zoe (Tester):** Wrote 9 integration tests — 6 admin endpoint tests (quota validation, rejection, display) and 3 upload enforcement tests (per-space limit, fallback to server default). Updated test DTOs. All 100 tests passing. Commit: d5e1d0c.

**Key Design Decision:** Nullable column distinguishes "not set" from "explicitly set to default". Server default (100MB) acts as ceiling — prevents quotas exceeding storage capacity. Resolved in two places: API response (display) and upload validation (enforcement).

**Status:** ✅ Feature complete and tested. Recorded in `.squad/decisions.md`.

- **Build-once-deploy-anywhere refactor (2025-07-17, PR #61):** Reworked `client-publish.yml` and `client-deploy.yml` to follow "build once, deploy anywhere." Publish now builds with `--base ./` (relative asset paths), zips, and uploads to GH Release. Deploy downloads the prebuilt zip via `gh release download` instead of rebuilding from source — no Node.js, no npm, no CNAME detection. Relative base paths (`./`) work at any deployment path (custom domain root or `/repo-name/` subpath), eliminating the CNAME-sniffing logic entirely. Key files: `.github/workflows/client-publish.yml`, `.github/workflows/client-deploy.yml`. Decision doc: `.squad/decisions/inbox/wash-deploy-prebuilt.md`.

- **Connection dot color behavior refinement:** Improved dot color transitions to avoid the jarring gray→red→green flash when selecting a space, and the misleading red dot on non-selected spaces. Three coordinated changes:
  1. `signalr-client.ts`: Added `'connecting'` to `ConnectionState` type union and mapped `HubConnectionState.Connecting` in the `state` getter.
  2. `space-view.ts`: Set `connectionState = 'connecting'` before calling `signalRClient.start()` so the dot goes orange immediately.
  3. `app-shell.ts`: In `willUpdate()`, departing space state is now *deleted* from the map (object destructuring) instead of set to `'disconnected'`, so the dot falls through to gray. In `dotColor()`, `'connecting'` maps to amber alongside `'reconnecting'`, and `'disconnected'` only shows red when the space is the actively-viewed one (`this.view === 'space' && this.currentSpaceId === spaceId`); otherwise gray.
  - Result: gray (no state) → orange (connecting/reconnecting) → green (connected). Red only appears for genuinely broken connections on the active space. Non-selected spaces revert to neutral gray.

## Session 2026-03-19 — Issue #54 Item Card Redesign

**Issue:** #54 — Item card redesign with file type icons  
**Branch:** squad/54-item-card-redesign  
**Status:** ✅ COMPLETE (commit b593ced)

Redesigned item cards to improve visual hierarchy and usability:

**Key Changes:**
1. **Bootstrap Icons integration** — Installed `bootstrap-icons` package (v1.11.3)
2. **File type icon utility** — Created `src/SharedSpaces.Client/src/lib/file-icons.ts` with 15+ file type mappings:
   - Images (purple): jpg, png, gif, svg, webp, bmp
   - Videos (pink): mp4, mov, avi, mkv, webm
   - Audio (teal): mp3, wav, ogg, flac, m4a
   - PDFs (red): pdf
   - Documents (blue): doc, docx, odt, rtf
   - Spreadsheets (green): xls, xlsx, csv, ods
   - Archives (amber): zip, tar, gz, rar, 7z
   - Code (cyan): js, ts, py, java, c, cpp, cs, go, etc.
   - Web (orange): html, css, scss, sass, less
   - Text (slate): txt, md, log, json, xml, yml
   - Text items (sky): chat bubble icon
   - Default: generic file icon (slate)

3. **New 3-column card layout:**
   - **Left:** File type icon (24×24) with color
   - **Center:** Name (bold, truncated) + size · timestamp (text items show timestamp only)
   - **Right:** Primary action (copy/download) + delete button
   - All in single row using `flex items-center gap-3`

4. **Larger action icons** — Increased from 16×16 to 20×20 for better mobile tap targets

5. **Pending shares icons** — Updated to use same file type icons at 18×18 size

**Technical Patterns:**
- Icon utility returns `{ svg: TemplateResult, colorClass: string }` for Lit integration
- Size parameter (default 24) enables reuse across different contexts
- SVG paths from Bootstrap Icons embedded inline (no complex import config)
- Color-coded categories using Tailwind color classes
- Mobile-responsive with proper text truncation via `truncate` class

**Validation:**
- Lint: ✅ Pass
- Build: ✅ Pass

**Files Modified:**
- `src/SharedSpaces.Client/package.json` — Added bootstrap-icons dependency
- `src/SharedSpaces.Client/src/lib/file-icons.ts` — NEW utility file
- `src/SharedSpaces.Client/src/features/space-view/space-view.ts` — Redesigned card layout

**Design Impact:** Cards now provide visual file type recognition at a glance, improving scan-ability in mobile context. Icons use semantic colors that map to common file type conventions (blue = docs, green = spreadsheets, red = PDFs, etc.).

### PR #64 Review Feedback (2026-03-20)

Applied review feedback from Copilot reviewer and Marek:

1. **bootstrap-icons `?raw` imports:** Replaced inline SVG paths in `file-icons.ts` with Vite `?raw` imports from the `bootstrap-icons` npm package. Each SVG is imported at build time and rendered using `unsafeHTML` from `lit/directives/unsafe-html.js` with width/height string replacement. Safe because the source is a trusted npm package, not user input.
2. **Semantic `<time>` elements:** Restored `<time datetime=${item.sharedAt}>` wrappers around formatted timestamps in both `renderTextContent` and `renderFileContent`.
3. **`aria-hidden="true"`:** Added to decorative icon wrappers in `renderTextContent`, `renderFileContent`, and pending shares list.
4. **Code/HTML icon dedup:** Both code files and HTML/CSS categories now share the same `fileEarmarkCodeSvg` import — natural deduplication via the import.
5. **TypeScript `?raw` module declaration:** Added `declare module '*.svg?raw'` to `vite-env.d.ts`.

## Learnings

- **Vite `?raw` imports for SVG icons:** Use `import svg from 'package/icon.svg?raw'` to get raw SVG strings at build time. Pair with `unsafeHTML` from Lit to render them. Requires `declare module '*.svg?raw'` in `vite-env.d.ts` for TypeScript. String-replace width/height attributes before rendering to control sizing. This is the preferred pattern over inline SVG paths when icons come from an npm package.
- **`unsafeHTML` safety model:** Only safe for trusted build-time content (npm packages). Never use for user-supplied strings. This is a Lit directive, not a security bypass — it just opts out of Lit's template escaping.
- **Accessibility on decorative icons:** Always add `aria-hidden="true"` to icon containers that are purely decorative (not conveying unique information). Screen readers skip them, reducing noise.

### Issue #72: Per-space upload quota UI (2026-03-21)

**Task:** Add upload quota input to admin create-space form; show effective quota in space list.

**Changes:**
- `admin-api.ts` — Added `maxUploadSize: number | null` and `effectiveMaxUploadSize: number` to `SpaceResponse`. Added optional `maxUploadSize` param to `createSpace()`.
- `admin-view.ts` — Added `newSpaceQuotaMb` state for MB input. Create form now has a second row with quota input (`w-40`, `type="number"`) and "Default: 100 MB" hint. Space cards show effective quota with "(default)" suffix when no custom value set.

**Patterns:**
- MB-to-bytes conversion: `Math.round(parseFloat(mb) * 1024 * 1024)` on submit. Input uses `type="number"` with `step="any"` for decimal MB values.
- The form layout changed from single-row `flex` to `space-y-3` with two rows to accommodate the quota field without overflowing on mobile.
- `formatBytesAsMb()` helper added for consistent byte→MB display across the view.
- **Accessibility on decorative icons:** Always add `aria-hidden="true"` to icon containers that are purely decorative (not conveying unique information). Screen readers skip them, reducing noise.

- **Day-based time labels (Issue #74, 2026-03-20):** Refactored duplicate relative time formatting logic from `space-view.ts` and `app-shell.ts` into a shared utility `src/SharedSpaces.Client/src/lib/format-time.ts`. New format uses calendar day comparison (not 24-hour diff) for better UX:
  - Same calendar day → "Today" (replaces "just now", "Xm ago", "Xh ago")
  - Previous calendar day → "Yesterday"
  - 2-6 days ago → "Xd ago"
  - 7+ days → "Mar 19" (existing short date format)
  - Pattern: `formatRelativeTime(date: Date): string` exported function. Components parse their input (ISO string or Unix timestamp) to Date, then call the utility. Keeps try/catch error handling in component methods. Calendar day comparison normalizes both dates to start-of-day (midnight) and compares the diff in days, so an item shared at 11pm shows "Today" at 1am the next day → "Yesterday". Key files: `lib/format-time.ts`, `features/space-view/space-view.ts` (formatTime method), `app-shell.ts` (formatTimestamp method).
## 2026-03-21 — Share Target Dedup Fix #73

**Status:** Completed  
**Session:** .squad/log/2026-03-21T13-15-30Z-fix-share-target-dedup.md  

Fixed duplicate item bug in Web Share Target flow by adding pendingItemIds tracking to uploadPendingShare(). Matches existing dedup pattern from uploadFiles() and handleTextSubmit(). Tests added by Zoe (215/215 passing).

**Impact:** Issue #73 resolved, 3 regression tests covering all upload paths.

### Issue #76: Compact new item form (2026-03-21)

**Task:** Remove space name heading from space view; combine textarea and file drop zone into unified compose box with action buttons inside; show drag-and-drop overlay on textarea when files dragged.

**Changes:**
- `space-view.ts` — Removed `renderHeader()` method and its call from `render()`. Removed unused `spaceInfo` state property and `getSpaceInfo` import. Redesigned `renderUploadArea()` to create a unified compose box:
  - Single rounded container with border (replaces separate textarea + drop zone sections)
  - Textarea at top with borderless style (container provides border)
  - Action bar at bottom with file upload button (left) and Share button (right)
  - File upload button uses paperclip icon, "Files" text label hidden on mobile
  - Share button shortened to "Share" (was "Share Text")
  - Ctrl/⌘+Enter hint hidden on mobile, shown on desktop
  - Drag-and-drop overlay (`dragOver` state) covers entire compose box with backdrop blur
  - Hidden file input triggered via `triggerFileSelect()` method

**Patterns:**
- **Compact compose UX:** Modern chat-style input area with inline action buttons. Container border changes on focus (`:focus-within`), matching Tailwind focus ring patterns. Drop overlay uses `absolute inset-0 z-10` to cover content, `backdrop-blur-sm` for frosted glass effect.
- **Mobile-responsive action bar:** Icon-only file button on mobile (`hidden sm:inline` on text label), "Share" instead of "Share Text", hint hidden on mobile. Uses `flex justify-between` for left/right button groups.
- **Drag-and-drop on container:** Moved drag handlers (`@dragover`, `@dragleave`, `@drop`) from separate drop zone to outer compose container. Drop overlay conditionally rendered when `dragOver` is true.

**Layout details:**
- Container: `rounded-lg border bg-slate-900` with `:focus-within` ring
- Textarea: `border-0 bg-transparent` (no border, inherits container background)
- Action bar: `border-t border-slate-800` to separate from textarea
- Drop overlay: `border-2 border-dashed border-sky-400 bg-sky-950/80 backdrop-blur-sm`

**Impact:** Issue #76 resolved. Space view is more compact, resembles modern messaging apps. All 251 tests pass. Lint and build succeeded.

## Learnings

- **Compact compose box pattern:** Unified input area with borderless textarea + bordered container + inline action bar. The container handles all focus/hover states via `:focus-within`, so the textarea itself is borderless (`border-0 bg-transparent`). Action bar uses `border-t` to separate from input area. This pattern is common in modern chat/messaging UIs and reduces visual clutter compared to separate input/button sections.
- **Drag-and-drop overlay on input:** Move drag handlers to the outer container (not a separate zone), then conditionally render an overlay with `absolute inset-0 z-10` when `dragOver` is true. The overlay covers the entire input area (textarea + action bar) and uses `backdrop-blur-sm` for a frosted glass effect. This provides better visual feedback than changing the container border style.
- **Mobile action button optimization:** Icon-only buttons on mobile (hide text labels with `hidden sm:inline`), shorter button labels ("Share" vs "Share Text"), hide secondary hints on mobile. File upload button uses a paperclip icon from inline SVG (matches existing icon patterns in the codebase).
- **Component cleanup when removing UI:** When removing a section (like `renderHeader()`), check for unused state properties (`spaceInfo`), unused imports (`SpaceDetailsResponse`, `getSpaceInfo`), and dead code. TypeScript strict mode catches unused vars/imports, but manual review is still needed for side-effectful calls (like `getSpaceInfo()` fetch).

## 2026-03-21T14-09 — Issue #76: Compact New Item Form

**Status:** ✅ COMPLETE  
**Branch:** squad/76-compact-new-item-form  
**Commits:** 1 main feature + amended light DOM fix

**Work Summary:**
- **Compact compose box:** Removed space name heading; unified textarea + file drop zone into single bordered container with integrated action bar
- **Light DOM bug fix (amended):** Fixed `triggerFileSelect` using `this.querySelector` instead of `this.shadowRoot.querySelector` (light DOM has no shadowRoot)
- **Drag-and-drop overlay:** Conditionally renders frosted glass overlay (`backdrop-blur-sm`) when files dragged over compose box
- **Mobile-responsive action bar:** File button icon-only on mobile, "Share" label instead of "Share Text", Ctrl+Enter hint hidden on small viewports

**Validation:**
- All 251 client tests: ✅ PASS
- Linting: ✅ PASS
- Build: ✅ PASS
- Playwright screenshots: 18 recaptured & passing

**Key Pattern:** Compose box unifies input + actions via `:focus-within` on container (textarea borderless with `border-0 bg-transparent`), action bar separated by `border-t`, overlay uses `absolute inset-0 z-10`.

**Decision Logged:** Compact compose box pattern approved in `.squad/decisions.md` — proposed for style guide documentation and future reusable `<compose-box>` component extraction.

**Coordination:** Coordinator amended light DOM fix into same commit via orchestration.


## Learnings

### Drag Event Testing Patterns
- **Mock DataTransfer for type checking:** Use `Object.defineProperty(event, 'dataTransfer', { value: mockDataTransfer })` to set `types` array. Browser DataTransfer.types is read-only, so we mock the entire dataTransfer object with `types: ['Files']` for file drags or `types: ['text/plain']` for text drags.
- **Test helper pattern:** Create `createDragEvent(type, includeFiles)` helper that returns DragEvent with properly mocked dataTransfer. This centralizes the mock setup and makes tests more readable.
- **Counter balance testing:** Test that `dragCounter` stays balanced across nested enter/leave pairs, cannot go negative even with unbalanced events, and that non-file drags don't affect the counter.
- **File type gating:** Gate drag overlay on `dataTransfer.types.includes('Files')` to avoid showing overlay for text/link drags. Apply the same check in both `handleDragEnter` and `handleDragLeave` so counter stays balanced.
- **Clamp counter at zero:** Use `if (this.dragCounter > 0) { this.dragCounter--; }` pattern to prevent negative values from browser quirks or unbalanced dragenter/dragleave events.

## 2025-01-19T21-49 — PR #82 Review Feedback: Drag/Drop Fixes

**Status:** ✅ COMPLETE  
**Files Modified:**
- `src/SharedSpaces.Client/src/features/space-view/space-view.ts` (drag handlers)
- `src/SharedSpaces.Client/src/features/space-view/space-view.test.ts` (new test suite)

**Work Summary:**
- **File type gating:** Added `dataTransfer.types.includes('Files')` check to `handleDragEnter` and `handleDragLeave` so non-file drags (text/links) don't trigger the "Drop files here" overlay
- **Counter clamping:** Added `if (this.dragCounter > 0)` guard before decrementing in `handleDragLeave` to prevent negative values from unbalanced dragenter/dragleave events
- **Comprehensive test suite:** Added 10 new tests in `describe('Drag and Drop', ...)` covering:
  - Document-level listener registration/cleanup
  - File drag triggers overlay, non-file drag ignored
  - Counter cannot go negative
  - Drop handlers reset state correctly
  - Nested dragenter/dragleave pairs work correctly
  - Non-file drags don't affect counter balance

**Validation:**
- All 262 tests (including 10 new drag/drop tests): ✅ PASS
- Linting: ✅ PASS

**Key Patterns Used:**
- Mock DataTransfer with `Object.defineProperty(event, 'dataTransfer', { value: mockDataTransfer })`
- Test helper `createDragEvent(type, includeFiles)` for DRY test setup
- Access private methods/state via `(element as any).methodName`
- Use `vi.spyOn()` to mock `uploadFiles` method


## Learnings

### Issue #86: WebSocket Connection State Indicator Bug (2026-03-17)
**Problem:** Connection state dot in nav pills showed stale "connected" state when switching between spaces, making it look like reconnection was happening when returning to a previously viewed space.

**Root Cause:** 
- `app-shell.ts` `willUpdate()` only cleared connection state when leaving the 'space' view entirely (view changed from 'space' to 'home'/'join'/'admin')
- When switching from Space A → Space B → A, the `view` property stayed 'space', so old connection states persisted in `spaceConnectionStates`
- The actual WebSocket connection WAS properly disconnected (space-view unmounts → disconnectedCallback fires), but the UI state wasn't cleared

**Solution:**
- Added `currentSpaceId` change detection in `willUpdate()` to clear old space's connection state when switching between spaces
- Updated test expectations to verify stale state is cleared on space switch

**Key Files:**
- `/workspaces/SharedSpaces/src/SharedSpaces.Client/src/app-shell.ts` - Connection state tracking
- `/workspaces/SharedSpaces/src/SharedSpaces.Client/src/features/space-view/space-view.ts` - SignalR connection lifecycle

**Architecture Note:** space-view components are conditionally rendered, so mounting/unmounting triggers full lifecycle (connectedCallback/disconnectedCallback). Connection state must be tracked separately in parent (app-shell).

## 2025-06-01 — Issue #84: Auto-grow Textarea

**Status:** ✅ COMPLETE  
**Files Modified:** `src/SharedSpaces.Client/src/features/space-view/space-view.ts`

**Work Summary:**
- **Auto-grow behavior:** Textarea height automatically adjusts to fit content as user types
- **Max height:** 200px limit with scroll overflow (roughly 10 rows at text-sm)
- **Starting height:** Changed from `rows="3"` to `rows="1"` — starts compact, grows as needed
- **Manual resize disabled:** Replaced `resize-y` with `resize-none` (auto-grow provides better UX)
- **Reset on submit:** Height resets to initial size after text is shared

**Implementation:**
- `autoResizeTextarea(textarea)`: Resets height to 'auto', then sets to scrollHeight
- `resetTextareaHeight()`: Queries textarea and resets height after submit
- Called from `handleTextInput` on every keystroke and after clearing text in `handleTextSubmit`

**Validation:**
- All 287 tests: ✅ PASS
- TypeScript (space-view.ts): No new errors (pre-existing Lit decorator warnings unrelated to changes)

**Design Decision:** 200px max-height balances multi-paragraph composition with mobile viewport constraints (390×844). Starting at 1 row creates modern chat-like feel with progressive disclosure.

**Decision Doc:** `.squad/decisions/inbox/wash-textarea-autogrow.md`

## Learnings

### Auto-grow Textarea Pattern
- **Height calculation:** Reset to 'auto' first, then read scrollHeight to get natural content height. This ensures accurate measurement after content changes.
- **Reset after clear:** When clearing textarea value (after submit), manually reset height to 'auto' to return to initial compact state. Without this, the textarea stays at expanded height even when empty.
- **Max height + overflow:** Use inline `style="max-height: 200px; overflow-y: auto;"` instead of Tailwind classes for precise pixel control. Once max is reached, scrolling takes over.
- **Mobile considerations:** Choose max-height that works on smallest target viewport (390×844). 200px leaves room for header, compose box chrome, and virtual keyboard.
- **Starting compact (rows="1"):** Modern pattern for compose boxes — starts small, grows on demand. Better space efficiency than fixed multi-row textarea.

### Textarea Querying in Lit Components
- Query textarea with `this.shadowRoot?.querySelector('textarea')` for reset operations that happen outside the input handler (where we don't have the event target reference).
- In the input handler itself, use `e.target as HTMLTextAreaElement` directly for better performance (no DOM query needed).

## PR #91: Scrollbar CSS Review (2026-03-21)

**Task:** Address Copilot reviewer feedback on scrollbar styling in index.css

**Objectives:**
- Add `scrollbar-gutter: stable;` to prevent layout shift when scrollbars appear/disappear
- Fix misleading comment in scrollbar CSS rule
- Verify layout integrity
- Commit and push changes

**Status:** In Progress (spawned 2026-03-21T19:25:00Z)


## Issue #93: Admin UI - Remove Member Button (2026-03-21)

**Task:** Add "Remove" button for revoked members in admin UI to permanently delete members and their items

**Objectives:**
- Add `removeMember()` function to `admin-api.ts` following the pattern of `revokeMember()`
- Add `pendingMemberRemovals` state tracking to `SpaceCardState`
- Implement `handleRemoveMember()` with confirmation dialog and member filtering (not just flag update)
- Update member rendering to show "Remove" button for revoked members
- Button should be muted by default (slate tones), show red on hover to signal destructive action

**Implementation:**
- Added `removeMember()` to `admin-api.ts` calling `DELETE /v1/spaces/{spaceId}/members/{memberId}`
- Added `pendingMemberRemovals: Record<string, boolean>` to `SpaceCardState` and initialized in `createSpaceCardState()`
- Implemented `handleRemoveMember()` following exact pattern of `handleRevokeMember()`:
  - Confirmation dialog warns: "Permanently remove this member and all their items? This cannot be undone."
  - On success, **filters out** the member from state (not just updating a flag)
  - Proper error handling with `AdminApiError` detection and session validation
- Updated member rendering in `renderMembersModalContent()`:
  - Revoked members now show "Remove" button (was showing `null` before)
  - Button uses muted colors (slate-700/slate-800/slate-400) in default state
  - Hover shows red tones (red-700/red-950/red-300) to signal destructive action
  - Loading state shows "Removing…" with disabled state

**Status:** Complete

### Learnings

#### Admin State Management Pattern
- Use separate pending state records for different operations (`pendingMemberRevocations` vs `pendingMemberRemovals`)
- When an operation should remove an item from the list, use `.filter()` (as in Remove)
- When an operation should update an item in the list, use `.map()` (as in Revoke)
- Always check `isCurrentSession()` before updating state to prevent race conditions when admin switches servers
- Always handle unauthorized errors separately with `isUnauthorizedError()` check

#### Destructive Action UI Pattern
- Use muted colors by default for already-revoked items to de-emphasize their presence
- Show destructive colors (red tones) only on hover to signal the irreversible nature
- Confirmation dialogs should clearly state what will be deleted: "member AND their items"
- Use "cannot be undone" language to ensure user understands permanence

#### Inline Metadata Display Pattern
- Append secondary stats (e.g., item count) to existing metadata lines using a middle dot separator (`·`)
- Use singular/plural ternary for counts: `${n} ${n === 1 ? 'item' : 'items'}`
- Keeps layout stable — no extra rows or elements needed for simple numeric annotations

## Learnings — Issue #92 (Un-revoke Member)

- **Un-revoke API pattern**: Mirrors revoke exactly — `POST /v1/spaces/{spaceId}/members/{memberId}/unrevoke` with `X-Admin-Secret` header. The endpoint convention is `/{action}` suffix on the member resource.
- **Pending state pattern**: Each member action gets its own `pendingMember{Action}` record in `SpaceCardState`. The `getPendingState()` helper adds/removes keys from a `Record<string, boolean>` immutably.
- **Revoked member UI**: When `isRevoked` is true, the member row shows strikethrough name + "Revoked" badge + action buttons. Now shows both "Restore" (emerald) and "Remove" (slate/red) side by side.
- **Button mutual disabling**: When one action is pending on a revoked member, both Restore and Remove buttons are disabled to prevent conflicting operations.
- **Key files**: `admin-api.ts` (API functions), `admin-view.ts` (1160+ line Lit component with modal-based member management).
- **Pre-existing test errors**: `space-view.test.ts` has ~25 pre-existing TS errors unrelated to admin code — don't let those block you.

## Team Update (2026-03-21 — Issue #92 Un-revoke Member — Complete)

**Status:** ✅ Done
**Commit:** 8bc868d (Kaylee), 2d44723 (Wash), 8590338 (Zoe), adb78df (Coordinator)

**Kaylee's Work:**
- Implemented `POST /v1/spaces/{spaceId}/members/{memberId}/unrevoke` endpoint
- Mirrors revoke pattern: admin-only, idempotent (204 for already-active), no schema changes
- JWT restoration: existing tokens become valid immediately via per-request IsRevoked check
- All 116 tests pass

**Wash's Work:**
- Added `unrevokeMember()` API function to admin-api.ts
- Added UI "Restore" button (emerald) for revoked members in admin-view.ts
- Restore + Remove buttons appear side-by-side with mutual disabling during pending operations
- Button label "Restore" chosen for clarity; emerald color signals constructive action

**Zoe's Work:**
- Wrote 8 integration tests for un-revoke endpoint covering: happy path, auth, 404s, idempotency, JWT restoration, data preservation
- Tests expect: 204 NoContent on success and for already-active (idempotent), 401 for missing/invalid auth, 404 for missing space/member
- All tests pass; no regressions

**Coordinator Work:**
- Fixed endpoint naming mismatch: `/reinstate` → `/unrevoke` to align server with client tests and UI

**Cross-Team Learning:**
- Endpoint contract for un-revoke mirrors revoke exactly (status codes, error responses, idempotency)
- JWT restoration is automatic — no token refresh needed after un-revoke
- UI pattern extends existing member action patterns (pending state, mutual button disabling, color coding)

## Learnings — Mobile Members Modal Layout Fix

- **Mobile stacking pattern for member rows**: The admin members modal uses `flex-col sm:flex-row` on the outer row div to stack member info above action buttons on mobile (<640px) and display them side-by-side on desktop. Buttons use `self-end sm:self-auto` to right-align on mobile while keeping natural flex alignment on desktop.
- **Tailwind `sm:` breakpoint (640px)** is the right threshold for this modal — at 390px mobile viewport, the modal content area is ~340px, far below `sm:`, so stacking always kicks in. Desktop modals are well above 640px, so horizontal layout is preserved.
- **Both member types handled**: Active members (single Revoke button) and revoked members (Restore + Remove button group) both use `self-end` for mobile right-alignment.

## Learnings — Alphabetical Space Sorting (#96)

- **Sorting pattern**: Both `app-shell.ts` and `admin-view.ts` now sort spaces alphabetically (case-insensitive) using `localeCompare` with `{ sensitivity: 'base' }`. This ensures locale-aware ordering and treats upper/lowercase as equal.
- **app-shell.ts**: Sort applied when building `this.spaces` from local storage JWT entries (line ~213). Single assignment point, so all spaces are always sorted.
- **admin-view.ts**: Sort applied inside `setSpaces()` (the centralized setter). All paths — initial load, space creation — flow through this method, so sort order is always maintained. Uses `[...spaces].sort()` to avoid mutating the input array.
- **Dynamic spaces**: Both approaches automatically sort newly added spaces (e.g., SignalR joins in pill bar, admin creates in dashboard) because they go through the sorted setter paths.
- **Playwright screenshot tests** require a running backend API server for seeding; they can't run in a codespace without the server up.

## Team Update (2026-03-22 — Issue #96 Alphabetical Space Sorting — Complete)

**Status:** ✅ Done
**Branch:** squad/96-sort-spaces-alphabetically
**PR:** #98 (opened)

**Wash's Work:**
- Implemented alphabetical space sorting in pill bar (`app-shell.ts`) and admin panel (`admin-view.ts`)
- Sorting applied at data-setter level using `localeCompare(name, undefined, { sensitivity: 'base' })`
- Dynamically added spaces remain in alphabetical order
- No server-side changes needed

**Zoe's Work:**
- Wrote 23 vitest tests covering sort correctness, edge cases, and dynamic additions
- 12 tests in app-shell.spec.ts, 11 tests in admin-view.spec.ts
- All 335 tests pass (including new tests); no regressions

**Key Decision:**
- Use `localeCompare` with `sensitivity: 'base'` for locale-aware, case-insensitive sorting
- Sort at data-setter level (not template) to maintain order through dynamic updates

- **Creative UX variants for mobile pill bar — Round 2 (Issue #99):** Researched and prototyped 4 interactive mobile UX patterns as alternatives to the wrapping pill bar, going beyond CSS-only fixes from Round 1. Key findings: (1) **Dropdown selector** — cleanest scalability, familiar mobile pattern, but loses at-a-glance visibility; uses custom dropdown with `aria-haspopup="listbox"`, outside-click-to-close handler, and CSS animation. (2) **Overflow menu ("⋯ +N")** — best hybrid approach showing 2 visible pills + badge popover for the rest, like Chrome tab overflow; tight on 390px screens — needs responsive fine-tuning. (3) **Bottom sheet** — most native mobile feel (iOS share sheet pattern) with slide-up animation, dimmed backdrop, drag handle; best touch targets but complex implementation and inappropriate on desktop. (4) **Collapsible accordion** — simplest implementation (toggle div), pushes content down instead of overlaying, but takes vertical space when expanded. Implementation notes: Vite HMR reliably picks up app-shell.ts changes for rapid variant prototyping. For absolute-positioned popovers inside flex containers, avoid `overflow-hidden` on parent — it clips the popover. Outside-click-to-close pattern requires `setTimeout(() => document.addEventListener(...), 0)` to avoid the triggering click immediately closing the menu. All variants need responsive breakpoints — these patterns should only activate on mobile while desktop keeps the original pill layout.

## Learnings — Final Polish Tweaks (Issue #99, Bottom Sheet v3)

- **Swapping element order in flex rows:** To swap adjacent elements in a `flex items-center` row, simply reorder them in the template. Swapped the version badge and admin gear button in the mobile header title row so version appears first (left) and admin gear sits at the far right.
- **Fixed-width icon columns for alignment:** When a list has rows with different icon sizes (e.g., 2.5-size status dots vs 5-size `+` circle), wrap each icon in a fixed-width `inline-flex w-5 shrink-0 items-center justify-center` container. This ensures all text labels start at the same horizontal position regardless of icon size.
- **xvfb-run for headed Playwright in CI/codespace:** The Playwright config uses `headless: false` — in headless Linux environments, use `xvfb-run --auto-servernum` to provide a virtual X display. Without it, Chromium crashes with "Missing X server" immediately.
- **Share target integration pattern (bottom bar + sheet):** To add conditional pills to the mobile bottom bar, wrap the pill + chevron in a `flex items-center gap-2 shrink-0` container and use `e.stopPropagation()` on the pill click to prevent the parent bar's sheet-open handler from firing. For the bottom sheet, place action items (Join, Pending shares) above the space list with a conditional separator. The `📥` emoji icon fits inside the same `w-5` column used for dots and `+` icons. Setting `pendingShareCount` via `page.evaluate` on the `app-shell` element triggers Lit reactive re-render for screenshot capture.

## Learnings — PR #101 Review Feedback (Issue #99)

- **matchMedia breakpoint listener for scroll-lock cleanup:** When toggling `overflow-hidden` on body for mobile modals, also add a `matchMedia('(max-width: 639px)')` change listener that clears the lock when leaving mobile viewport. Guard with `?.addEventListener?.()` for happy-dom compatibility in tests.
- **Nested interactive controls fix pattern:** Don't wrap `<button>` inside a clickable `<div>`. Restructure as sibling buttons within a non-interactive container. Use separate toggle buttons for the space-name area and the chevron icon.
- **Precompute SVG string variants at module level:** Instead of calling `.replace()` on raw SVG strings in every `render()`, compute sized variants once as module-level `const` values.
- **Dialog semantics for bottom sheets:** Mobile sheet modals need `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to a title element, plus Escape-key-to-close handled at document level.
- **data-testid attributes added:** `bottom-bar`, `bottom-sheet`, `backdrop`, `sheet-space-item`, `pending-shares-bar`, `pending-shares-sheet`, `pending-shares-pill`, `desktop-pills` — for Zoe's upcoming test selector migration.
