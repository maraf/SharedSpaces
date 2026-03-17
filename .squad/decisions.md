# Squad Decisions

## Active Decisions

### Issue Decomposition: SharedSpaces Implementation Plan

**Decision Date:** 2026-03-16  
**Decided By:** Mal (Lead/Architect)  
**Status:** Active

#### Context
The SharedSpaces README defines a 5-phase implementation plan (Core Server → Real-time → React Client → Admin UI → Offline & Polish). We needed to decompose this into GitHub issues that developers can pick up and execute independently.

#### Decision
Created 14 GitHub issues (#17-#30) with the following structure:

**Granularity**
- Each issue is a coherent unit of work for one developer
- Not too fine-grained (avoided 1 issue per endpoint)
- Not too coarse (avoided 1 issue per phase)
- Target: 10-15 issues total

**Issue Content**
- Clear, specific titles
- Detailed acceptance criteria (checkbox lists)
- Technical notes with architectural context
- Explicit dependencies (references to other issues)
- Labels: 'squad' + phase label (phase:1-5) + category label (backend/frontend/infrastructure/real-time)

**Phase Distribution**
- **Phase 1 (Core Server):** 5 issues — highest complexity, foundational work
- **Phase 2 (Real-time):** 1 issue — focused SignalR implementation
- **Phase 3 (React Client):** 4 issues — parallel to server work, can start independently
- **Phase 4 (Admin UI):** 1 issue — straightforward UI work
- **Phase 5 (Offline & Polish):** 3 issues — independent enhancements

**Key Architectural Decisions Embedded in Issues**
- Client-generated item GUIDs (not server-generated)
- JWT claims include server_url for multi-server client support
- Admin auth via simple header secret (X-Admin-Secret), not JWT
- File storage abstraction layer for future cloud swap
- Invitation PINs deleted immediately after JWT issuance
- JWT has no expiration; validity = SpaceMember.IsRevoked check

#### Rationale
- **Why 14 issues instead of 30+?** Each issue groups logically related work (e.g., #20 covers entire join/auth flow rather than splitting into 4 separate issues). This reduces coordination overhead and makes each issue independently valuable.
- **Why explicit dependencies?** Developers need to know what must be done first; no ambiguity about ordering.
- **Why detailed acceptance criteria?** Reduces back-and-forth; developers understand "done" without constantly referring to README.

#### Consequences
- **Positive:** Clear work breakdown, each issue independently implementable, dependencies explicit, labels enable filtering
- **Negative:** Requirement changes require multiple issue updates; some issues (e.g., #21) are large (2-3 days)
- **Mitigations:** Issues can be split during execution; regular standups catch changes early

#### Alternatives Considered
1. **One issue per endpoint (30+ issues)** — Rejected: too granular, increases coordination, obscures "big picture"
2. **One issue per phase (5 issues)** — Rejected: too coarse, impossible parallelization, creates bottlenecks
3. **Milestone-based grouping without explicit dependencies** — Rejected: developers wouldn't know what to work on first

---

### SQLite Path Resolution and Startup Migrations

**Decision Date:** 2026-03-16  
**Decided By:** Kaylee (Backend Dev)  
**Status:** Active

#### Context
Issue #17 introduced the first ASP.NET Core server scaffold plus EF Core with SQLite. We needed local runtime startup and `dotnet ef` tooling to behave consistently against the same database file.

#### Decision
Keep the SQLite connection string in configuration as `ConnectionStrings:DefaultConnection`, and normalize its relative `Data Source` through `SqliteConnectionStringResolver` for both runtime registration and the design-time `AppDbContextFactory`. Also apply pending EF Core migrations during startup through `DatabaseInitializationExtensions.InitializeDatabaseAsync()`.

#### Rationale
This keeps local setup zero-config while avoiding the common mismatch where `dotnet run` and `dotnet ef` create different SQLite files depending on the working directory. It also means future backend slices can assume the schema is applied when the API starts.

#### Impact
- SQLite database file is normalized to a consistent location regardless of working directory
- Pending migrations auto-apply on API startup
- Fresh local environments require zero manual database setup

---

### Test Project Scaffold Alignment

**Decision Date:** 2026-03-16  
**Decided By:** Zoe (Tester)  
**Status:** Active

#### Context
Issue #17 was laying down the .NET solution/server scaffold, and the server test project needed to be created in parallel to avoid blocking test infrastructure decisions.

#### Decision
Keep the server test project on the same target framework and EF Core package line as `src/SharedSpaces.Server`, and pin `FluentAssertions` to 6.12.0 for now.

#### Rationale
Matching the server scaffold avoids package drift before real tests land, and the older FluentAssertions release avoids the new commercial-license warning in routine test runs.

#### Impact
- Test project uses xUnit, Moq 4.20.70, FluentAssertions 6.12.0, EF Core InMemory
- Future server test work should preserve framework/package alignment unless the team intentionally upgrades the server stack first
- Test database isolation via InMemory provider avoids external dependencies

---

### GitHub Actions CI Workflow

**Decision Date:** 2026-03-17  
**Decided By:** Kaylee (Backend Dev)  
**Status:** Active

#### Context
Pull requests targeting `main` needed automatic server build and test feedback before merge to prevent broken states reaching production.

#### Decision
Add `.github/workflows/ci.yml` as a baseline GitHub Actions workflow that runs on `pull_request` to `main` and `push` to `main`, using `ubuntu-latest` plus .NET 9 to restore, build, and test `SharedSpaces.sln`.

#### Rationale
- Keeps the first CI pass intentionally small and reliable
- Uses the solution file so server and test projects stay aligned automatically
- Mirrors local validation commands already used by the team
- Foundation for future branch protection rules

#### Impact
- PRs now receive automated feedback before merge
- Reduces risk of broken server state reaching main
- All 13 tests pass in CI environment

---

### JWT Claim Validation in Auth-Flow Tests

**Decision Date:** 2026-03-17  
**Decided By:** Zoe (Tester)  
**Status:** Active

#### Context
Issue #20 requires JWTs issued by the token exchange flow to carry specific claims (`sub`, `display_name`, `server_url`, `space_id`) and explicitly omit expiration. Several auth-flow tests were only proving that a token existed or had JWT shape, leaving claim regressions under-tested.

#### Decision
For every successful token issuance path covered in `tests/SharedSpaces.Server.Tests/TokenEndpointTests.cs`, decode the JWT payload and validate the concrete claim values against the created `SpaceMember`, the requested display name, the configured `Server:Url`, and the target space ID. Keep a dedicated no-expiration assertion as well.

#### Rationale
- Validates the contract the client actually depends on, not just token issuance mechanics
- Turns common auth-flow tests into regression coverage for claim mapping, configuration wiring, and the no-expiration policy
- Prevents future auth changes from silently breaking client expectations

#### Impact
- Auth-flow test suite now validates JWT payload shape and semantics
- Stronger safety net for JWT configuration changes
- Higher confidence in client-server JWT contract

---

### JWT Test Scaffold

**Decision Date:** 2026-03-17  
**Decided By:** Zoe (Tester)  
**Status:** Active

#### Context
Issue #20 needs integration coverage for token issuance and JWT-protected requests before the rest of the protected item endpoints are fully in place.

#### Decision
Use `WebApplicationFactory<Program>` in `tests/SharedSpaces.Server.Tests/TokenEndpointTests.cs`, override `AppDbContext` to EF Core InMemory for test isolation, and expose the API entry point with a `public partial class Program` marker. Also make startup database initialization provider-aware so WebApplicationFactory hosts can call `EnsureCreatedAsync()` for non-relational providers instead of always attempting migrations.

#### Rationale
- Keeps auth-flow tests close to the real HTTP pipeline while avoiding SQLite file coupling and external setup in CI/local runs
- The provider-aware initialization change is small, production-safe, and removes a recurring failure mode
- Removes need for external setup in CI/local test runs

#### Impact
- Auth integration tests run in isolation with InMemory database
- WebApplicationFactory pattern enables future test scenarios with custom configuration
- Startup initialization now works seamlessly with both SQLite (production) and InMemory (test) providers

---

### Space Items CRUD Endpoints & File Storage Abstraction

**Decision Date:** 2026-03-17  
**Decided By:** Kaylee (Backend Dev)  
**Status:** Active

#### Context
Issue #21 required authenticated space/item CRUD endpoints plus file uploads and quota enforcement without disrupting existing space, invitation, or token endpoint implementations.

#### Decision
- Implement item endpoints as a vertical slice in `src/SharedSpaces.Server/Features/Items/ItemEndpoints.cs`, mapped from `Program.cs` with `.RequireAuthorization()` on the `/v1/spaces/{spaceId}` group
- Persist file quota metadata directly on `SpaceItem.FileSize` so quota checks do not depend on filesystem scans
- Introduce `IFileStorage.cs` abstraction with `LocalFileStorage` as the initial implementation, storing files relative to `Storage:BasePath` for future cloud storage swaps
- Read multipart form payloads manually in the item upsert endpoint so JWT authorization runs before form parsing and both text/file upserts stay in one endpoint contract

#### Rationale
- Vertical slice pattern keeps the backend aligned with existing code organization and preserves thin endpoint wiring in `Program.cs`
- Persisting `FileSize` metadata makes quota enforcement deterministic and cheap (no filesystem scans)
- `IFileStorage` abstraction decouples the item domain from storage implementation, enabling cloud storage adoption without reworking endpoints
- Manual form parsing within the endpoint handler lets authentication middleware run first, simplifying the request pipeline

#### Impact
- Four new endpoints: GET space metadata, GET items list, PUT upsert (text or file), DELETE item + storage cleanup
- File storage now pluggable via dependency injection
- Quota limits enforced at API layer (default: 100 MB per space)
- Space membership validation runs before item operations
- Multipart file uploads supported with server-rendered file paths in responses

---

### .NET 10 Migration & JWT Authentication Fix

**Decision Date:** 2026-03-17  
**Decided By:** Kaylee (Backend Dev)  
**Status:** Active

#### Context
The project was running on .NET 9, but .NET 10 (10.0.100 SDK) was available and needed for alignment with team infrastructure and long-term support.

#### Decision
Migrated the entire solution from .NET 9 to .NET 10:
1. Updated `TargetFramework` to `net10.0` in both server and test project files
2. Updated all Microsoft.* NuGet packages from 9.0.4 to 10.0.0
3. Explicitly added `Microsoft.IdentityModel.JsonWebTokens` 8.16.0 as a direct dependency
4. Updated CI workflow (`.github/workflows/ci.yml`) to use .NET 10 SDK

#### Rationale
- .NET 10 is the latest stable LTS release and provides improved JWT token handling via `JsonWebTokenHandler`
- JWT bearer middleware in .NET 10 requires `Microsoft.IdentityModel.JsonWebTokens` to be explicitly referenced; without it, validation silently falls back to the older handler
- All existing tests pass with the migration; no domain code changes required
- CI now tests against the target runtime version

#### Impact
- Solution targets .NET 10 with all 32 tests passing
- JWT validation works correctly with proper token rejection for invalid signatures/claims
- Reduced risk of silent JWT validation failures in production
- Future JWT enhancements can rely on `JsonWebTokenHandler` improvements
- Note: Future developers must ensure .NET 10 projects explicitly reference `Microsoft.IdentityModel.JsonWebTokens`, unlike .NET 9 where it was transitively included

---

---

### Lit HTML + WebComponents Approved for SharedSpaces Client

**Decision Date:** 2026-03-17  
**Approved By:** Marek Fišera (Project Owner)  
**Lead Approval:** Mal (Lead/Architect)  
**Related Issue:** #23  
**Status:** ✅ **APPROVED** (active decision)

#### Summary

After team evaluation and Marek Fišera's final decision, the SharedSpaces client will use **Lit HTML + WebComponents** (not React) for the Phase 3 SPA implementation.

#### Key Rationale

1. **Bundle Size:** ~40% reduction (110-140 KB gzipped vs 190-230 KB React) — significant UX win for self-hosted, mobile-first deployments
2. **Standards-Based:** WebComponents are the web platform standard, not framework-dependent
3. **SignalR Integration:** Native lifecycle hook support (connectedCallback/disconnectedCallback) is cleaner than React patterns
4. **Routing:** Single-view app (/join → /space/:spaceId flow) eliminates routing as a concern — Lit's weak point becomes irrelevant
5. **Tailwind CSS:** Light DOM mode (override createRenderRoot) makes Tailwind work seamlessly without workarounds

#### Technical Implementation

- **Framework:** Lit HTML with TypeScript
- **DOM Mode:** Light DOM (for Tailwind compatibility)
- **Build:** Vite (unchanged)
- **State Management:** @lit/context for global auth state
- **Testing:** Vitest Browser Mode + Playwright
- **SignalR:** Native JavaScript client with Lit lifecycle hooks
- **Architecture:** Vertical slice structure under features/ (join, space-view, admin)

#### Acceptance Criteria (Issue #23)

- [ ] Initialize Vite + Lit + TypeScript project under src/SharedSpaces.Client
- [ ] Set up minimal view switching (single-view app: /join → /space/:spaceId flow)
- [ ] Create project structure: features/, components/, lib/
- [ ] Add Tailwind CSS with light DOM rendering (override createRenderRoot)
- [ ] Configure ESLint and Prettier
- [ ] Add basic app shell component
- [ ] Verify dev server runs and hot reload works

#### Team Evaluation Context

Mal and Wash conducted independent friction research on current Lit ecosystem state (2026-03-17 13:36):
- **Mal's findings:** Verified routing landscape (Vaadin deprecated, Labs router experimental), confirmed Tailwind + Lit is workable via light DOM, testing ecosystem capable but less cohesive than React
- **Wash's findings:** Softened "dealbreaker" concerns, acknowledged Tailwind workarounds exist, validated testing gap has narrowed, confirmed routing is still the weakest point but not a blocker for single-view app
- **Convergence:** Single-view architecture eliminates the core routing friction. All other concerns become manageable trade-offs. Lit remains viable as the approved choice.

#### Accepted Trade-offs

- Smaller ecosystem (mitigated by standards-based approach)
- React DevTools unavailable (web platform DevTools sufficient)
- Team learning curve 3-5 days (shallow curve for web dev teams, excellent documentation)

#### Impact

- **GitHub Issue #23:** Updated with new title, body, and acceptance criteria
- **GitHub Issue Comment:** Added explaining the technology decision
- **Squad Team Docs:** Updated team.md, agents/wash/charter.md, and routing.md to reflect Lit + WebComponents
- **Wash's Charter:** Updated to reflect Lit expertise instead of React
- **Timeline:** Zero impact — Phase 3 hasn't started yet
- **Dependency:** No coupling to Phase 1 or Phase 2 work

#### Alternatives Considered

- **React (prior recommendation):** Mature ecosystem, large bundle, excellent tooling
- **Lit HTML (approved):** Lightweight, standards-based, smaller bundle, acceptable routing for single-view app
- **Vue 3:** Not evaluated; React vs Lit was the proposed comparison

---

### SignalR Hub Integration Testing Strategy

**Decision Date:** 2026-03-17  
**Decided By:** Zoe (Tester)  
**Related Issue:** #22  
**Status:** Active

## Context

Issue #22 requires comprehensive integration tests for the SignalR hub implementation that Kaylee is building. The tests needed to validate real-time event broadcasting, JWT authentication, space group management, and connection lifecycle scenarios without the actual hub implementation being available yet.

## Decision

Created `tests/SharedSpaces.Server.Tests/SpaceHubTests.cs` with 15 comprehensive integration test scenarios using `Microsoft.AspNetCore.SignalR.Client` 10.0.0 and the existing `WebApplicationFactory<Program>` test infrastructure.

### Test Coverage

**Connection & Authentication (5 tests):**
- Valid JWT → connection succeeds
- Missing JWT → 401 Unauthorized
- Invalid/malformed JWT → 401 Unauthorized
- Revoked member JWT → 401 Unauthorized
- Malformed token string → 401 Unauthorized

**JoinSpace Method (2 tests):**
- Matching spaceId in JWT claim → success
- Mismatched spaceId in JWT claim → hub exception

**Event Broadcasting (5 tests):**
- ItemAdded with text item → full event data received
- ItemAdded with file item → full event data with file path received
- ItemDeleted → event received with item ID
- Client not in space group → does NOT receive events
- Multiple clients in same space → ALL receive broadcasts

**Edge Cases (3 tests):**
- Disconnect and reconnect → can rejoin space group
- Hub route with non-existent space → appropriate error
- Connection lifecycle validation

## Technical Implementation

### Hub Connection Pattern
```csharp
var connection = new HubConnectionBuilder()
    .WithUrl($"{testServer}/v1/hubs/space/{spaceId}", options => {
        options.HttpMessageHandlerFactory = _ => factory.Server.CreateHandler();
        options.AccessTokenProvider = () => Task.FromResult<string?>(token);
    })
    .Build();
```

### Event Assertion Pattern
```csharp
var receivedEvent = new TaskCompletionSource<ItemAddedEvent>();
connection.On<ItemAddedEvent>("ItemAdded", evt => receivedEvent.SetResult(evt));

await connection.StartAsync();
await connection.InvokeAsync("JoinSpace", space.Id);

// Trigger the event (e.g., PUT an item)

var receivedTask = await Task.WhenAny(receivedEvent.Task, Task.Delay(TimeSpan.FromSeconds(5)));
receivedTask.Should().Be(receivedEvent.Task, "Event should be received within timeout");
```

### Event Structure
Tests validate full event payloads match production records:
- `ItemAddedEvent`: Id, SpaceId, MemberId, DisplayName, ContentType, Content, FileSize, SharedAt
- `ItemDeletedEvent`: Id, SpaceId

## Rationale

- **WebApplicationFactory reuse:** Leverages existing test infrastructure (InMemory database, config overrides, helper methods) rather than creating separate SignalR-specific test fixtures
- **Real JWT validation:** Tests exercise the actual JWT authentication pipeline including revocation checks and claim validation
- **Timeout-based assertions:** Using `Task.WhenAny` with timeouts provides clear failure messages and prevents hung tests
- **Full event validation:** Tests verify complete event structure including all fields to catch regressions in broadcast payloads
- **TDD approach:** Tests written before implementation exists, ensuring they validate real requirements rather than just implementation details

## Impact

- 15 new integration tests covering all SignalR acceptance criteria from Issue #22
- Tests compile successfully but will fail until hub implementation is merged
- Test branch `squad/22-signalr-tests` can be merged independently or alongside Kaylee's `squad/22-signalr-hub` branch
- Foundation for future real-time feature testing (e.g., typing indicators, presence)

## Expected Test Status

**Before hub implementation merge:**
- All 15 tests will fail with connection/routing errors
- This is expected and documented

**After hub implementation merge:**
- Tests should pass if implementation follows standard ASP.NET Core SignalR patterns
- Any failures indicate either test assumptions or implementation deviations

## Dependencies

- `Microsoft.AspNetCore.SignalR.Client` 10.0.0 NuGet package (added)
- Existing `TestWebApplicationFactory` infrastructure
- JWT test helpers from `ItemEndpointTests.cs`

## Alternatives Considered

1. **Mock-based SignalR tests:** Rejected because we wanted to test real WebSocket/long-polling connections and actual JWT validation
2. **Separate test fixture for SignalR:** Rejected due to code duplication; WebApplicationFactory pattern works for both REST and SignalR
3. **Wait for implementation first:** Rejected; TDD approach ensures tests validate requirements, not just implementation

---

### Storage Path Migration — User Directive

**Decision Date:** 2026-03-17  
**Decided By:** Marek Fišera (User Directive), Executed by Kaylee (Backend Dev)  
**Status:** Active

#### Context

User directive requested repository-local storage paths to replace server defaults and centralize test artifacts.

#### Decision

Move application storage to `./artifacts/storage` and test storage to `./artifacts/storage-tests`. Update `.gitignore` to exclude test result files (`*.trx`, `TestResults/`, `artifacts/`).

#### Implementation

- App storage default in `src/SharedSpaces.Server/Program.cs` set to `./artifacts/storage`
- Test host override in `tests/SharedSpaces.Server.Tests/` sets `Storage:BasePath` to `./artifacts/storage-tests`
- Old runtime directories cleaned from disk
- `.gitignore` updated to exclude `*.trx`, `TestResults/`, `artifacts/`

#### Rationale

- **Isolation:** Separates application state from test state, preventing accidental shared writes
- **Cleanup:** Centralizes all runtime artifacts into one excluded directory
- **Consistency:** Both local development and CI environments use same paths

#### Impact

- 46 tests passing (verified post-migration)
- Storage paths now isolated per environment
- Commit: ffed621

---

### SignalR Hub Route Consistency

**Decision Date:** 2026-03-17  
**Decided By:** Marek Fišera (User Directive), Executed by Kaylee (Backend Dev)  
**Status:** Active

#### Context

SignalR hub endpoint was routed at `/v1/hubs/space/{spaceId}`, which was inconsistent with the rest of the API surface where space-scoped resources live under `/v1/spaces/{spaceId}/...`.

#### Decision

Changed the SignalR hub route from `/v1/hubs/space/{spaceId}` to `/v1/spaces/{spaceId}/hub` to align with the existing API surface pattern.

#### Implementation

- Updated `HubEndpoints.cs` to map `SpaceHub` at `/v1/spaces/{spaceId}/hub`
- Updated `JwtAuthenticationExtensions.cs` to recognize both the hub endpoint and the negotiate endpoint under `/v1/spaces/...` for query-string JWT token extraction
- Updated `SpaceHubTests.cs` to use the new route
- Refreshed README.md route example to match the implementation

#### Rationale

- Consistency: All space-scoped resources now follow the uniform `/v1/spaces/{spaceId}/...` pattern
- Predictability: Developers can infer endpoint locations from the API pattern
- No breaking changes to production: Hub is still in development phase

#### Validation

- Build: ✅ passing (`dotnet build SharedSpaces.sln --nologo`)
- Tests: ✅ 46/46 passing (`dotnet test SharedSpaces.sln --nologo`)
- Commit: a935139

#### Impact

- Hub is now discoverable via standard pattern
- JWT authentication works consistently with query-string extraction for the new route
- All existing tests pass

---

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
