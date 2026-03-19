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
