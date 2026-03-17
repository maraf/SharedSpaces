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
- `AddJwtAuthentication` resolves the JWT signing key during service registration, so WebApplicationFactory-based tests must provide `Jwt:SigningKey` through host configuration before the app finishes building.
- TokenEndpointTests currently contains 13 passing integration tests covering PIN exchange, JWT issuance, invitation deletion, member creation, auth success/failure, revoked members, display-name validation, and no-expiration JWT behavior.
- Successful token exchange tests should decode the JWT payload and assert the concrete `sub`, `display_name`, `server_url`, and `space_id` claim values, while also asserting the token has no `exp` claim.
- TokenEndpointTests seeds invitation PINs with the production `InvitationPinHasher` via `InternalsVisibleTo`, keeping security-sensitive hashing logic single-sourced between app code and tests.
- Item endpoint integration tests should seed `SpaceMember` rows directly and generate JWTs in-test with `sub`, `display_name`, `server_url`, and `space_id` claims so protected CRUD scenarios exercise the real auth pipeline without going through PIN exchange.
- Item CRUD auth regression coverage should tolerate either 401 or 403 for `space_id` route mismatches, since the contract is rejection of cross-space access while the exact status may depend on whether auth or endpoint validation rejects first.
- Quota enforcement tests are strongest when they use a tiny configured `Storage:MaxSpaceQuotaBytes` plus an existing file item, proving the server rejects uploads based on aggregate per-space usage rather than only single-file size.
- SignalR hub integration tests use `Microsoft.AspNetCore.SignalR.Client` 10.0.0 with `WebApplicationFactory` test server wiring; hub connections pass JWT tokens via `AccessTokenProvider` in the `HubConnectionBuilder.WithUrl` options.
- SignalR client event assertions should register handlers with `connection.On<TEvent>(eventName, handler)` before calling `StartAsync()`, and use `TaskCompletionSource<TEvent>` with `Task.WhenAny` timeout patterns to verify broadcasts arrive within expected time windows.
- SpaceHub implementation expects `JoinSpace(Guid spaceId)` method signature (not parameterless) and validates that the spaceId parameter matches the `space_id` claim in the JWT, rejecting mismatches with a hub exception.
- SignalR event broadcast payloads include both `SpaceId` and `FileSize` fields in addition to item metadata (Id, ContentType, Content, SharedAt, MemberId, DisplayName); tests should verify full event structure matches the `ItemAddedEvent` and `ItemDeletedEvent` records in production code.
- SignalR hub tests can safely run on the same `TestWebApplicationFactory` infrastructure as REST endpoint tests, using EF Core InMemory database and the same configuration overrides for `Admin:Secret`, `Jwt:SigningKey`, and `Server:Url`.

## Team Updates (2026-03-17)

**Zoe completed Issue #22 (SignalR Hub Tests):** Wrote 15 comprehensive integration tests for real-time hub:
- Test coverage: connection auth (5 tests), JoinSpace validation (2), event broadcasting (5), edge cases (3)
- Used `Microsoft.AspNetCore.SignalR.Client` 10.0.0 with `WebApplicationFactory` pattern
- Tests written TDD-style before implementation, validating requirements not just implementation
- Event assertions use `TaskCompletionSource<T>` + `Task.WhenAny` timeout pattern for safety
- Branch: `squad/22-signalr-tests`, initial commit: b32bb24

**Zoe fix pass:** Diagnosed and fixed 6 test failures on merged branches:
- Root cause: form data contract mismatches between tests and endpoint implementations
- Fixed missing `id` form field in item creation payloads
- Corrected `contentType` values (text/file vs image/png mismatches)
- Fixed non-existent space test expectations
- Result: All 46 tests passing (15 SignalR + 31 existing endpoint tests)
- Commit: fc4a0c3
