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
- **Test Storage Path:** `./artifacts/storage-tests` (per user directive, 2026-03-17T14:54Z)

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
- SpaceHub now auto-joins the route's space group during `OnConnectedAsync`, validating the route `spaceId` against the JWT `space_id` claim and closing the connection when they do not match.
- SignalR event broadcast payloads include both `SpaceId` and `FileSize` fields in addition to item metadata (Id, ContentType, Content, SharedAt, MemberId, DisplayName); tests should verify full event structure matches the `ItemAddedEvent` and `ItemDeletedEvent` records in production code.
- SignalR hub tests can safely run on the same `TestWebApplicationFactory` infrastructure as REST endpoint tests, using EF Core InMemory database and the same configuration overrides for `Admin:Secret`, `Jwt:SigningKey`, and `Server:Url`.
- Test storage is now isolated at `./artifacts/storage-tests` per user directive (2026-03-17); ensure test hosts override `Storage:BasePath` to prevent cross-contamination with app storage at `./artifacts/storage`.
- `SpaceHub` now auto-joins the route's space group during `OnConnectedAsync`; hub integration tests should connect to `/v1/spaces/{spaceId}/hub`, register handlers before `StartAsync()`, use `TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously)` + `TrySetResult`, and assert PUT/DELETE success before awaiting broadcast events.
- Client-side tests use vitest 4.x with happy-dom environment for browser API simulation; tests are co-located with source files using `*.test.ts` naming convention in `src/SharedSpaces.Client/src/lib/`.
- Client localStorage mocking requires explicit setup via `vitest.setup.ts` because happy-dom's default localStorage implementation lacks full API surface; custom mock provides `getItem`, `setItem`, `removeItem`, and `clear` methods.
- Invitation parsing validates server URL protocol (http/https only) BEFORE trimming whitespace, so spaces in URL parts will cause validation to fail; tests should use clean strings without leading/trailing spaces for valid cases.
- Token storage uses composite keys in format `serverUrl:spaceId` to support multi-server client scenarios; tests should verify token isolation across different server+space combinations.
- API client tests mock global `fetch` with vitest's `vi.fn()` and should verify both success responses and typed error handling for HTTP status codes (400/401/404) plus network failures.
- Client test scripts in package.json: `npm test` runs vitest once, `npm run test:watch` runs vitest in watch mode for TDD workflow.

## Team Updates (2026-03-17)

**Zoe completed Issue #22 (SignalR Hub Tests):** Wrote 15 comprehensive integration tests for real-time hub:
- Test coverage: connection auth (5 tests), JoinSpace validation (2), event broadcasting (5), edge cases (3)
- Used `Microsoft.AspNetCore.SignalR.Client` 10.0.0 with `WebApplicationFactory` pattern
- Tests written TDD-style before implementation, validating requirements not just implementation
- Event assertions use `TaskCompletionSource<T>` + `Task.WhenAny` timeout pattern for safety
- Branch: `squad/22-signalr-tests`, initial commit: b32bb24

## Team Updates (2026-03-17 Continued)

**Zoe fix pass:** Diagnosed and fixed 6 test failures on merged branches:
- Root cause: form data contract mismatches between tests and endpoint implementations
- Fixed missing `id` form field in item creation payloads
- Corrected `contentType` values (text/file vs image/png mismatches)
- Fixed non-existent space test expectations
- Result: All 46 tests passing (15 SignalR + 31 existing endpoint tests)
- Commit: fc4a0c3

**Zoe applied PR #37 test feedback (2026-03-17T15:22Z):** Updated async patterns and assertion ordering per Copilot reviewer:
- Updated `TaskCompletionSource` with `TaskCreationOptions.RunContinuationsAsynchronously`
- Reordered assertions to verify HTTP success before awaiting hub events
- Removed explicit `JoinSpace` calls (now automatic in `SpaceHub.OnConnectedAsync`)
- Verified test storage paths isolated at `./artifacts/storage-tests`
- Branch: `squad/pr-feedback`, commit: 0a93ad9
- All 46 tests passing; ready for merge after backend changes (Kaylee complete)

## Team Updates (2026-03-17 Evening)

**Zoe completed Issue #24 client tests:** Set up vitest infrastructure and wrote comprehensive tests for Wash's join flow utilities:
- Installed vitest + happy-dom for client-side testing with localStorage mock
- Added vitest.config.ts and vitest.setup.ts for test environment configuration
- Wrote 17 token-storage tests covering store, retrieve, remove, multi-server scenarios, and corrupted data handling
- Wrote 17 invitation parsing tests covering valid formats, validation failures, and edge cases
- Wrote 14 API client tests covering success, HTTP error codes (400/401/404/500), network failures, and malformed responses
- All 48 tests passing on branch `squad/24-join-flow`
- Branch: `squad/24-join-flow`, commit: a88dba1

## Team Updates (2026-03-18)

**Wash + Zoe completed Issue #24 (Join Flow):** Collaborative delivery with infrastructure + implementation:
- **Wash delivered:** Invitation parsing (pipe-delimited `serverUrl|spaceId|pin`), multi-server JWT storage (`serverUrl:spaceId` composite keys), token exchange API client, join form UI with toggle between paste/manual entry, auth context wiring
- **Zoe delivered:** vitest 4.x + happy-dom test environment, custom localStorage mock, 48 passing tests across token-storage/invitation/api-client utilities
- **Key architectural decisions:** Recorded in `.squad/decisions.md` with rationale, alternatives, and consequences
- **Quality gates:** PR #40 opened, build clean, lint pass, zero type errors, all tests passing
- **Infrastructure impact:** Client test infrastructure now established for future feature work (space view, file upload, components)
- **Cross-team learning:** Wash's patterns documented in Zoe's history; Zoe's test infrastructure patterns documented in Wash's history
- See orchestration logs for detailed session summary and technical outcomes

**Scribe captured session state:** 
- Created orchestration logs (Wash + Zoe) with outcome summaries
- Created session log with collaborative summary
- Merged decision inbox files into `.squad/decisions.md`, deduplicated
- Updated both agent histories with cross-team learnings
- Ready for git commit and merge workflow
