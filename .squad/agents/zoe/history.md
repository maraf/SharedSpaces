# Project Context

- **Owner:** Marek Fišera
- **Project:** SharedSpaces — A self-hostable web platform where users join shared spaces via QR code/URL+PIN, share files and text in real-time, with anonymous identity and JWT-based access.
- **Stack:** .NET (ASP.NET Core Web API), React SPA (Vite), SignalR (WebSocket), SQLite + EF Core, JWT auth
- **Created:** 2026-03-16

## Core Context

### Test Architecture
- Server tests: tests/SharedSpaces.Server.Tests/ (xUnit)
- Client tests: tests/SharedSpaces.Client.Tests/
- Integration tests preferred over unit tests with mocks

### Security-Critical Test Areas
- JWT validation: revoked members rejected, malformed tokens rejected, missing claims handled
- PIN lifecycle: hashed at rest, deleted after token issued, no replay possible
- Per-space storage quota enforcement
- Admin endpoint protection (admin secret)
- SpaceItem GUID validation (client-generated, must belong to correct space)

### API Endpoints to Cover
- POST /v1/spaces (Admin) — space creation
- POST /v1/spaces/{spaceId}/invitations (Admin) — PIN generation
- POST /v1/spaces/{spaceId}/tokens (None) — PIN exchange for JWT
- GET /v1/spaces/{spaceId}/items (JWT) — list items
- PUT /v1/spaces/{spaceId}/items/{itemId} (JWT) — upsert item
- DELETE /v1/spaces/{spaceId}/items/{itemId} (JWT) — delete item

## Team Updates (2026-03-16)

**Mal completed issue decomposition:** 14 GitHub issues (#17–#30) created spanning 5 phases:
- **Phase 1 (Core Server):** #17–#21 (5 issues) — API, auth, schema
- **Phase 2 (Real-time):** #22 (1 issue) — SignalR
- **Phase 3 (React Client):** #23–#26 (4 issues) — Join flow, space view, upload
- **Phase 4 (Admin UI):** #27 (1 issue) — Dashboard
- **Phase 5 (Offline & Polish):** #28–#30 (3 issues) — Offline queue, Docker

All issues labeled with `squad`, `phase:N`, and category (backend/frontend/infrastructure/real-time). Dependencies explicit. Test work will follow Phase 1 completion with focus on JWT, PIN, quota, and admin endpoint security.

## Team Updates (2026-03-16 Continued)

**Kaylee completed Issue #17:** Parallel to test scaffold, Kaylee delivered the solution foundation:
- Created `SharedSpaces.sln` with `src/SharedSpaces.Server/` project structure
- Defined domain entities: Space, SpaceInvitation, SpaceMember, SpaceItem (GUID-based)
- Configured EF Core with SQLite and fluent entity mappings in `Infrastructure/Persistence/Configurations/`
- Generated initial migration and verified startup database initialization
- Branch: `squad/17-solution-scaffold`, PR: #31

Server structure now available to Zoe; test project can reference production entities directly (no stubs needed). Zoe ready to write endpoint tests once Kaylee completes Phase 1 (#18–#21).

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
- Test project (`tests/SharedSpaces.Server.Tests/`) uses EF Core InMemory for isolated unit/integration tests; xUnit + Moq + FluentAssertions provide robust, readable test infrastructure.
- Server domain entities (Space, SpaceInvitation, SpaceMember, SpaceItem) are GUID-based; all configured with fluent API in `Infrastructure/Persistence/Configurations/` for DRY entity mapping.
- SQLite and EF Core migrations initialize automatically on startup via `DatabaseInitializationExtensions.InitializeDatabaseAsync()` in `Program.cs`; test database seeding can leverage the same DbContext configuration.
- `tests/SharedSpaces.Server.Tests/TokenEndpointTests.cs` is the JWT join/auth integration suite; it uses `WebApplicationFactory<Program>` with EF Core InMemory and test config overrides for `Admin:Secret`, `Jwt:SigningKey`, and `Server:Url`.
- Server startup now supports non-relational test hosts by falling back to `EnsureCreatedAsync()` when the configured `AppDbContext` provider is not relational, which keeps WebApplicationFactory-based integration tests bootable.
- `src/SharedSpaces.Server/Program.cs` exposes a `public partial class Program` marker so external integration tests can boot the minimal API host without `InternalsVisibleTo` wiring.
- JWT signing key is lazily resolved from config at first use, allowing test environments to override the key via WebApplicationFactory config. This prevents the signing key from being captured during server startup before test config is applied.
- TokenEndpointTests now contains 13 passing integration tests covering PIN exchange, JWT issuance, revoked member rejection, quota enforcement, and QR code payload integrity. Test host properly wired with config overrides.
