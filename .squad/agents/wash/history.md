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

**Status:** ✅ Completed frontend perspective evaluation, recommending React over Lit.

**Wash's Recommendation:** ⚠️ **RECOMMEND REACT** (not Lit)

Marek asked for team feedback on switching from React to Lit HTML + WebComponents for Phase 3 client. Wash evaluated the proposal from a **hands-on frontend developer perspective** and recommended sticking with React.

**Key Concerns:**
1. **Routing is broken/experimental** — Vaadin deprecated, @lit-labs/router experimental, URLPattern is roll-your-own. React Router mature and battle-tested.
2. **Shadow DOM + Tailwind friction (dealbreaker)** — Utility classes don't penetrate Shadow DOM. Requires constant workarounds vs React's effortless integration. Issue #23 explicitly calls for Tailwind.
3. **Testing ecosystem gap** — React Testing Library trivial to set up; Lit's testing in 2025 is "usable but fragmented." Would waste time configuring tooling instead of writing tests.
4. **Developer velocity** — 30% of time lost to tooling friction and pattern research instead of shipping features. 10x more Stack Overflow answers for React + SignalR.
5. **State management** — Lit's reactive properties work fine, but React hooks make complex state (JWT manager, SignalR hub registry, offline queue) **straightforward**.

**Acknowledged Lit's strengths:** Elegant, lightweight, standards-based, good for design systems and microfrontends. But **not the right tool for this SPA.**

**Honest assessment:** "Lit is a great technology. It's just the wrong tool for this job. React lets me focus on building the app, not fighting the framework."

**Mal's Counter-Recommendation:** ✅ **APPROVE THE SWITCH** (see Mal's history for rationale)

**Decision Status:** Pending. Both evaluations recorded in `.squad/decisions.md` under "Lit HTML + WebComponents vs React — Team Evaluation" with status "Pending — awaiting user decision." Marek must choose based on project priorities:
- **Lit (Mal's case):** Bundle size, standards, architecture
- **React (Wash's case):** Routing maturity, Tailwind integration, testing ecosystem, developer velocity

You'll likely start Phase 3 after Marek decides. If React approved, issue #23 proceeds as-is. If Lit approved, #23 needs rewrite (Lit + vaadin-router + @web/test-runner).

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
