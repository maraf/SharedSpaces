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
- Invitation parsing trims whitespace from each part BEFORE validation, so leading/trailing spaces in URL, space ID, or PIN parts are handled gracefully; tests may include whitespace-padded inputs for edge case coverage.
- Token storage uses composite keys in format `serverUrl:spaceId` to support multi-server client scenarios; tests should verify token isolation across different server+space combinations.
- API client tests mock global `fetch` with vitest's `vi.fn()` and should verify both success responses and typed error handling for HTTP status codes (400/401/404) plus network failures.
- Client test scripts in package.json: `npm test` runs vitest once, `npm run test:watch` runs vitest in watch mode for TDD workflow.
- Admin endpoint tests (`AdminEndpointTests.cs`) verify POST /v1/spaces and POST /v1/spaces/{spaceId}/invitations with comprehensive auth failure, validation edge cases, and happy path coverage; all admin endpoints use `AdminAuthenticationFilter` with X-Admin-Secret header validation.
- Admin invitation generation creates 6-digit PINs, hashes them for storage, and returns both invitation string (server_url|space_id|pin format) and base64 PNG QR code; tests verify QR code PNG signature (0x89504E47) and PIN uniqueness across multiple invitations.
- TestWebApplicationFactory requires `Microsoft.EntityFrameworkCore.Infrastructure` using statement to access `IDbContextOptionsConfiguration<>` for proper DbContext service removal during test setup.
- `GET /v1/spaces` is an admin-protected endpoint that returns all spaces as the shared `SpaceResponse` shape ordered by `CreatedAt` descending; integration tests should cover empty-state, auth failure, and newest-first listing.
- Admin member-management coverage is strongest when tests create `SpaceMember` rows through the real invitation + token exchange flow (create space → create invitation → POST `/v1/spaces/{id}/tokens`) instead of seeding members directly, so member listing/revocation scenarios exercise the join pipeline end to end.
- Admin invitation-management list responses are metadata-only (`InvitationListResponse` = `Id` + `SpaceId`) and must never expose hashed PINs; tests should deserialize the array shape and also inspect raw JSON to confirm no `pin` property leaks.
- SignalR client tests must mock `HubConnectionBuilder` as a class constructor, not a function returning an object; vitest requires `class MockHubConnectionBuilder` with methods that delegate to shared mock builder to properly intercept `new HubConnectionBuilder()` calls.
- SignalR client event handlers are registered in constructor (not start/stop), so events can theoretically fire after `stop()` if the connection receives messages; tests should verify handlers remain active after stop to document this behavior.
- SignalR client `accessTokenFactory` is an async function (not a plain string), enabling dynamic token refresh; tests should verify the factory function is passed through to `withUrl` options and returns the expected JWT.
- SignalR client stop() is defensive and checks `HubConnectionState` before calling `connection.stop()`, preventing errors on already-disconnected connections; tests should verify idempotent stop behavior and no-op on pre-disconnected state.
- SignalR client state tracking uses a getter that maps `HubConnectionState` enum values to simplified `ConnectionState` union type ('connected' | 'disconnected' | 'reconnecting'); tests should verify state transitions via connection lifecycle callbacks (onreconnecting, onreconnected, onclose).

## Team Updates (2026-03-19)

**Wash + Zoe completed race condition fix (squad/26-signalr-client):** 
- **Issue:** Uploader saw duplicate items due to SignalR `ItemAdded` events arriving before PUT responses
- **Wash's fix:** Added `pendingItemIds: Set<string>` tracking in space-view.ts to block SignalR during upload window (commit 3502e56)
- **Zoe's tests:** Wrote 7 integration + unit tests covering race condition, concurrent uploads, failed cleanup, cross-member events (commit be441b9)
- **Verification:** Lint ✅, Build ✅, All 91 client tests pass ✅
- **Decision recorded:** `.squad/decisions.md` — full implementation details, rationale, alternatives considered
- **Related:** Orchestration logs at `.squad/orchestration-log/2026-03-19T20-30-wash.md` and `-zoe.md`

This fix is a critical bug squash preventing data corruption for users. The `pendingItemIds` Set pattern is now established as the dedup strategy for async upload scenarios. Wash demonstrated hybrid integration + unit testing strategy to validate async race conditions reliably without flakiness.

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
## Team Updates (2026-03-17 Continued)

**Zoe completed admin endpoint tests (Issue #27 support):** Wrote 18 comprehensive integration tests for admin API endpoints:
- Test file: `tests/SharedSpaces.Server.Tests/AdminEndpointTests.cs`
- Space creation coverage: happy path (201), missing/wrong admin secret (401), empty name (400), very long name edge case (400), max length (201), name trimming
- Invitation generation coverage: happy path (200 with QR code), custom clientAppUrl, missing/wrong admin secret (401), non-existent space (404), QR code validation (PNG signature), invitation string format validation, hashed PIN storage, unique PINs for multiple invitations
- All 64 tests passing (46 existing + 18 new admin tests)
- Follows existing test patterns: `TestWebApplicationFactory` with EF Core InMemory, same config overrides, consistent naming conventions
- Admin endpoints use `AdminAuthenticationFilter` with X-Admin-Secret header and constant-time comparison for security
- Result: Admin panel frontend (Wash's work on #27) now has full backend test coverage to build against

**Wash completed admin panel UI (#27):** Built full admin panel at `src/SharedSpaces.Client/src/features/admin/` with:
- **admin-api.ts:** Typed API client with admin endpoints (space creation, invitation generation, QR code requests)
- **admin-view.ts:** Full UI component with state management, localStorage persistence for admin secret and space cache
- **Per-space invitation state:** Record<spaceId, InvitationState> for independent UI state per space
- **QR code rendering:** base64 PNG data URLs rendered directly as img src, no external libraries
- **Copy-to-clipboard:** navigator.clipboard API for invitation string copying
- **Styling:** Consistent dark theme (slate-950/900/800 backgrounds, sky-400 primary actions, emerald-400 success states)
- **TypeScript compliance:** Explicit class properties for erasableSyntaxOnly compatibility
- **Security:** Admin secret validation via test space creation (no dedicated auth endpoint)
- Branch: `squad/27-admin-panel-ui`, ready for code review. Your test suite provides full confidence for frontend integration.

## Team Updates (2026-03-18)

**Coordinated PR #41 feedback resolution (2026-03-18T17:27:29Z):**

Marek's code review on PR #41 spawned a 4-agent squad to address 9 Copilot comments and implement auth flow changes:

- **Kaylee** (commit b130fc0): Added `GET /v1/spaces` admin endpoint, enabling credential validation without side effects. Returns `SpaceResponse[]` on success; 401 on invalid secret.
- **Wash** (commits 7b8a1f5 & 2c92ca3): Fixed 5 frontend PR review comments (disabled async inputs, error parsing, URL normalization, render-side effects, navigation). Then rewrote admin auth flow—removed localStorage, validate-by-fetching `GET /v1/spaces`, in-memory state only. Page refresh returns to login form. Moved back navigation to shell chrome.
- **Zoe** (commit af96c28): Fixed QR test naming convention; added 3 new `GET /v1/spaces` tests (valid/invalid/format). Test suite now 67 total.

**Key outcomes:**
- Admin auth is now ephemeral (no localStorage) and validates via GET /v1/spaces instead of test space creation
- All PR #41 frontend review feedback resolved
- Admin backend has dedicated listing endpoint with proper auth
- Test coverage expanded (67 total, 3 new GET /v1/spaces tests)

**Decisions.md updated:** Admin secret validation section corrected from outdated localStorage + test-space behavior to current GET /v1/spaces validation pattern.

## Team Updates (2026-03-18 Continued)

**Zoe completed Issue #26 (SignalR Client Tests):** Wrote comprehensive test suite for Wash's SignalR client service:
- Test file: `src/SharedSpaces.Client/src/lib/signalr-client.test.ts`
- 23 tests covering connection lifecycle (8), event handling (4), error/edge cases (6), configuration (5)
- Mock strategy: Class-based HubConnectionBuilder mock to properly intercept `new` operator
- Verified accessTokenFactory async function pattern, state tracking, stop idempotence, reconnection flow
- Key edge case documented: event handlers registered in constructor remain active after stop()
- All 84 client tests passing (14 api-client + 13 space-api + 23 signalr-client + 17 token-storage + 17 invitation)
- Branch: ready for commit alongside Wash's implementation

## Team Updates (2026-03-19)

**Wash completed SignalR client integration (Issue #26):** Built ~100 LOC service wrapper with auto-reconnect, event callbacks (onItemAdded, onItemDeleted, onStateChange), and accessTokenFactory pattern for JWT auth. Integrated into space-view.ts with event deduplication and dynamic status badge. Full refresh on reconnect strategy ensures consistency. Initial build issue with Tailwind dynamic classes fixed by Coordinator (see Wash's history for details).

**Client test suite:** Your 23 tests bring total to 84 passing (token storage 17 + invitation parsing 17 + API client 14 + token validation 13 + SignalR 23). Mocking pattern established for future SignalR work.

**What you learned:** Mock HubConnectionBuilder must be class-based (not function) for `new` operator to work in vitest. Edge case: event handlers registered in constructor remain active after `stop()`, allowing post-stop event delivery (expected SignalR behavior, documented in tests).

## Team Updates (2026-03-18 Continued)

**Zoe delivered space-view deduplication tests (2026-03-18T21:40Z):** Wrote comprehensive test suite for Wash's race condition fix:
- Test file: `src/SharedSpaces.Client/src/features/space-view/space-view.test.ts`
- 7 tests covering all dedup scenarios: existing dedup (item already in list), race condition (SignalR before API response), multiple file uploads with early SignalR events, failed upload cleanup, delete during pending upload, and cross-member events
- **Key test strategy:** Mix of integration tests (full upload flow with delayed API responses) and unit tests (direct handleItemAdded invocation) for reliability
- **Critical race condition test passing:** Verifies `pendingItemIds` blocks SignalR event when API response hasn't completed yet
- Tests validate Wash's fix: `pendingItemIds.add()` before API call, `handleItemAdded` checks `pendingItemIds.has()`, cleanup in finally block
- All 7 tests passing; dedup logic verified correct for both existing behavior and new race condition fix
- Client test suite now: 91 passing tests (7 space-view + 84 existing)

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
- Client-side tests use vitest 4.x with happy-dom environment for browser APIs simulation; tests are co-located with source files using `*.test.ts` naming convention in `src/SharedSpaces.Client/src/lib/`.
- Client localStorage mocking requires explicit setup via `vitest.setup.ts` because happy-dom's default localStorage implementation lacks full API surface; custom mock provides `getItem`, `setItem`, `removeItem`, and `clear` methods.
- Invitation parsing trims whitespace from each part BEFORE validation, so leading/trailing spaces in URL, space ID, or PIN parts are handled gracefully; tests may include whitespace-padded inputs for edge case coverage.
- Token storage uses composite keys in format `serverUrl:spaceId` to support multi-server client scenarios; tests should verify token isolation across different server+space combinations.
- API client tests mock global `fetch` with vitest's `vi.fn()` and should verify both success responses and typed error handling for HTTP status codes (400/401/404) plus network failures.
- Client test scripts in package.json: `npm test` runs vitest once, `npm run test:watch` runs vitest in watch mode for TDD workflow.
- Admin endpoint tests (`AdminEndpointTests.cs`) verify POST /v1/spaces and POST /v1/spaces/{spaceId}/invitations with comprehensive auth failure, validation edge cases, and happy path coverage; all admin endpoints use `AdminAuthenticationFilter` with X-Admin-Secret header validation.
- Admin invitation generation creates 6-digit PINs, hashes them for storage, and returns both invitation string (server_url|space_id|pin format) and base64 PNG QR code; tests verify QR code PNG signature (0x89504E47) and PIN uniqueness across multiple invitations.
- TestWebApplicationFactory requires `Microsoft.EntityFrameworkCore.Infrastructure` using statement to access `IDbContextOptionsConfiguration<>` for proper DbContext service removal during test setup.
- `GET /v1/spaces` is an admin-protected endpoint that returns all spaces as the shared `SpaceResponse` shape ordered by `CreatedAt` descending; integration tests should cover empty-state, auth failure, and newest-first listing.
- Admin member-management coverage is strongest when tests create `SpaceMember` rows through the real invitation + token exchange flow (create space → create invitation → POST `/v1/spaces/{id}/tokens`) instead of seeding members directly, so member listing/revocation scenarios exercise the join pipeline end to end.
- Admin invitation-management list responses are metadata-only (`InvitationListResponse` = `Id` + `SpaceId`) and must never expose hashed PINs; tests should deserialize the array shape and also inspect raw JSON to confirm no `pin` property leaks.
- SignalR client tests must mock `HubConnectionBuilder` as a class constructor, not a function returning an object; vitest requires `class MockHubConnectionBuilder` with methods that delegate to shared mock builder to properly intercept `new HubConnectionBuilder()` calls.
- SignalR client event handlers are registered in constructor (not start/stop), so events can theoretically fire after `stop()` if the connection receives messages; tests should verify handlers remain active after stop to document this behavior.
- SignalR client `accessTokenFactory` is an async function (not a plain string), enabling dynamic token refresh; tests should verify the factory function is passed through to `withUrl` options and returns the expected JWT.
- SignalR client stop() is defensive and checks `HubConnectionState` before calling `connection.stop()`, preventing errors on already-disconnected connections; tests should verify idempotent stop behavior and no-op on pre-disconnected state.
- SignalR client state tracking uses a getter that maps `HubConnectionState` enum values to simplified `ConnectionState` union type ('connected' | 'disconnected' | 'reconnecting'); tests should verify state transitions via connection lifecycle callbacks (onreconnecting, onreconnected, onclose).
- Testing Lit component race conditions requires a hybrid strategy: use integration tests with controlled async timing for end-to-end flows, but prefer direct method invocation (unit-style) for logic verification to avoid test flakiness from unpredictable async component initialization timing.
- Space-view deduplication tests verify two dedup mechanisms: `items.some()` check blocks items already in the list, and `pendingItemIds.has()` blocks SignalR events for items currently being uploaded (before API response completes); both mechanisms must pass for correct behavior.
- Delete confirmation overlay (issue #53): tested via direct method invocation on SpaceView — `handleDeleteRequest`, `cancelDelete`, `confirmDelete`, `getItemPreviewLabel`. Edge cases: empty content, boundary-length text (exactly 40 chars), trailing whitespace trimming on truncation, file items bypass truncation, missing token guard clause, auth vs non-auth API failure handling, sequential delete-confirm-delete flows.
- When production code renames methods (e.g., `handleDelete` → `confirmDelete`), pre-existing tests that call the old name will fail with "not a function" — always check and fix stale test references when testing a feature that refactored method names.

## Learnings (2026-03-19 Continued)

**File type icon utility test patterns (Issue #54 support):**
- Lit `TemplateResult` objects are JavaScript objects with specific shape; tests verify `typeof result.svg === 'object'` and truthy value, not template rendering output
- File extension detection must be case-insensitive (`.JPG` === `.jpg`) to handle varied user file naming conventions
- Edge cases: empty strings, no-extension filenames, multi-dot filenames (`my.file.name.pdf`) all require explicit coverage
- Icon utilities return structured results (`{ svg: TemplateResult, colorClass: string }`), enabling type-safe assertions on both shape and color class format
- Tailwind color class validation: check string pattern (`/^(text-|bg-|border-)/`) to verify utility returns valid CSS class names
- Tests for parallel implementation work (while building the source) should be written first, committed even when they fail due to missing source file, establishing TDD contract before implementation lands
- Co-located test pattern (`*.test.ts` next to `*.ts` source) scales well for utility libraries; vitest runs individual test files with `npx vitest run src/lib/file-icons.test.ts`

## Learnings (PR #64 Review Feedback)

- Truthy/type-only assertions are a false sense of security — if every extension returned the same icon/color, those tests would still pass. Always assert specific expected values for at least one representative per category.
- Cross-category distinctness tests ("image color ≠ code color") catch regressions where category mappings accidentally collapse to the same value, complementing per-extension assertions.
- When source and tests evolve in parallel branches, colorClass string assertions are more stable than SVG content assertions since color mappings change less frequently than icon markup.
