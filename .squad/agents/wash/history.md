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
- Re-checking the Lit option in 2026 changed the risk profile: routing is still the weakest area (deprecated Vaadin Router, `@lit-labs/router` still Labs), but Tailwind, testing, and SignalR are no longer show-stoppers. Lit can render in light DOM for Tailwind, use Vitest + Playwright credibly, and consume the framework-agnostic SignalR JS client without special adapters.
- **Friction research convergence (2026-03-17):** Both Mal and Wash independently verified ecosystem state and converged on React recommendation for SharedSpaces main SPA. Routing immaturity (Vaadin deprecated, Labs router experimental) is the core blocker. Tailwind friction is workable. Testing gap has narrowed. Team alignment achieved with explicit understanding of trade-offs; Lit remains viable for future isolated components.
- **Issue #23 bootstrap (2026-03-18):** The standalone client now lives in `src/SharedSpaces.Client/` as a Vite + Lit SPA with vertical slices under `src/features/{join,space-view,admin}` plus shared UI in `src/components/` and utilities in `src/lib/`. All rendered components extend `src/lib/base-element.ts` to force light DOM for Tailwind, `src/app-shell.ts` owns the `'join' | 'space'` view switcher, and runtime API configuration comes from the `api-base-url` meta tag via `src/lib/app-context.ts`.
