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
- Hub implementation is merged and the SignalR test suite is now passing
- Test branch `squad/22-signalr-tests` remains the foundation for future real-time feature testing (e.g., typing indicators, presence)

## Current Test Status

- All SignalR integration tests are passing against the current hub implementation
- Any future failures indicate either regressions or changed expectations that should be reviewed explicitly

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

- Test artifacts isolated from application runtime state
- Single `.gitignore` rule excludes all build/storage artifacts
- CI and local builds have consistent artifact paths

---

### Aspire AppHost for Local Development Orchestration

**Decision Date:** 2026-03-18  
**Decided By:** Kaylee (Backend Dev)  
**Status:** Active

#### Context

SharedSpaces has a .NET server (`SharedSpaces.Server`) and a Vite/Lit client (`SharedSpaces.Client`) that developers need to run simultaneously during local development. The server's CORS depends on knowing the client's origin URL, and the client needs the server's URL. Manually coordinating these in separate terminal windows is error-prone.

#### Decision

Introduce .NET Aspire as the local dev orchestration layer via a minimal AppHost project:

- **Project:** `src/SharedSpaces.AppHost/SharedSpaces.AppHost.csproj`
- **SDK:** `Aspire.AppHost.Sdk/13.0.2` (current stable for .NET 10)
- **Target:** net10.0
- **Orchestrates:**
  - Server: `AddProject<Projects.SharedSpaces_Server>("server")` — references existing Server project
  - Client: `AddNpmApp("client", "../SharedSpaces.Client", "dev")` — runs Vite dev server
- **Key wiring:**
  - Client gets explicit HTTP endpoint on port 5173 via `WithHttpEndpoint(port: 5173, env: "PORT")`
  - Client sets `BROWSER=none` to prevent auto-opening browser
  - Client waits for server to be ready via `WaitFor(server)`
  - Server receives client URL via `Server__DefaultClientAppUrl` environment variable pointing at client's HTTP endpoint
- **No ServiceDefaults project** — keeping it minimal per user request for "single file" orchestration

#### Rationale

- **Zero config startup:** One `dotnet run --project src/SharedSpaces.AppHost` starts both server and client with correct URLs
- **CORS works automatically:** Server's `Server:DefaultClientAppUrl` is set to the actual client endpoint, so CORS policy matches reality
- **Dependency awareness:** Client waits for server to be ready before starting
- **Aspire Dashboard included:** Free observability/logs/metrics UI for debugging
- **Minimal footprint:** Just one .csproj + one Program.cs, no extra abstractions

#### Impact

- **Positive:** Local dev becomes one command; URL mismatches eliminated; observability via Aspire Dashboard; foundation for Docker Compose generation in Phase 5
- **Negative:** Adds Aspire SDK as a dev dependency (but doesn't affect production deployment)
- **Migration:** Developers can continue using `dotnet run` for Server + `npm run dev` for Client if they prefer; AppHost is opt-in

#### Alternatives Considered

1. **Docker Compose only** — Rejected: requires Docker Desktop; Aspire provides better .NET integration and will generate Docker Compose in Phase 5
2. **Custom shell scripts** — Rejected: platform-specific (Windows vs Linux); no observability; no dependency management
3. **ServiceDefaults + AppHost** — Rejected: user requested minimal "single file" approach; ServiceDefaults adds ceremony without value for this simple scenario

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

### PR #37 Backend Review Feedback Application

**Decision Date:** 2026-03-17  
**Decided By:** Marek Fišera (User + Copilot Reviewer), Executed by Kaylee & Zoe  
**PR:** #37  
**Status:** Complete

#### Context

Copilot reviewer raised feedback on PR #37 addressing SignalR hub integration design, storage configuration rigor, and test async patterns. Five key improvement areas identified:

1. Cleaner boundary between HTTP endpoints and SignalR broadcasting
2. Automatic hub group joining (remove explicit JoinSpace calls)
3. Storage configuration must be explicit (no defaults)
4. Route parameter constraints (`:guid` on spaceId)
5. Test async patterns (RunContinuationsAsynchronously)

#### Decision

**Backend (Kaylee):**
- Extract hub broadcast responsibilities behind `ISpaceHubNotifier` / `SpaceHubNotifier` service interface
- Auto-join the SignalR space group inside `SpaceHub.OnConnectedAsync` after validating the route `spaceId` against the JWT `space_id` claim
- Treat SignalR broadcasts as best-effort with warning logs so transient hub issues do not turn successful item writes/deletes into HTTP 500 responses
- Require `Storage:BasePath` from configuration instead of relying on file-storage defaults
- Add `:guid` route constraint to hub endpoint spaceId parameter

**Tests (Zoe):**
- Update `TaskCompletionSource` instantiation to use `TaskCreationOptions.RunContinuationsAsynchronously`
- Reorder assertions to verify HTTP success (PUT/DELETE) before awaiting broadcast events
- Remove explicit `JoinSpace` calls (now automatic in `OnConnectedAsync`)
- Verify test storage paths align with configuration at `./artifacts/storage-tests`

#### Implementation

**Files Modified:**
- `src/SharedSpaces.Server/Features/Hubs/SpaceHub.cs` (auto-join, :guid constraint)
- `src/SharedSpaces.Server/Features/Hubs/HubEndpoints.cs` (:guid constraint mapping)
- `src/SharedSpaces.Server/Features/Items/ItemEndpoints.cs` (ISpaceHubNotifier injection)
- `src/SharedSpaces.Server/Program.cs` (DI registration)
- `src/SharedSpaces.Server/Infrastructure/FileStorage/LocalFileStorage.cs` (required BasePath)
- `src/SharedSpaces.Server/Infrastructure/FileStorage/StorageOptions.cs` (required BasePath)
- `src/SharedSpaces.Server/appsettings.json` (explicit Storage:BasePath)

**Files Created:**
- `src/SharedSpaces.Server/Features/Hubs/ISpaceHubNotifier.cs`
- `src/SharedSpaces.Server/Features/Hubs/SpaceHubNotifier.cs`

**Test Files Modified:**
- `tests/SharedSpaces.Server.Tests/SpaceHubTests.cs` (async patterns, assertion order, no JoinSpace)
- `tests/SharedSpaces.Server.Tests/ItemEndpointTests.cs` (assertion order, storage paths)
- `tests/SharedSpaces.Server.Tests/TokenEndpointTests.cs` (storage paths)

#### Rationale

- **ISpaceHubNotifier:** Separates concerns — HTTP endpoints stay focused on persistence, broadcasting becomes best-effort infrastructure detail
- **Auto-join:** Reduces client logic complexity and eliminates manual JoinSpace calls
- **Best-effort broadcasts:** Resilience — failed broadcasts never block successful item writes
- **Required configuration:** Explicitness eliminates silent failures and makes storage setup visible in configuration
- **Route constraints:** Prevents route ambiguity and improves matching performance
- **Async patterns:** RunContinuationsAsynchronously + assertion ordering match real-world usage patterns

#### Validation

✅ Build: `dotnet build SharedSpaces.sln --nologo` passes  
✅ Tests: **46/46 passing** (`dotnet test SharedSpaces.sln --nologo`)  
✅ Backend commit: 9d723bd  
✅ Test commit: 0a93ad9  

#### Impact

- Hub integration fully decoupled from HTTP layer
- Storage configuration now explicit and auditable
- Test async patterns match production best practices
- All existing functionality preserved; tests act as regression guard

---

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction

---

### Issue #23 Frontend Client Bootstrap

**Decision Date:** 2026-03-18  
**Decided By:** Wash (Frontend Dev)  
**Issue:** #23  
**Status:** Complete  

#### Context

Issue #23 established the first client scaffold under src/SharedSpaces.Client/.

#### Decision

Use a standalone Vite + Lit + TypeScript app with:
- Vertical slices in src/features/ (join, space-view, admin)
- Shared UI in src/components/
- Shared utilities and context in src/lib/
- A BaseElement light DOM base class for every rendered component
- Runtime API configuration sourced from <meta name="api-base-url"> in index.html
- Temporary in-component state switching in src/app-shell.ts instead of adding a router now
- Tailwind CSS v4 wired through @tailwindcss/vite with light DOM rendering
- ESLint + Prettier for code quality

#### Notes

- Current setup uses Vite 7.x because @tailwindcss/vite 4.2.x peers with Vite 5-7; revisit once the plugin supports Vite 8+
- Placeholder files for future auth and SignalR work live in src/lib/auth-context.ts and src/lib/signalr-client.ts
- Dev tooling and build validated; ready for feature development

#### Validation

✅ Dev server operational  
✅ Linting passed  
✅ Build successful  
✅ .NET tests passed  

#### Impact

- Frontend infrastructure ready for feature development
- Client communicates via HTTP to .NET API
- Established patterns for component architecture and styling

---

### Single-File Aspire AppHost Migration

**Decision Date:** 2026-03-18  
**Decided By:** Kaylee (Backend Dev), Marek Fišera (User Directive)  
**Status:** Complete  

#### Context

The local-development AppHost was originally introduced as a standalone project under `src/SharedSpaces.AppHost/`. Marek requested alignment with .NET 10 file-based app support and the Recollections-style single-file Aspire pattern to reduce ceremony and maintain a focused solution.

#### Decision

Migrate the AppHost from a project-based approach to a single-file Aspire application at `src/AppHost.cs` using:
- `#:sdk Aspire.AppHost.Sdk@13.0.2`
- `#:project .\SharedSpaces.Server\SharedSpaces.Server.csproj`
- `#:package Aspire.Hosting.NodeJs@9.5.2`

The file preserves the current orchestration behavior:
- `AddProject<Projects.SharedSpaces_Server>("server")`
- `AddNpmApp("client", "./SharedSpaces.Client", "dev")`
- `WithHttpEndpoint(port: 5173, env: "PORT")`
- `WithEnvironment("BROWSER", "none")`
- `WaitFor(server)`
- `server.WithEnvironment("Server__DefaultClientAppUrl", client.GetEndpoint("http"))`

#### Implementation

**Files Removed:**
- `src/SharedSpaces.AppHost/` (entire directory: .csproj, Program.cs, bin/, obj/)

**Files Produced:**
- `src/AppHost.cs` (single-file Aspire app)

**Files Modified:**
- `SharedSpaces.sln` (removed AppHost project entry)

#### Rationale

- **Matches .NET 10 patterns:** Aligns with modern file-based app support (neptuo/Recollections style)
- **Reduces ceremony:** Removes otherwise throwaway `.csproj`; solution focused on shippable projects
- **Preserves one-command dev:** Local-dev workflow now via `dotnet run src/AppHost.cs`
- **Maintains orchestration semantics:** No changes to how server and client interact or wait for each other

#### Validation

✅ `dotnet build src/AppHost.cs` — SUCCESS  
✅ `dotnet build SharedSpaces.sln` — SUCCESS  
✅ `dotnet test SharedSpaces.sln --no-build` — All 46 tests PASS  

#### Impact

- Development environment setup simplified to single command
- Solution structure more focused (only shippable projects remain)
- Aspire observability (Dashboard) remains available for local debugging
- Foundation for Phase 5 Docker Compose generation still intact

---

## Join Flow: Invitation Format and JWT Storage Pattern

**Decision Date:** 2026-03-18  
**Decided By:** Wash (Frontend Dev)  
**Status:** Implemented (Issue #24, PR #40)

### Context

Issue #24 required implementing the client-side join flow: parsing invitation links/strings, exchanging PIN for JWT, and storing tokens for multi-server access. This involved several UX and architecture decisions about invitation format, storage strategy, and form interaction patterns.

### Decision

#### Invitation Format
- **Server generates:** `serverUrl|spaceId|pin` (pipe-delimited, NOT colon-delimited)
- **QR code URL:** `{clientAppUrl}/?join={url_encoded_invitation_string}`
- **Example:** `https://client.example.com/?join=https%3A%2F%2Fserver.example.com%7C550e8400-e29b-41d4-a716-446655440000%7C123456`
- After successful parse, the client strips the `join` query parameter via `history.replaceState`

#### JWT Storage Strategy
- **Multi-server support:** Client can connect to multiple servers simultaneously
- **Storage key format:** `serverUrl:spaceId` (colon-separated composite key)
- **LocalStorage structure:**
  ```json
  {
    "sharedspaces:tokens": {
      "https://server1.com:space-guid-1": "jwt1...",
      "https://server2.com:space-guid-2": "jwt2..."
    },
    "sharedspaces:primaryDisplayName": "Alice"
  }
  ```
- **Primary display name:** Separate from per-space identity. Used to pre-fill join forms, but doesn't override the immutable display name for a space once set.

#### Form UX Pattern
- **Two entry modes:** Toggle between "paste invitation string" and "manual entry"
- **Auto-parsing:** Pasting an invitation string automatically extracts serverUrl, spaceId, and pin
- **URL pre-fill:** If user arrives via QR scan (`?join=...`), form is pre-populated
- **Display name persistence:** Pre-fill from localStorage, save on successful join
- **Error states:** Show user-friendly messages for 400/401/404/network errors
- **Loading states:** Disable inputs and show "Joining..." during API call

#### JWT Claims (client-side)
Client uses `jwt-decode` library (decode only, no verification) to extract:
- `sub` — SpaceMember GUID
- `display_name` — User's display name for this space
- `server_url` — Server URL (used for routing subsequent API calls)
- `space_id` — Space GUID

### Rationale

**Why pipe-delimited invitation format?**
- Server was already generating this format (see `InvitationEndpoints.cs`)
- Pipe (`|`) is safe in URLs when encoded, clear visual separator
- Avoids ambiguity with colon (used in storage keys)

**Why separate primary display name from per-space identity?**
- User may join multiple spaces with different identities
- Primary name is a convenience feature ("remember me for next time")
- Per-space identity is immutable once joined (server-enforced)

**Why `serverUrl:spaceId` as storage key?**
- Composite key uniquely identifies a space across multiple servers
- Colon separator is simple and doesn't conflict with URLs (which use `://`)
- Enables O(1) token lookup for any server+space combination

**Why toggle between paste/manual entry?**
- QR scan use case: user pastes entire string, wants minimal friction
- Manual entry use case: user types components separately (e.g., from email/text)
- Toggle allows both without cluttering UI

### Implementation Files
- `src/SharedSpaces.Client/src/lib/token-storage.ts` — JWT storage utilities
- `src/SharedSpaces.Client/src/lib/invitation.ts` — Invitation parsing
- `src/SharedSpaces.Client/src/lib/api-client.ts` — Token exchange API
- `src/SharedSpaces.Client/src/features/join/join-view.ts` — Join form component
- `src/SharedSpaces.Client/src/app-shell.ts` — Auth context wiring

### Consequences

**Positive:**
- Clear separation of concerns (storage, parsing, API, UI)
- Multi-server support baked in from day one
- Form UX accommodates both QR and manual entry flows
- Testable utilities (48 passing tests)

**Negative:**
- Pipe-delimited format is unconventional (most systems use query params or JSON)
- Client-side JWT decoding requires trusting the token (fine for local extraction, but server still validates)

**Risks:**
- If server changes invitation format, client parsing breaks (mitigated by validation)
- LocalStorage is synchronous and can block UI (acceptable for small payloads like JWTs)

### Alternatives Considered

1. **JSON-encoded invitation string** — Rejected: harder to type manually, more verbose
2. **Query param format (`?server=...&space=...&pin=...`)** — Rejected: server already uses pipe format, would require server change
3. **Store all JWTs in single array** — Rejected: no efficient lookup by server+space
4. **Use IndexedDB instead of localStorage** — Rejected: overkill for small key-value storage, adds async complexity

### Related Decisions
- See `.squad/decisions.md` for broader JWT auth architecture (issue #20)
- Server-side invitation generation in `Features/Invitations/InvitationEndpoints.cs`

### Open Questions
- Should we add JWT expiration handling? (Current spec: JWT has no expiration)
- Should we cache decoded claims to avoid repeated decoding? (Current: decode on every navigation)

---

## Client Test Infrastructure Setup

**Date:** 2026-03-18  
**Author:** Zoe (Tester)  
**Issue:** #24 (Join flow client tests)

### Decision

Set up vitest for client-side testing with co-located test files alongside source code in `src/SharedSpaces.Client/src/lib/*.test.ts`.

### Context

- Client code (Lit components, utilities) needs unit tests for join flow utilities
- No existing client test infrastructure in place
- Need fast, modern test runner compatible with Vite build pipeline
- Tests should validate business logic (token storage, invitation parsing, API client) without full DOM rendering

### Solution

1. **Test framework:** vitest 4.x (native Vite integration, fast, Jest-compatible API)
2. **Environment:** happy-dom (lightweight browser API simulation, faster than jsdom)
3. **Test location:** Co-located with source files (`*.test.ts` next to `*.ts` in `src/lib/`)
4. **localStorage mock:** Custom implementation in `vitest.setup.ts` (happy-dom's default incomplete)
5. **Test scripts:** `npm test` (CI), `npm run test:watch` (dev)

### Configuration Files

- `src/SharedSpaces.Client/vitest.config.ts` — Test environment and setup file registration
- `src/SharedSpaces.Client/vitest.setup.ts` — Global mocks (localStorage)
- `src/SharedSpaces.Client/package.json` — Test scripts and vitest dev dependency

### Coverage

First test suite covers join flow utilities:
- **token-storage.test.ts** (17 tests) — Multi-server token management, corrupted data handling
- **invitation.test.ts** (17 tests) — QR code parsing, validation edge cases
- **api-client.test.ts** (14 tests) — Token exchange, HTTP error handling, network failures

Total: 48 passing tests

### Rationale

**Why vitest over Jest?**
- Native Vite integration (no transform config needed)
- Faster startup and execution (reuses Vite transform cache)
- Same API as Jest (easy migration if needed)

**Why co-located tests?**
- Easier to find tests for a module
- Encourages writing tests alongside code
- Matches modern frontend conventions (Next.js, Remix, etc.)

**Why custom localStorage mock?**
- happy-dom's localStorage lacks `.clear()` method (test isolation needs this)
- Simpler than pulling in third-party mock libraries
- Full control over mock behavior for edge case testing

### Alternatives Considered

1. **Jest + jsdom:** Rejected — slower, requires additional transform config
2. **Separate `tests/` directory:** Rejected — harder to maintain, out of sync with modern practices
3. **No mock (use happy-dom default):** Rejected — missing `.clear()` breaks test isolation

### Future Considerations

- Add coverage reporting when client code matures (vitest has built-in coverage via c8/istanbul)
- Consider component testing with @testing-library/lit for UI components
- May need MSW (Mock Service Worker) for more complex API scenarios
### Issue #27 Admin Panel Implementation Patterns

**Decision Date:** 2026-03-18  
**Decided By:** Wash (Frontend Dev)  
**Status:** Implemented in #27

#### Context

Issue #27 required building an admin panel UI for space and invitation management. The panel needed to authenticate via admin secret, manage spaces, and generate invitations with QR codes.

#### Key Implementation Decisions

##### 1. Admin Secret Storage and Validation
- **Pattern:** Admin credentials (secret, server URL, spaces) are kept in ephemeral in-memory state only. No localStorage persistence.
- **Validation:** Credentials are validated by calling `GET /v1/spaces` with the submitted server URL and `X-Admin-Secret` header. A successful response returns the space list; 401 bounces back to the login form.
- **Rationale:** Ephemeral state avoids leaving admin credentials in the browser and ensures the session resets on page refresh. The dedicated GET /v1/spaces admin endpoint provides secure, non-destructive credential validation without side effects.

##### 2. Space Caching Strategy
- **Pattern:** Spaces are fetched on login via `GET /v1/spaces` and stored in ephemeral in-memory state only.
- **Rationale:** Since ephemeral credentials are validated by calling GET /v1/spaces, the response doubles as the source of truth. No localStorage persistence needed—consistent with the ephemeral auth design.
- **Benefit:** Spaces are always current per session, no stale cache issues across browser tabs or sessions.

##### 3. Per-Space Invitation State Management
- **Pattern:** Store invitation generation state in a Record<spaceId, InvitationState> component property
- **State includes:** isGenerating flag, clientAppUrl input, generated invitation, error message
- **Rationale:** Each space has independent invitation generation UI, so state is keyed by space ID. Component-local state avoids global state complexity for UI-only concerns.

##### 4. QR Code Display
- **Pattern:** Render base64-encoded PNG as data URL: `data:image/png;base64,${qrCodeBase64}`
- **Size:** Fixed 200x200px with white background padding via inline style
- **Rationale:** Server returns base64 PNG, so we render directly as an img src. No additional libraries needed.

##### 5. TypeScript Configuration Constraint
- **Issue:** `erasableSyntaxOnly` in tsconfig doesn't support constructor parameter properties (`public status?: number`)
- **Solution:** Declare class properties separately, assign in constructor body
- **Rationale:** Matches project's TypeScript configuration and maintains type safety.

#### Styling Consistency

Followed existing dark theme patterns from join-view and space-view:
- **Backgrounds:** slate-950 (base), slate-900/70-80 (cards), slate-950/60 (forms)
- **Borders:** slate-800 (solid), slate-700 (dashed/subtle)
- **Text:** slate-50 (primary), slate-300 (secondary), slate-400 (labels)
- **Primary actions:** sky-400 background, slate-950 text, hover to sky-300
- **Success states:** emerald-400, emerald-900/950 backgrounds
- **Errors:** red-900 border, red-950/50 background, red-300 text
- **Small caps labels:** text-xs font-semibold uppercase tracking-[0.24em]
- **Rounded corners:** rounded-2xl for cards, rounded-3xl for large containers, rounded-full for buttons

#### Component Architecture

- **API Client:** Separate `admin-api.ts` module with typed functions and custom error class
- **Component:** Single `admin-view.ts` component managing all admin UI state
- **Sub-components:** Not needed — conditional rendering keeps complexity manageable
- **Error Handling:** Per-operation error states (space creation vs invitation generation) for precise user feedback

#### Validation

✅ Admin secret validation via test space creation  
✅ Space caching in localStorage  
✅ Invitation generation with QR codes (base64 PNG)  
✅ Copy-to-clipboard via navigator.clipboard  
✅ Styling consistent with existing UI patterns  
✅ TypeScript compliance with erasableSyntaxOnly  
✅ Integration tests written (16 new tests, all 64 passing)

#### Consequences

**Positive:**
- Clean separation between API client and UI component
- localStorage provides zero-setup persistence
- Per-space state keeps UI responsive and isolated
- Comprehensive error handling with specific messages
- Styling consistent across admin, join, and space-view features

**Negative:**
- Space cache is session-local, not shared across browsers/devices
- Test space creation for auth validation is a workaround (acceptable given no dedicated endpoint)

**Mitigations:**
- Document cache limitations in UI (future)
- If GET /spaces endpoint is added, replace localStorage cache with API calls
# Wash: view-card light DOM fix

## Context
`view-card` lives in `src/SharedSpaces.Client/src/components/view-card.ts` and extends `BaseElement`, so it renders in light DOM for Tailwind compatibility. That made its `<slot></slot>` ineffective: Lit re-rendering replaced any child content passed by `admin-view`, `join-view`, and `space-view`.

## Decision
Keep `view-card` as a custom element, but move its variable body content to a non-attribute property (`.body=${html`...`}`) instead of relying on children/slots.

## Why
- Preserves the existing component API shape (`headline`, `supporting-text`) and styling wrapper.
- Fits the project's light-DOM + Tailwind architecture without introducing shadow DOM styling issues.
- Requires only targeted consumer updates, unlike converting the card into a plain template helper everywhere.

## Follow-on rule
For any component that extends `BaseElement`, do not use slots for consumer-provided content. Use property-driven templates or helper functions for composition instead.


---

## Wash: admin auth flow rewrite (2026-03-18)

**Decision Date:** 2026-03-18  
**Decided By:** Wash (Frontend Dev)  
**Status:** Implemented in commit 2c92ca3

### Context

After Kaylee added the admin-authenticated GET /v1/spaces endpoint, the frontend admin authentication flow required redesign. The previous approach validated credentials via a test space creation side effect and persisted state in localStorage; Marek explicitly requested ephemeral auth state and server-backed space listing.

### Decision

- Validate admin access by calling GET /v1/spaces with the submitted server URL and X-Admin-Secret header.
- Treat the returned SpaceResponse[] as the initial in-memory space list.
- Do not persist the admin secret, server URL, or spaces in localStorage; refreshing the page should return the admin UI to the login form.

### Why

- Kaylee added a proper admin-authenticated listing endpoint, so we no longer need the old create-space side effect to prove credentials.
- Marek explicitly wants auth failures to stay inside the login form and successful login to land directly on the real server-backed space list.
- Ephemeral state avoids leaving admin credentials behind in the browser and matches the intended admin-only flow.

---

## Wash: PR #41 shell chrome back navigation (2026-03-18)

**Decision Date:** 2026-03-18  
**Decided By:** Wash (Frontend Dev)  
**Status:** Implemented in commit 7b8a1f5

### Context

PR #41 review feedback highlighted issues with navigation and error handling in the admin panel. One key issue: the admin view had no way to return to the join flow, potentially trapping users in a dead-end.

### Decision

Keep return navigation in the shell chrome rather than burying it inside admin-view. src/SharedSpaces.Client/src/app-shell.ts now shows a ← Back to join action whenever the current view is not 'join'.

### Why

- The shell owns top-level view switching, so back navigation belongs there.
- This keeps admin and future non-join views from trapping the user in a dead-end flow.
- It also gives us one consistent place to expose cross-view navigation as the SPA grows.

# Item Card Mobile-First Redesign

**Date:** 2026-03-19  
**Agent:** Wash (Frontend Dev)  
**Status:** Implemented

## Decision

Redesigned space-view item cards for mobile-first layout (390×844 viewport).

## Changes

### 1. Relative Time Formatting
- **Before:** Full datetime string "3/19/2026, 6:21:23 PM" (takes excessive space on mobile)
- **After:** Relative time with progressive detail:
  - `< 1 min` → "just now"
  - `< 1 hour` → "Xm ago"
  - `< 24 hours` → "Xh ago"
  - `< 7 days` → "Xd ago"
  - `≥ 7 days` → Short date "Mar 19"

### 2. Two-Row Layout
- **Before:** Single row with content on left, actions + timestamp crammed on right
- **After:** 
  - Row 1: Content (text or file, single line)
  - Row 2: Action icons + timestamp (`ml-auto`)

Prevents horizontal cramming and makes tap targets more accessible on mobile.

### 3. Text Truncation + Modal
- **Before:** Multi-line text wraps fully, can dominate card space
- **After:** 
  - Single-line truncate with ellipsis (`truncate` Tailwind class)
  - Cursor pointer + hover state signals clickability
  - Click opens modal with full text content
  - Modal: dark overlay (`bg-black/80`), centered card, click-outside-to-dismiss

### 4. Removed Extra Left Padding
- **Before:** Text nested in flex containers with gap spacing
- **After:** Direct text within card's `px-4`, flush to edge

## Implementation Pattern

### Light DOM Modal
```typescript
@state() private modalItem: SpaceItemResponse | null = null;

private handleTextClick = (item: SpaceItemResponse) => {
  this.modalItem = item;
};

private renderModal() {
  return html`
    <div class="fixed inset-0 z-50 bg-black/80" @click=${this.closeModal}>
      <div @click=${(e: Event) => e.stopPropagation()}>
        <!-- Modal content -->
      </div>
    </div>
  `;
}
```

Key: `stopPropagation()` on inner card prevents click-through to overlay's close handler.

## Files Modified
- `src/SharedSpaces.Client/src/features/space-view/space-view.ts`

## Rationale
Mobile screens (390px width) cannot afford horizontal layout density. Vertical stacking, truncation, and progressive disclosure (modal) create better UX on small screens while maintaining desktop usability.

## Future Work
- Consider adding copy button to modal for convenience
- Potential for relative time auto-refresh (update "2m ago" → "3m ago" every minute)
- Screenshot tests should validate mobile layout and modal interaction

# Space View Header Simplification

**Decision Date:** 2026-06-18
**Decided By:** Wash (Frontend Dev)
**Status:** Active

## Context
Issue #50 requested removing the duplicate space name from the space view. The name was shown both in the pill bar (app-shell nav) and as a heading inside the space view body.

## Decision
Removed the "Space" label and space name `<h2>` from `renderHeader()` in space-view.ts. The connection status badge is now the only element rendered by `renderHeader()`. The `spaceInfo` state property and `SpaceDetailsResponse` import were removed as unused after this change. The `getSpaceInfo()` API call is kept (validates token/access on load).

## Impact
- The pill bar in app-shell.ts is now the single source of truth for which space is active
- Space view gains ~60px of vertical space on mobile
- `getSpaceInfo()` still fires to validate membership; future features needing space metadata should re-add state if needed

# Connection Status Moved to Nav Pill Dots

**Decision Date:** 2026-03-20
**Decided By:** Wash (Frontend Dev)
**Status:** Active

## Context

The space-view header previously rendered a separate "Connected"/"Reconnecting"/"Disconnected" pill. This took up vertical space and was only visible when viewing a specific space.

## Decision

Replaced the separate status pill with a small colored **dot inside each space navigation pill** in `app-shell.ts`. Connection state is now visible at a glance for all spaces simultaneously.

### Event Contract

`space-view` dispatches `connection-state-change` custom event (bubbles, composed) with `{ spaceId: string, state: ConnectionState }` whenever its reactive `connectionState` property changes. `app-shell` listens on `<main>` and stores state in `Record<string, ConnectionState>`.

### Dot Color Semantics

| Color | Class | Meaning |
|-------|-------|---------|
| Gray | `bg-slate-500` | Space exists, no connection state yet |
| Green | `bg-emerald-400` | SignalR connected |
| Orange | `bg-amber-400` | Reconnecting |
| Red | `bg-red-400` | Disconnected / error |

### Key Files

- `src/SharedSpaces.Client/src/app-shell.ts` — dot rendering, state tracking
- `src/SharedSpaces.Client/src/features/space-view/space-view.ts` — event emission, renderHeader removed

## Impact

- **Zoe:** Tests referencing `renderHeader()` or the old status pill text ("Connected", "Disconnected") will need updating.
- **All:** The `connection-state-change` event is now part of the space-view → app-shell contract.


# Connection Cleanup Test Strategy

