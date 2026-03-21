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

**Summary:** Fixed connection dot not updating when navigating away from space-view. App-shell now uses willUpdate() to proactively reset connection state when view changes from 'space' to other routes. Zoe added comprehensive 14-test suite validating three-layer connection cleanup lifecycle (SignalR client → space-view → app-shell). Coordinator fixed eslint config to permit ny in test files per pre-existing convention.

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

- **Build-once-deploy-anywhere refactor (2025-07-17, PR #61):** Reworked `client-publish.yml` and `client-deploy.yml` to follow "build once, deploy anywhere." Publish now builds with `--base ./` (relative asset paths), zips, and uploads to GH Release. Deploy downloads the prebuilt zip via `gh release download` instead of rebuilding from source — no Node.js, no npm, no CNAME detection. Relative base paths (`./`) work at any deployment path (custom domain root or `/repo-name/` subpath), eliminating the CNAME-sniffing logic entirely. Key files: `.github/workflows/client-publish.yml`, `.github/workflows/client-deploy.yml`. Decision doc: `.squad/decisions/inbox/wash-deploy-prebuilt.md`.
