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
- SignalR hub: /v1/spaces/{spaceId}/hub

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
- A baseline GitHub Actions CI workflow should validate `SharedSpaces.sln` on `ubuntu-latest` with .NET 9 using `dotnet restore`, `dotnet build --no-restore`, and `dotnet test --no-build` for PRs/pushes to `main`.
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
- JWT join/auth flow lives under `src/SharedSpaces.Server/Features/Tokens/`, with `TokenEndpoints.cs` handling `POST /v1/spaces/{spaceId}/tokens` and `JwtAuthenticationExtensions.cs` wiring bearer auth plus per-request `SpaceMember` revocation checks.
- Invitation PIN hashing is now centralized in `src/SharedSpaces.Server/Features/Invitations/InvitationPinHasher.cs`, and token exchange must reuse that same HMACSHA256 + `Admin:Secret` scheme as invitation creation.
- Backend configuration now expects `Jwt:SigningKey` in `src/SharedSpaces.Server/appsettings.json`; `Program.cs` registers `AddJwtAuthentication()`, then `UseAuthentication()`, custom space-member validation, and `UseAuthorization()` before mapping endpoints.
- `AddJwtAuthentication()` resolves the JWT signing key from configuration during startup while configuring `JwtBearerOptions`; test environments that need a different key must override configuration before the app is built.
- Admin endpoint tests moved to a test-only `/admin/tokens` endpoint to avoid interference with production TokenEndpoints tests; Coordinator fixed this in commit ee9c2ef.
- Phase 1 (Core Server) JWT auth milestone complete. Kaylee delivered token endpoint + middleware (commit 24774a5), Zoe delivered 13 integration tests (commit 2616bce), Coordinator fixed test config resolution (commit ee9c2ef).
- GitHub Actions CI workflow now in place. Kaylee delivered `.github/workflows/ci.yml` (commit 526e691) for automated server validation on PRs/pushes to `main`. All 13 tests pass in CI environment.
- `SpaceMemberAuthorizationMiddleware` should challenge the bearer scheme for revoked or missing members so every auth failure path returns a standard 401 with the expected `WWW-Authenticate` header.
- Item CRUD for authenticated members lives in `src/SharedSpaces.Server/Features/Items/`, with `ItemEndpoints.cs` handling space info lookup plus GET/PUT/DELETE item routes under `/v1/spaces/{spaceId}`.
- File uploads now go through `src/SharedSpaces.Server/Infrastructure/FileStorage/` (`IFileStorage` + `LocalFileStorage`), which stores relative paths under `Storage:BasePath` and cleans up files/directories when items are replaced or deleted.
- Per-space quota enforcement now persists `SpaceItem.FileSize`, reads `Storage:MaxSpaceQuotaBytes` from `src/SharedSpaces.Server/appsettings.json`, and returns 413 when a file upload would push a space over quota.
- SignalR hub for real-time space updates lives under `src/SharedSpaces.Server/Features/Hubs/` with `SpaceHub` at `/v1/spaces/{spaceId}/hub` (route consistency), using JWT authentication and Groups for per-space broadcasting.
- SignalR JWT authentication is configured via `JwtBearerEvents.OnMessageReceived` to extract tokens from the `access_token` query string parameter for WebSocket connections on `/v1/spaces/.../hub` routes.
- Item endpoint broadcasts now flow through `ISpaceHubNotifier`, which centralizes hub group targeting and keeps SignalR notifications best-effort.
- CORS is configured in `Program.cs` to allow SignalR connections from the client app origin (`Server:DefaultClientAppUrl`), with credentials, any header, and any method.
- SignalR hub methods validate that the JWT's `space_id` claim matches the requested `spaceId` before adding the connection to the space group, preventing cross-space subscriptions.
- SignalR connections now auto-join their per-space group during `SpaceHub.OnConnectedAsync`, and HTTP item endpoints publish through `ISpaceHubNotifier` so broadcast failures stay best-effort and only log warnings.

## Team Updates (2026-03-17 Continued)

**Kaylee completed Issue #22 (SignalR Hub):** Implemented real-time space updates via SignalR:
- `SpaceHub` initially routed at `/v1/hubs/space/{spaceId}` with JWT bearer auth via query param token extraction
- `JoinSpace(Guid spaceId)` method validates space_id claim before adding connection to group
- Event broadcasting integration: `IHubContext<SpaceHub>` injected into `ItemEndpoints`
- `ItemAdded` event broadcast on item creation, `ItemDeleted` on item deletion
- CORS configured to allow WebSocket connections from `Server:DefaultClientAppUrl`
- Branch: `squad/22-signalr-hub`, commit: 8ec9b4f
- Ready for merge after Zoe's test pass (all 46 tests passing post-fix)

**Kaylee applied route consistency update (2026-03-17):** Per user directive, swapped SignalR hub route:
- Changed from `/v1/hubs/space/{spaceId}` to `/v1/spaces/{spaceId}/hub`
- Updated `HubEndpoints.cs` with new route mapping
- Updated `JwtAuthenticationExtensions.cs` to recognize hub requests under `/v1/spaces/...`
- Updated `SpaceHubTests.cs` and README.md to reflect new route
- All 46 tests passing, commit: a935139
- Decision documented in `.squad/decisions.md`
