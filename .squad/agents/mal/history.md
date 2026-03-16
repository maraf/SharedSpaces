# Project Context

- **Owner:** Marek Fišera
- **Project:** SharedSpaces — A self-hostable web platform where users join shared spaces via QR code/URL+PIN, share files and text in real-time, with anonymous identity and JWT-based access.
- **Stack:** .NET (ASP.NET Core Web API), React SPA (Vite), SignalR (WebSocket), SQLite + EF Core, JWT auth
- **Created:** 2026-03-16

## Core Context

### Architecture
- Server is a pure API (no rendered UI) — ASP.NET Core Web API + SignalR
- Client is a separate React SPA (Vite) — independently deployable, can connect to any server
- No deployment binding between client and server
- A single client instance may connect to multiple servers simultaneously

### Domain Model
- Space, SpaceInvitation, SpaceMember, SpaceItem — all IDs are GUIDs
- JWT tokens have no expiration — validity = SpaceMember existence + IsRevoked check
- Invitation PINs are hashed at rest, deleted after token is issued
- SpaceItem IDs are client-generated (PUT/upsert semantics)

### Implementation Phases
- Phase 1: Core Server (solution scaffold, domain entities, admin endpoints, join/auth, items CRUD)
- Phase 2: Real-time (SignalR hub per space)
- Phase 3: React Client (Vite scaffold, join flow, JWT storage, multi-server, SignalR client)
- Phase 4: Admin UI
- Phase 5: Offline & Polish (Service Worker, IndexedDB, Docker Compose)

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### Issue Decomposition Strategy (2026-03-16)

Created 14 GitHub issues (maraf/SharedSpaces#17-#30) breaking down the 5-phase implementation plan:

**Phase 1 (Core Server) — 5 issues:**
- #17: Solution scaffold + EF Core with SQLite — foundation work
- #18: Domain entities (Space, SpaceInvitation, SpaceMember, SpaceItem) + migrations
- #19: Admin endpoints (create space, generate invitations with optional QR)
- #20: Join/auth flow (PIN validation → JWT issuance → invitation deletion)
- #21: Items CRUD with quota enforcement and file storage abstraction

**Phase 2 (Real-time) — 1 issue:**
- #22: SignalR hub for broadcasting item events to space groups

**Phase 3 (React Client) — 4 issues:**
- #23: Vite + React scaffold with routing and project structure
- #24: Join flow with invitation parsing, display name input, JWT storage
- #25: Space view with item list and file/text upload UI
- #26: SignalR client integration for live updates

**Phase 4 (Admin UI) — 1 issue:**
- #27: Admin panel for space creation and invitation generation

**Phase 5 (Offline & Polish) — 3 issues:**
- #28: Service Worker + IndexedDB for offline support
- #29: Docker Compose for self-hosting
- #30: QR code generation for invitations

**Decomposition principles applied:**
- Each issue is a coherent unit of work for a single developer
- Issues include detailed acceptance criteria so devs don't need to constantly reference README
- Dependencies are explicit (e.g., "#21 requires #20")
- Granularity: not too fine (avoided 1 issue per endpoint), not too coarse (avoided 1 issue per phase)
- Labels: all have 'squad', plus phase labels (phase:1-5) and category labels (backend, frontend, infrastructure, real-time)
- Target: 10-15 issues total (achieved 14)

**Key architectural notes embedded in issues:**
- Client-generated GUIDs for SpaceItem IDs (PUT/upsert semantics)
- JWT claims include server_url for multi-server support
- Admin auth via simple header secret (not JWT)
- File storage abstraction for future cloud provider swap
- Invitation PINs are deleted after JWT issuance (no replay)
- JWT has NO expiration; validity = SpaceMember.IsRevoked check
