# Project Context

- **Owner:** Marek Fišera
- **Project:** SharedSpaces — A self-hostable web platform where users join shared spaces via QR code/URL+PIN, share files and text in real-time, with anonymous identity and JWT-based access.
- **Stack:** .NET (ASP.NET Core Web API), React SPA (Vite), SignalR (WebSocket), SQLite + EF Core, JWT auth
- **Created:** 2026-03-16

## Core Context

### Server Architecture
- Pure API — no server-rendered UI
- ASP.NET Core Web API + SignalR
- Vertical slice under Features/: Spaces, Invitations, Tokens, Items, Admin
- Infrastructure/: EF Core, file storage, SignalR hub

### Domain Entities
- Space: Id (GUID), Name, CreatedAt
- SpaceInvitation: Id, SpaceId (FK), Pin (hashed, deleted after use)
- SpaceMember: Id (becomes JWT sub), SpaceId, DisplayName (immutable per space), JoinedAt, IsRevoked
- SpaceItem: Id (client-generated GUID), SpaceId, MemberId, ContentType (text/file), Content, SharedAt

### Key Design Decisions
- All IDs are GUIDs
- JWT tokens have no expiration — validity = SpaceMember.IsRevoked check on every request
- Invitation PINs hashed at rest, deleted after token issued
- SpaceItem IDs are client-generated (PUT/upsert semantics)
- Per-space storage quota enforced on upload

### API Endpoints
- POST /v1/spaces (Admin), GET /v1/spaces/{spaceId} (JWT)
- POST /v1/spaces/{spaceId}/invitations (Admin), POST /v1/spaces/{spaceId}/tokens (None)
- GET/PUT/DELETE /v1/spaces/{spaceId}/items (JWT)
- SignalR hub: /v1/hubs/space/{spaceId}

## Team Updates (2026-03-16)

**Mal completed issue decomposition:** 14 GitHub issues (#17–#30) created spanning 5 phases:
- **Phase 1 (Core Server):** #17–#21 (5 issues) — API, auth, schema
- **Phase 2 (Real-time):** #22 (1 issue) — SignalR
- **Phase 3 (React Client):** #23–#26 (4 issues) — Join flow, space view, upload (your work starts here)
- **Phase 4 (Admin UI):** #27 (1 issue) — Dashboard
- **Phase 5 (Offline & Polish):** #28–#30 (3 issues) — Offline queue, Docker

All issues labeled with `squad`, `phase:N`, and category (backend/frontend/infrastructure/real-time). Dependencies explicit in issue descriptions.

## Team Updates (2026-03-16 Continued)

**Zoe completed test project scaffold:** Parallel to Issue #17, Zoe created `tests/SharedSpaces.Server.Tests/` with:
- xUnit test framework
- Moq (4.20.70) for mocking
- FluentAssertions (6.12.0) for readable assertions
- EF Core InMemory for isolated database tests
- Smoke test passing; ready for endpoint tests after Phase 1 implementation

Test project committed to same branch as solution scaffold (`squad/17-solution-scaffold`). Zoe awaits Issue #18–#21 completion to write security-focused tests (JWT, PIN lifecycle, quota).

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
- The backend scaffold lives in `SharedSpaces.sln` with the API project at `src/SharedSpaces.Server/SharedSpaces.Server.csproj`, keeping server work isolated under `src/SharedSpaces.Server/`.
- EF Core persistence is organized under `src/SharedSpaces.Server/Infrastructure/Persistence/`, with entity configurations in `Configurations/` and generated migrations in `Migrations/`.
- SQLite stays configured through `ConnectionStrings:DefaultConnection` in `src/SharedSpaces.Server/appsettings.json`, but runtime and design-time both normalize the file path through `SqliteConnectionStringResolver` so `dotnet run` and `dotnet ef` target the same database location.
- `Program.cs` applies pending migrations on startup via `DatabaseInitializationExtensions.InitializeDatabaseAsync()`, so fresh local environments can boot without a manual database setup step.
- Test project (`tests/SharedSpaces.Server.Tests/`) uses EF Core InMemory for isolated unit/integration tests; no external dependencies or SQL Server needed for local test runs.
- `SpaceItem` IDs remain client-generated per the README; protect the domain by rejecting `Guid.Empty` instead of adding server-side ID generation.
- Design-time EF configuration should load `appsettings.{ASPNETCORE_ENVIRONMENT}.json` when available, defaulting to Development for local tooling.
- `.squad/config.json` is machine-specific local state and should stay gitignored rather than committed.
- Admin endpoints use simple header-based authentication via `AdminAuthenticationFilter` (IEndpointFilter) checking `X-Admin-Secret` header against `Admin:Secret` configuration.
- Endpoint registration uses extension methods (e.g., `MapSpaceEndpoints()`, `MapInvitationEndpoints()`) to keep `Program.cs` clean and group related endpoints in their feature folders.
- Invitation PINs are 6-digit numeric, generated with `RandomNumberGenerator` using the correct exclusive upper bound, and hashed at rest with HMACSHA256 keyed by `Admin:Secret`.
- QR codes generated via QRCoder library, returned as base64-encoded PNG in API responses, encoding the full client join URL.
- Review feedback surfaced that invitation payloads must use `serverUrl|spaceId|pin` instead of colon separators because URLs already contain `:` characters.
- Review feedback also surfaced that admin secret checks should reject multiple `X-Admin-Secret` values and compare UTF-8 bytes with `CryptographicOperations.FixedTimeEquals`.
