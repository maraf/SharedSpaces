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

### Phase 1 Completion: Kaylee & Zoe (2026-03-17)

**Status:** ✅ All Phase 1 core server APIs are now implemented and tested.

**Completed Issues:**
- #17: Solution scaffold + EF Core + SQLite ✅
- #18: Domain entities + migrations ✅
- #19: Admin endpoints ✅
- #20: Join/auth flow ✅
- #21: Items CRUD + file storage abstraction ✅

**Key Implementation Patterns for Future Phases:**

1. **Vertical Slice Architecture**
   - Each feature lives in `src/SharedSpaces.Server/Features/{Feature}/` with its own endpoints, models, and logic
   - Endpoints are thin wrappers calling into domain/application logic
   - Dependency injection in `Program.cs` keeps wiring centralized

2. **File Storage Abstraction**
   - `IFileStorage` interface in `Infrastructure/FileStorage/` enables testability and cloud migration
   - `LocalFileStorage` stores files relative to `Storage:BasePath` from config
   - Implementations are pluggable; future cloud storage (S3, Azure) is a one-endpoint swap

3. **Multipart File Upload Pattern**
   - Manual form parsing within the endpoint handler (not automatic model binding)
   - JWT authorization runs before form parsing — auth failures return 401 before payload is consumed
   - File size validation and quota checks happen server-side (never trust client)

4. **Quota Tracking**
   - Metadata-based: `SpaceItem.FileSize` is persisted to database
   - No filesystem scans at request time — O(1) quota enforcement via sum of item sizes
   - Allows accurate quota in distributed systems (future)

5. **Database & Testing**
   - SQLite is production database with proper migrations
   - EF Core `InMemory` provider is used in tests via `WebApplicationFactory`
   - `AppDbContext` is provided-aware; startup initialization detects SQLite vs InMemory and applies migrations/EnsureCreated accordingly
   - Solution targets .NET 10 with explicit `Microsoft.IdentityModel.JsonWebTokens` package (required for JWT validation in .NET 10)

6. **Authentication**
   - JWT tokens have no expiration claim
   - Validity is determined by `SpaceMember` existence + `IsRevoked` flag check
   - All protected endpoints use `.RequireAuthorization()` in route groups

**Ready for Phase 2:** SignalR hub can assume item CRUD is stable and tested. Hub should broadcast `item-created` and `item-deleted` events using the same `SpaceItem` model for serialization consistency.

**Ready for Phase 3:** React client can assume all server APIs are available and stable. Use same JWT structure and models from API responses for type safety.

