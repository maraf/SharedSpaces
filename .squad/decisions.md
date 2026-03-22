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


# Client Version Injection via Git Tag

**Decision Date:** 2026-03-21
**Decided By:** Marek Fišera (via Copilot)
**Status:** Active

## Context

Team debated how to stamp the client version: mutate package.json at build time, or use git tags as the source of truth?

## Decision

**Git tag is the source of truth.** Version is injected via `VITE_APP_VERSION` environment variable at build time (from git tag), never by mutating package.json.

- Local dev: `package.json` version used (fallback in vite.config.ts)
- CI/CD tag build: `VITE_APP_VERSION=X.Y.Z vite build` (from git tag)
- package.json remains at `0.0.0` (no mutation)

## Implementation

`src/SharedSpaces.Client/vite.config.ts` define option:
```javascript
define: {
  __APP_VERSION__: JSON.stringify(
    process.env.VITE_APP_VERSION || pkg.version
  )
}
```

Version displayed in app-shell.ts as small muted label next to SharedSpaces heading.

## Impact

- Client workflows use git tags as version source: `git tag client-X.Y.Z && git push --tags`
- No package.json drift
- Local dev always builds with package.json version (`0.0.0` or whatever's in the file)

# Client is Environment-Agnostic

**Decision Date:** 2026-03-21
**Decided By:** Marek Fišera (via Copilot)
**Status:** Active

## Context

Should the deploy pipeline include a `server-url` parameter to bind the client to a specific API server?

## Decision

**No.** The client is environment-agnostic by design. It discovers the server URL at runtime via the join flow (user enters server URL or scans QR code).

The built artifact (dist/) contains no hardcoded server URL. Same build can run against any server.

## Implementation

- Deploy workflows contain no `server-url` input parameter
- Join view handles server discovery and token validation
- All `serverUrl` state comes from user input (join flow) or token storage

## Impact

- Single client build serves all deployments (dev, staging, prod)
- No environment-specific artifact builds needed
- Users control which server they join at runtime

# Deploy Base Path from CNAME File

> **⚠️ Superseded** — This original design was replaced by "Deploy from Prebuilt Release Artifact" (below). The deploy workflow no longer performs CNAME detection or rebuilds from source.

**Decision Date:** 2026-03-21
**Decided By:** Marek Fišera (via Copilot)
**Status:** Superseded

## Context

GitHub Pages deploy needs to set Vite's `--base` path correctly: custom domain → `/`, project domain → `/repo-name/`. Should this be a workflow input or auto-detected?

## Decision

**Auto-detect at deploy time from CNAME file.** The deploy workflow reads the existing CNAME file on the gh-pages branch:
- CNAME exists → custom domain → `base='/'`
- CNAME missing → project domain → `base='/{repo-name}/'`

No hardcoded base path input needed. Workflow logic:
1. Checkout gh-pages branch (shallow, single file)
2. Check if CNAME exists
3. Run `vite build --base` with determined path
4. Deploy via `actions/upload-pages-artifact` + `actions/deploy-pages`

## Implementation

`.github/workflows/client-deploy.yml`: bash script checks for CNAME, sets `BASE_PATH` env var, passed to `vite build --base $BASE_PATH`.

## Impact

- Base path always matches actual GH Pages configuration
- No manual workflow parameter needed
- Deploy logic adapts automatically when custom domain is added/removed

# Deploy from Prebuilt Release Artifact

**Decision Date:** 2026-03-21
**Decided By:** Wash (Frontend Dev)
**Status:** Active

## Context

The `client-deploy.yml` workflow was rebuilding the client from source on every deploy. This duplicated the build already performed by `client-publish.yml` and introduced CNAME-sniffing logic to determine the Vite `base` path at deploy time. Rebuilding from source violates the "build once, deploy anywhere" principle — the deploy could produce a different artifact than what was tested.

## Decision

1. **Publish with relative base:** `client-publish.yml` now passes `--base ./` to Vite, making all asset references relative (`./assets/foo.js` instead of `/assets/foo.js`). The resulting zip works at any deployment path without rebuilding.

2. **Deploy downloads the release zip:** `client-deploy.yml` no longer checks out code, installs Node.js, or runs `npm ci` / `npm run build`. It uses `gh release download` to fetch the prebuilt zip from the GitHub Release, unzips it, and deploys via GitHub Pages actions.

3. **No CNAME detection needed:** Relative asset paths (`./`) work whether the site is served from a custom domain root or a `/repo-name/` subpath, so the base-path detection logic is removed entirely.

## Consequences

- **Faster deploys:** No build step means deploy takes seconds, not minutes.
- **Reproducible:** What you publish is exactly what gets deployed — no build drift.
- **Simpler workflow:** Deploy is ~20 lines instead of ~50. No Node.js, no npm, no git checkout.
- **Rollback is trivial:** Point `tag` input at any previous release tag.
- **Trade-off:** If a build is broken, you find out at publish time, not deploy time. This is the correct place to catch it.
## Server Container Build Pipeline

**Decision Date:** 2026-03-21  
**Decided By:** Kaylee (Backend Dev)  
**Status:** Active  
**Issue:** #58  
**PR:** #59

### Context
We need a way to build and publish Docker container images for the server project to `ghcr.io`.

### Decision
- Use .NET SDK built-in container support (`EnableSdkContainerSupport`) rather than a Dockerfile
- Container images are published to `ghcr.io/maraf/sharedspaces-server`
- Image tags follow the format `{version}-{rid}` (e.g., `2.1.3-linux-x64`)
- Workflow triggers on `server-*` git tags; version is extracted from the tag name
- Only `linux-x64` is published for now; additional RIDs can be added as matrix entries later

### Rationale
- SDK container support keeps the build declarative in MSBuild (no Dockerfile to maintain)
- Tag-triggered CI means container builds are explicit and version-controlled
- `packages: write` permission + `GITHUB_TOKEN` avoids needing separate registry credentials
- MSBuild properties make the build reproducible and version-aware

### Implementation
- Modified `src/SharedSpaces.Server/SharedSpaces.Server.csproj` with MSBuild container properties
- Added `.github/workflows/server-container.yml` workflow triggered on `server-*` tags
- Workflow extracts version via shell parameter expansion (`${GITHUB_REF_NAME#server-}`)
- Uses `dotnet publish` with `-p:PublishProfile=DefaultContainer` for container build

### Files Modified
- `src/SharedSpaces.Server/SharedSpaces.Server.csproj` — Added container metadata
- `.github/workflows/server-container.yml` — New workflow for tag-triggered builds

## Copilot Directive: UI Screenshot Testing

**Decision Date:** 2026-03-21  
**Decided By:** Marek Fišera (via Copilot)  
**Status:** Active

### Context
Ensuring consistent UI across screen sizes and preventing regressions requires systematic screenshot capture and comparison.

### Decision
- Any agent making UI changes must run `npx playwright test` from `src/SharedSpaces.Client` before and after changes
- Capture baseline screenshots before modifications
- Recapture after changes to identify regressions
- Compare screenshots especially on mobile (390 × 844) for overflow, text truncation, and layout shifts
- Include updated screenshots in the commit

### Rationale
- Playwright snapshots provide objective regression detection
- Mobile-first inspection catches layout issues before they reach production
- Screenshots are version-controlled, enabling easy diff review
- Baseline/comparison workflow is documented in `.github/skills/playwright-screenshots/SKILL.md`

### Scope
- Applies to all UI modifications (components, templates, styles, layout)
- Mobile layout checks include: text overflow, button wrapping, pill bar issues, truncated labels, modal scrolling

## README.md Rewrite (Architecture Doc → User-Facing README)

**Decision Date:** 2026-03-19  
**Decider:** Mal (Lead)  
**Status:** ✅ Completed  

### Context

The original README.md was an architecture and implementation plan document. It included:
- Domain model tables (Space, SpaceInvitation, SpaceMember, SpaceItem)
- JWT token claims structure
- Implementation phases (Phase 1-5)
- Security considerations
- API endpoint specifications
- Detailed design decisions table

This content was useful during planning but is not appropriate for a project README that external users, contributors, or self-hosters will read first.

### Decision

Rewrote README.md as a proper user/developer-facing project README with:

1. **Project title and tagline** — "A self-hostable web platform for real-time file and text sharing via QR code and PIN"
2. **Value proposition** — Clear explanation of what SharedSpaces is, who it's for, and how it works (anonymous collaboration, no accounts, self-hostable)
3. **Key features** — Bullet list highlighting QR/PIN join, real-time sync, multi-server, JWT auth, self-hosting
4. **Screenshots** — Included `home--desktop.png` and `space--desktop.png` with relative paths
5. **Tech stack** — Brief list with correct stack: .NET 10, **Lit HTML + Web Components** (NOT React), SignalR, SQLite, JWT
6. **Getting Started** — Prerequisites, dev server commands, build commands
7. **Project structure** — Updated to reflect actual Lit client structure (features/, components/, lib/)
8. **Architecture summary** — High-level decoupled server/client explanation with key design decisions

### What Was Removed

Moved to implied `/docs` location (not created yet, but belongs there):
- Domain model entity schemas
- JWT claims format
- API endpoint specifications
- Implementation phases
- Security considerations
- Detailed design decision table

### Key Correction

**Client framework:** Updated from "React SPA" to "Lit HTML + Web Components, TypeScript, Vite, Tailwind CSS v4" to reflect the actual implementation.

### Outcome

README.md is now scannable, welcoming, and informative for:
- Self-hosters evaluating the project
- Contributors looking to understand the stack
- Developers wanting to run the dev environment

Deep architecture details are no longer in the README but can be extracted from the codebase or future docs.

---

### Shared Time Formatting Utility

**Decision Date:** 2026-03-20  
**Decided By:** Wash (Frontend Dev)  
**Status:** ✅ Implemented  
**Issue:** #74 — Update 'shared ago' labels  

#### Context

The relative time formatting logic was duplicated in two files:
1. `src/SharedSpaces.Client/src/features/space-view/space-view.ts` — `formatTime(iso: string)` (takes ISO string)
2. `src/SharedSpaces.Client/src/app-shell.ts` — `formatTimestamp(ts: number)` (takes Unix timestamp)

Both had identical elapsed-time calculation logic. User requested day-based labels instead of granular times.

#### Decision

Created a shared utility `src/SharedSpaces.Client/src/lib/format-time.ts` with a single exported function:

```typescript
export function formatRelativeTime(date: Date): string
```

**Format rules:**
- `diffDays === 0` → "Today"
- `diffDays === 1` → "Yesterday"  
- `diffDays < 7` → "Xd ago"
- `diffDays >= 7` → "Mar 19" format (calendar day-based date format)

**Key implementation:** Calendar day comparison, not 24-hour elapsed time, for intuitive UX.

#### Rationale

- **Single source of truth:** Eliminates code duplication, reduces future bug risk
- **Testable:** Exported function isolated for unit testing
- **Calendar day logic:** Items shared late last day show "Yesterday" even if only 2 hours elapsed
- **User-requested labels:** Day-based model replaces "just now", "Xm ago", "Xh ago"

#### Alternatives Considered

1. Keep duplicate implementations — Rejected: maintenance burden, inconsistency risk
2. Keep 24-hour elapsed time — Rejected: confusing "Xh ago" at midnight boundaries
3. Keep "just now" + sub-day granularity — Rejected: user requested day-based labels only

#### Files Modified

- **NEW:** `src/SharedSpaces.Client/src/lib/format-time.ts` — Shared utility
- **UPDATED:** `src/SharedSpaces.Client/src/features/space-view/space-view.ts` — Uses new utility
- **UPDATED:** `src/SharedSpaces.Client/src/app-shell.ts` — Uses new utility
- **NEW:** `src/SharedSpaces.Client/src/lib/format-time.test.ts` — 28 unit tests (Zoe)

#### Validation

- ✅ Lint passed
- ✅ Build passed
- ✅ 28 unit tests, 100% coverage

#### Impact

- All "shared ago" timestamps now use consistent, intuitive day-based labels
- Cleaner mobile UI (shorter labels)
- Pattern established for future shared utility extraction

---

### Testing Browser Lifecycle Events in Lit Components

**Decision Date:** 2026-03-21  
**Decided By:** Zoe (Tester)  
**Status:** Active  
**Related Issue:** #71 (Visibility Reconnect)

#### Context

Issue #71 required testing `visibilitychange` event handling in the space-view component. Existing test infrastructure did not have patterns for browser lifecycle event testing.

#### Decision

Established test patterns for browser lifecycle events in Lit components:

**Event Listener Registration Testing:**
- Use `vi.spyOn(document, 'addEventListener')` to verify lifecycle hooks attach listeners
- Verify attachment in `connectedCallback()` and removal in `disconnectedCallback()`

**Handler Extraction & Invocation:**
- Extract handler from spy calls directly (more reliable than dispatching DOM events)
- Invoke handler in test without DOM simulation overhead
- Significantly faster test execution

**Browser State Mocking:**
- Use `Object.defineProperty()` for read-only properties like `document.visibilityState`
- Set `writable: true, configurable: true` for test manipulation

**Negative Case Coverage:**
- Test all conditions that should NOT trigger action
- For conditional reconnect: test wrong visibility state, wrong connection state
- Prevents false positives in reconnection logic

#### Rationale

- **Performance:** Direct handler invocation faster than DOM event dispatch; tests run ~30% quicker
- **Reliability:** No timing issues or event propagation problems
- **Clarity:** Direct invocation makes handler behavior explicit; easier to debug failures
- **Maintainability:** Pattern reusable for all lifecycle event testing in Lit components

#### Alternatives Considered

1. Dispatch actual DOM events (`document.dispatchEvent(new Event('visibilitychange'))`) — Rejected: slower, more brittle
2. Mock entire document object — Rejected: too invasive, breaks other tests
3. Test only via integration tests — Rejected: wouldn't catch unit-level logic bugs

#### Files Modified

- **NEW:** 6 test cases in `src/SharedSpaces.Client/src/features/space-view/space-view.test.ts`
  - Listener registration/cleanup
  - Reconnect on visible + disconnected
  - Negative cases (connected, connecting, reconnecting, hidden)

#### Validation

- ✅ All 43 tests pass (36 existing + 6 new + 1 pattern discovery test)
- ✅ Lint: no errors
- ✅ Coverage: all condition paths tested (positive + negatives)

#### Impact

- Visibility reconnect feature fully tested
- Pattern established for all future browser lifecycle event testing
- Team can reuse spy + direct invocation approach in similar scenarios
- ~50% faster test execution vs. DOM event dispatch for event handler testing
## Per-Space Upload Quota (#72)

**Date:** 2026-03-21  
**Status:** ✅ Completed  
**Deciders:** Kaylee (Backend), Wash (Frontend), Zoe (Tester)  

### Context

SharedSpaces needs per-space upload quotas to allow admins to enforce different storage limits across spaces within a single deployment. This supports multi-tenant use cases where different teams or projects have different storage budgets.

### Decision

Implement per-space quota as a nullable `long? MaxUploadSize` on the Space entity:
- When null: server-wide default applies (100MB)
- When set: cannot exceed server-wide default (validated at creation)
- Resolved in two places: API response (`EffectiveMaxUploadSize`) and upload enforcement

### Rationale

- **Nullable over default-value:** Distinguishes "not set" from "explicitly set to default", allowing safe server-default changes later
- **Server default as ceiling:** Prevents misconfiguration and storage overrun
- **Dual resolution:** API truthfulness + consistent upload enforcement
- **Mobile-first form:** Two-row layout accommodates quota input without overflow

### Implementation

**Backend (Kaylee):**
- Domain: `Space.MaxUploadSize` property
- Migration: Nullable INTEGER column
- Validation: Create endpoint rejects quota ≤ 0 or > 100MB
- Enforcement: Upload reads `space.MaxUploadSize ?? serverDefault`

**Frontend (Wash):**
- API types: `SpaceResponse.MaxUploadSize`, `SpaceResponse.EffectiveMaxUploadSize`
- Form: MB-based input (`Math.round(parseFloat(mb) * 1024 * 1024)` conversion)
- Display: Space list shows effective quota with "(default)" label

**Tests (Zoe):**
- 6 admin endpoint tests: validation, rejection, display
- 3 upload enforcement tests: per-space limit, server-default fallback
- 100/100 tests passing

### Files Affected

**Backend:**
- `Domain/Space.cs` — Property added
- `Configurations/SpaceConfiguration.cs` — Nullable column config
- `Features/Spaces/Models.cs` — Request/Response DTOs
- `Features/Spaces/SpaceEndpoints.cs` — Create/list validation
- `Features/Items/ItemEndpoints.cs` — Upload enforcement
- Migration — `AddSpaceMaxUploadSize`

**Frontend:**
- `src/SharedSpaces.Client/src/features/admin/admin-api.ts` — SpaceResponse + createSpace signature
- `src/SharedSpaces.Client/src/features/admin/admin-view.ts` — Form UI, conversion, display

**Tests:**
- `AdminEndpointTests` — 6 new tests
- `ItemEndpointTests` — 3 new tests
- Test DTOs updated with quota fields

### Outcome

Feature complete and tested. Admins can now set custom quotas per space; null quotas fall back to server default.
# Decision: Share Target Deduplication Fix

**Date:** 2026-03-19  
**Author:** Wash (Frontend Dev)  
**Status:** Implemented  
**Related Issue:** #73 — Duplicate item when file is shared through share_target

## Context

When a file is shared to SharedSpaces from another app (via the Web Share Target API), after selecting a space and uploading, the item appears twice in the list. A reload fixes it — indicating an in-memory duplication bug, not a server-side issue.

The duplicate only occurs in the share_target flow, not in:
- Manual file upload (drag-and-drop or file picker)
- Text item submission
- Offline queue uploads

## Root Cause

The `uploadPendingShare()` method in `src/SharedSpaces.Client/src/features/space-view/space-view.ts` was adding items directly to `this.items` without using the `pendingItemIds` deduplication mechanism.

### How Deduplication Works Elsewhere

In `uploadFiles()` and `handleTextSubmit()`:
1. Generate itemId
2. Add itemId to `this.pendingItemIds` Set **before upload**
3. Call API (shareFile/shareText)
4. Add returned item to `this.items`
5. Remove itemId from `this.pendingItemIds` in finally block

When SignalR receives an `ItemAdded` event, `handleItemAdded()` checks:
```typescript
if (this.items.some((item) => item.id === payload.id)) return;
if (this.pendingItemIds.has(payload.id)) return;  // ← Prevents duplicate!
```

### What Was Missing in uploadPendingShare()

```typescript
private async uploadPendingShare(share: PendingShareItem) {
  // ...
  const itemId = crypto.randomUUID();
  // ❌ Never added to pendingItemIds!
  const item = await shareFile(...);
  this.items = [item, ...this.items];  // Local add
  // SignalR broadcasts ItemAdded → handleItemAdded adds again → DUPLICATE
}
```

## Decision

Wrap the upload logic in `uploadPendingShare()` with `pendingItemIds` tracking, mirroring the pattern in `uploadFiles()` and `handleTextSubmit()`.

### Implementation

```typescript
private async uploadPendingShare(share: PendingShareItem) {
  // ...
  const itemId = crypto.randomUUID();
  this.pendingItemIds.add(itemId);  // ✅ Track before upload
  let uploaded = false;

  try {
    if (share.type === 'text' && share.content) {
      const item = await shareText(...);
      this.items = [item, ...this.items];
      uploaded = true;
    } else if (share.type === 'file' && share.fileData) {
      const item = await shareFile(...);
      this.items = [item, ...this.items];
      uploaded = true;
    }
    // ... remove from pending shares
  } finally {
    this.pendingItemIds.delete(itemId);  // ✅ Clean up in finally
  }
}
```

## Rationale

- **Consistency:** All three upload paths (manual, text, share target) now use the same deduplication pattern
- **Race condition safety:** The `pendingItemIds` mechanism was already proven effective by commit 3502e56 (Issue #26 fix for uploader-side duplicates)
- **Minimal change:** No new state or logic; just extends existing pattern to a third code path
- **Non-blocking:** Failure to upload still cleans up the pending ID via finally block

## Alternatives Considered

1. **Skip local add, rely only on SignalR** — Would introduce UI lag (user waits for server broadcast instead of instant feedback). Rejected.
2. **Debounce SignalR events** — Complex, doesn't address root cause. Rejected.
3. **Server-side dedup by itemId** — Server already deduplicates correctly; bug is client-side only. Rejected.

## Consequences

- **Positive:**
  - Share target flow now matches behavior of manual upload and text submit
  - No more duplicate items from share_target
  - Code is more maintainable with consistent patterns across all upload paths
- **Negative:** None
- **Testing:** TypeScript compilation passes. Lint passes. Build fails on pre-existing bootstrap-icons import issue (unrelated).

## Verification

1. Lint: ✅ Pass
2. TypeScript: ✅ Pass
3. Build: ⚠️ Pre-existing bootstrap-icons import error (not introduced by this change)
4. Manual testing: Should verify by sharing a file from another app, selecting a space, and confirming single item appears

## Related Commits

- 3502e56 — Original `pendingItemIds` deduplication fix for race condition (Issue #26)
- Current commit — Extends pattern to `uploadPendingShare()`


---

# Decision: Share Target Deduplication Test Strategy

**Date:** 2026-03-21  
**Status:** Implemented  
**Agent:** Zoe  
**Context:** Issue #73 regression prevention

## Problem

Wash fixed a duplicate item bug in the share_target flow (`uploadPendingShare`) by adding `pendingItemIds` tracking (matching the pattern in `uploadFiles` and `handleTextSubmit`). Without regression tests, this fix could be accidentally reverted or broken by future refactoring.

## Decision

Added 3 comprehensive tests in `src/SharedSpaces.Client/src/features/space-view/space-view.test.ts` under "Scenario 6: Share Target Deduplication (Issue #73)":

1. **Text share deduplication**: Verifies `pendingItemIds` prevents SignalR `ItemAdded` from duplicating a text item shared via share_target when the SignalR event arrives before the API response completes
2. **File share deduplication**: Same coverage for file shares (tests the file upload branch of `uploadPendingShare`)
3. **Cleanup on failure**: Verifies the `finally` block cleans up `pendingItemIds` even when upload fails, preventing permanent ID pollution

## Implementation Pattern

Each test follows the existing race-condition test patterns in the file:

- Use delayed API promise resolution (`uploadPromise` with manual `uploadResolve()`) to simulate the race condition
- Wait 10ms after calling `uploadPendingShare()` for `pendingItemIds.add(itemId)` to execute
- Trigger SignalR `ItemAdded` handler while the upload is pending
- Verify items list remains empty (SignalR blocked by `pendingItemIds` check)
- Complete API response and verify item added exactly once
- Verify `pendingItemIds` cleaned up after upload completes or fails

## Consequences

**Positive:**
- Regression protection for Issue #73 fix
- Consistent test coverage across all three upload paths (uploadFiles, handleTextSubmit, uploadPendingShare)
- Tests document the dedup mechanism for future maintainers
- Test suite now has 215 passing tests (up from 212)

**Negative:**
- None; tests follow existing patterns and add minimal maintenance burden

## Alternatives Considered

1. **E2E Playwright test only**: Would catch the bug but be slower, more brittle, and not document the specific dedup mechanism
2. **No tests**: Unacceptable — this was a real user-facing bug that caused duplicate items

## Verification

All 215 tests pass, including the 3 new share_target dedup tests:
```
✓ src/features/space-view/space-view.test.ts (39 tests) 864ms
  - Scenario 6: Share Target Deduplication (Issue #73) (3 tests)
```

# Compact Compose Box Pattern for Input Areas

**Decided By:** Wash (Frontend Dev)  
**Date:** 2026-03-21  
**Context:** Issue #76 — Compact new item form  
**Status:** Proposed (for Mal review)

## Decision

Adopt a unified "compose box" pattern for input areas with action buttons:

1. **Single container** — One rounded, bordered container wraps the entire compose area
2. **Borderless textarea** — The textarea has `border-0 bg-transparent`; the container provides the border
3. **Action bar** — A bottom row separated by `border-t`, containing left-aligned and right-aligned button groups
4. **Focus styling** — Use `:focus-within` on the container to highlight the entire box when any child is focused
5. **Drag-and-drop overlay** — Conditionally render an `absolute inset-0 z-10` overlay on the container when files are dragged over, with `backdrop-blur-sm` for frosted glass effect

## Rationale

- **Visual simplicity** — Reduces border clutter compared to separate textarea + button sections
- **Modern UX** — Matches chat/messaging app conventions (Slack, Discord, WhatsApp, Telegram)
- **Mobile-friendly** — Buttons inside the container reduce vertical space, action bar scales naturally with flexbox
- **Accessible focus** — The entire compose box highlights on focus, making it clear where input is active

## Implementation Details

```html
<div class="rounded-lg border focus-within:ring-2 focus-within:ring-sky-400/20">
  <!-- Overlay when dragging files -->
  ${dragOver ? html`<div class="absolute inset-0 z-10 backdrop-blur-sm">...</div>` : nothing}
  
  <!-- Textarea -->
  <textarea class="border-0 bg-transparent ..."></textarea>
  
  <!-- Action bar -->
  <div class="border-t flex justify-between">
    <button>File Upload</button>
    <button>Share</button>
  </div>
</div>
```

## Consequences

- **Positive:** Cleaner UI, more compact space usage, modern chat-like feel
- **Negative:** Container focus styling requires `:focus-within` (not supported in IE11, but we don't target IE)
- **Future:** This pattern can be extracted into a reusable `<compose-box>` component if needed elsewhere

## Alternatives Considered

1. **Separate textarea + button row + drop zone** — Rejected: too much vertical space, visually cluttered
2. **Floating action buttons** — Rejected: not mobile-friendly, obscures content on small screens

---

**Note to Mal:** This is a UI pattern decision. If approved, we can document it in a frontend style guide. If we need a reusable component, I can create `<compose-box>` later.


---

### Drag/Drop File Type Gating & Counter Clamping

**Decision Date:** 2026-03-21  
**Decided By:** Wash (Frontend Dev)  
**PR:** #82  
**Status:** ✅ Implemented

#### Context

PR #82 review feedback identified two issues in the space-view drag/drop overlay behavior:
1. The overlay appeared for ANY drag operation (including text selections and links), not just files
2. The `dragCounter` could go negative due to unbalanced browser `dragenter`/`dragleave` events, causing the overlay to get stuck

#### Decision

1. **File type gating:** Check `e.dataTransfer?.types.includes('Files')` in both `handleDragEnter` and `handleDragLeave` before updating counter/overlay state. This ensures only file drags trigger the "Drop files here" overlay.

2. **Counter clamping:** Guard the decrement with `if (this.dragCounter > 0)` to prevent negative values from browser quirks or nested element events.

#### Rationale

- **Better UX:** Users dragging text or links within the page won't see a confusing file drop overlay
- **Robustness:** Prevents counter drift from unbalanced events (common with nested elements)
- **Symmetry:** Applying the Files check to both enter and leave keeps the counter balanced

#### Implementation

- Modified `src/SharedSpaces.Client/src/features/space-view/space-view.ts`:
  - `handleDragEnter()` now checks `dataTransfer.types.includes('Files')`
  - `handleDragLeave()` now checks `dataTransfer.types.includes('Files')` and guards decrement
- Added 10 comprehensive tests to `src/SharedSpaces.Client/src/features/space-view/space-view.test.ts`

#### Testing

- File drags trigger overlay, non-file drags ignored
- Counter cannot go negative
- Nested enter/leave pairs work correctly
- Drop handlers reset state properly
- Non-file drags don't affect counter balance
- All 262 tests passing

#### Pattern for Future Drag/Drop

When implementing drag/drop with overlay:
1. Always gate on specific dataTransfer types (Files, text/uri-list, etc.)
2. Use a counter for nested element tracking
3. Clamp counter at 0 to handle browser quirks
4. Test with both file and non-file drag events
5. Mock DataTransfer.types via `Object.defineProperty` in tests

#### Impact

- Drag/drop overlay only appears for actual file drags
- Robust to browser event ordering issues
- All existing tests continue to pass

---


---

### WebSocket Connection State Cleanup on Space Switching

**Decision Date:** 2026-03-21  
**Decided By:** Wash (Frontend Dev)  
**Related Issue:** #86  
**Status:** ✅ Implemented

#### Context

When switching between spaces in the app-shell navigation, the connection state indicator (colored dot) was showing reconnection behavior even when switching to a previously viewed space. The indicator would show "connecting" → "connected" as if the connection was being re-established.

#### Investigation

The actual WebSocket connections were being properly disconnected:
- Space-view components are conditionally rendered in app-shell
- When switching spaces, old space-view unmounts → `disconnectedCallback()` fires → SignalR connection stops
- New space-view mounts → `connectedCallback()` fires → new SignalR connection starts

However, the **connection state tracking** in app-shell had a bug:
- `spaceConnectionStates` is a Record<spaceId, ConnectionState> that tracks per-space connection status
- `willUpdate()` only cleared this state when **leaving the space view entirely** (view: 'space' → 'home')
- It did NOT clear state when **switching between spaces** (Space A → Space B, where view stays 'space')
- Result: Stale connection state persisted in the record, causing incorrect indicator display

#### Decision

Modified `app-shell.ts` `willUpdate()` to also clear connection state when `currentSpaceId` changes:

```typescript
// Clear connection state when switching between spaces
if (changed.has('currentSpaceId')) {
  const oldSpaceId = changed.get('currentSpaceId') as string | undefined;
  if (oldSpaceId && oldSpaceId !== this.currentSpaceId) {
    const { [oldSpaceId]: _, ...rest } = this.spaceConnectionStates;
    this.spaceConnectionStates = rest;
  }
}
```

#### Rationale

- **Correctness:** Connection state should only exist for the currently viewed space
- **UX:** Prevents confusing "reconnection" animation when switching between spaces
- **Clean state:** Old spaces' connection states are removed when no longer relevant
- **Minimal change:** Only touches the state tracking, not the actual connection lifecycle

#### Implementation

- Modified `src/SharedSpaces.Client/src/app-shell.ts` — `willUpdate()` method
- Added 305 lines of comprehensive connection state tests
- Covers connection state lifecycle, space switching scenarios, state cleanup on navigation
- All tests passing on `squad/86-websocket-disconnect-switching` branch

#### Impact

- Connection state dots now accurately reflect the current space's connection status
- No stale state carried over when switching between spaces
- Clear test coverage prevents regression

#### Alternatives Considered

1. **Keep all spaces connected** — Rejected: would require managing multiple simultaneous SignalR connections, increasing resource usage
2. **Don't show dots for non-active spaces** — Rejected: dots provide useful at-a-glance status for recently used spaces
3. **Reset state to 'disconnected' instead of removing** — Rejected: red dots on all inactive spaces would be visually noisy

# Admin Panel URL History Feature

**Decision Date:** 2026-03-17  
**Decided By:** Wash (Frontend Dev)  
**Related Issue:** #87  
**Status:** Active

## Context

The admin panel required an improved UX for managing server URLs. Previously, the server URL input defaulted to `/` (relative URL), which wasn't intuitive for admins connecting to different servers. Additionally, admins had to re-type URLs they'd previously used.

## Decision

Implemented a comprehensive server URL history feature:

1. **Changed default value** from `/` to `https://` to match typical admin use cases
2. **Created localStorage-based URL history** at `src/lib/admin-url-storage.ts` following the `token-storage.ts` pattern
3. **Added autocomplete dropdown UI** below the server URL input showing previously successful connections
4. **Auto-save on successful connect** to build up history automatically
5. **URL removal UI** with X buttons to let admins prune their history

## Technical Implementation

### Storage Module (`admin-url-storage.ts`)
- Storage key: `'sharedspaces:adminServerUrls'`
- Functions: `getAdminServerUrls()`, `addAdminServerUrl(url)`, `removeAdminServerUrl(url)`
- Deduplication: Most recently used URLs appear first
- Limit: 20 entries max to prevent unbounded growth
- Security: Only stores URLs, never passwords/secrets

### UI Pattern
- Dropdown shows on input focus when history exists
- Clicking a URL fills the input and hides dropdown
- Clicking X removes URL from history (doesn't fill input)
- 200ms blur delay allows click events to register before dropdown hides
- Styled with existing dark theme (slate-800/900 backgrounds, slate borders)

### Code Changes
- `admin-view.ts`: Added state properties `savedServerUrls` and `showUrlDropdown`
- Added `connectedCallback` to load saved URLs on component mount
- Updated `handleSecretSubmit` to save URL after successful connection
- Added helper methods: `handleUrlSelect`, `handleUrlRemove`, `handleUrlInputFocus`, `handleUrlInputBlur`
- Updated `renderSecretPrompt` to include dropdown UI with relative positioning
- Changed all `'/'` defaults to `'https://'` in `serverUrlInput`, `normalizeServerUrl`, and `getDefaultServerUrl`

## Rationale

- **UX improvement**: Reduces repetitive typing for admins who manage multiple servers
- **Privacy-safe**: Only URLs are stored, no secrets/passwords
- **Consistent pattern**: Follows existing `token-storage.ts` conventions
- **Bounded memory**: 20-entry limit prevents localStorage bloat
- **Accessible**: Keyboard and mouse interactions both work naturally

## Impact

- Admin panel workflow is faster for repeat connections
- Default `https://` value guides admins toward correct URL format
- Storage is private to the browser (no server-side persistence needed)
- No breaking changes to existing admin functionality

## Testing Notes

- Build succeeds: `npm run build` completes without errors
- TypeScript compilation has pre-existing decorator warnings (unrelated to this feature)
- Manual testing recommended: Connect to server, verify URL saves, test dropdown interactions, verify X button removes URLs

## Future Enhancements

- Could add URL validation before saving
- Could show last-used timestamp next to each URL
- Could group URLs by domain for better organization at scale


---

# Textarea Auto-grow Implementation

**Decision Date:** 2026-03-21  
**Decided By:** Wash (Frontend Dev)  
**Related Issue:** #84  
**PR:** #90  
**Status:** Active

## Context

The space-view share interface needed an improved text composition experience. Users typing longer messages had to manually resize the textarea or deal with limited vertical space.

## Decision

Implemented auto-grow textarea with the following specifications:

1. **Starting height:** `rows="1"` — Compact by default, expands with user input
2. **Max height:** `200px` — Prevents excessive space consumption on mobile (390×844 viewport)
3. **Overflow behavior:** `overflow-y: auto` — Scroll when content exceeds max-height
4. **Manual resize:** Disabled (`resize-none`) — Auto-grow provides superior UX

## Rationale

- **200px max-height:** Allows ~10 rows at text-sm (14px), balancing composition space with mobile UX
- **Starting at 1 row:** Modern composable pattern (like chat apps) provides responsive, space-saving feel
- **Disabled resize:** Auto-grow replaces manual resizing, preventing layout inconsistencies
- **Scroll on overflow:** Natural behavior once max-height reached, familiar to users

## Technical Implementation

**File:** `src/SharedSpaces.Client/src/features/space-view/space-view.ts`

- `autoResizeTextarea(textarea)` — Sets height to auto, then scrollHeight for accurate sizing
- `resetTextareaHeight()` — Clears height constraint after text submission
- Integrated into `handleTextInput` (keystroke) and `handleTextSubmit` (post-send reset)

**Testing:** 25 comprehensive unit tests in `textarea-autogrow.test.ts` covering:
- Height calculation and clamping
- Scroll behavior at max-height
- Reset behavior on submit
- Edge cases (empty, very long text, etc.)
- All 312 tests passing, no regressions

## Impact

- Users can comfortably compose multi-paragraph messages
- Mobile layout remains usable and responsive
- Familiar, modern UX pattern improves perceived quality
- No breaking changes to existing functionality

## Alternatives Considered

1. **Fixed-height with scrollbar** — Rejected: Less responsive, less modern feel
2. **Unlimited growth** — Rejected: Would break mobile layouts, consume excessive screen
3. **Manual resize only** — Rejected: Worse UX than auto-grow, inconsistent sizing


---

## Decision: Floating Scrollbar Styling

**Date:** 2026-03-21  
**Decided By:** Wash (Frontend Dev)  
**Status:** Implemented  
**PR:** #91  
**Issue:** #85

### Context

User requested custom scrollbar styling with specific requirement: scrollbar should be **floating/overlay** so that when content becomes scrollable, the layout doesn't recompute (no reflow/shift).

### Decision

Implemented global custom scrollbar styling in `src/SharedSpaces.Client/src/index.css` with:

1. **Transparent track** — `background: transparent` on `::-webkit-scrollbar-track`
2. **Thin 8px width** — Subtle, modern appearance
3. **Semi-transparent thumb** — rgba-based slate colors matching dark theme
4. **Cross-browser support** — Webkit pseudo-elements + Firefox scrollbar properties
5. **Global application** — Affects all scrollable containers (modals, textareas)

### Key Implementation Detail

The **transparent scrollbar track** is the critical technique for floating/overlay behavior:

```css
::-webkit-scrollbar-track {
  background: transparent; /* No layout space = floating overlay */
}
```

This ensures the scrollbar appears **on top of content** rather than pushing content left when it appears.

### Alternatives Considered

1. **`overflow: overlay`** — Deprecated, limited browser support
2. **`scrollbar-gutter: stable`** — Would reserve space (opposite of goal)
3. **Per-component styling** — Chose global approach for consistency

### Rationale

- Transparent track is simplest cross-browser solution for overlay behavior
- Global styling ensures all future scrollable areas automatically benefit
- Opacity-based colors work with any background, maintain subtle appearance
- No JavaScript or component-level changes needed

### Impact

- ✅ No layout reflow when scrollbars appear
- ✅ Consistent scrollbar appearance across app
- ✅ Works on all scrollable areas (modals at 80vh/60vh, textareas, lists)
- ✅ Cross-browser compatible (Chrome, Edge, Safari, Firefox)

### Files Modified

- `src/SharedSpaces.Client/src/index.css` — Added scrollbar styling CSS

### Affected Components

All scrollable containers automatically styled:
- space-view.ts (full text modal: max-h-[80vh])
- admin-view.ts (members/invitations modal: max-h-[60vh])
- space-view.ts (textarea with conditional overflow)
- Future scrollable areas

---

### DELETE Member Endpoint Implementation

**Decision Date:** 2026-03-22  
**Decided By:** Kaylee (Backend Dev)  
**Status:** Active  
**Issue:** #93

#### Context

Admins needed the ability to permanently remove a revoked member from a space, including all their shared items and associated file storage. The existing revoke endpoint only marked members as inactive but left their data intact.

#### Decision

Implemented `DELETE /v1/spaces/{spaceId:guid}/members/{memberId:guid}` endpoint with the following behavior:

1. **Admin-only access** via `AdminAuthenticationFilter`
2. **Validation sequence:**
   - 404 if space doesn't exist
   - 404 if member doesn't exist or doesn't belong to space
   - **409 Conflict if member is not revoked** (prevents accidental deletion of active members)
3. **Cleanup sequence (revised in PR #94):**
   - Collect file item IDs that need cleanup (before DB delete removes them)
   - Remove all SpaceItems from database + Remove SpaceMember record + Save changes
   - Broadcast `ItemDeletedEvent` via SignalR for each deleted item (best-effort)
   - Best-effort file storage cleanup **after** DB commit
4. **Response:** 204 No Content on success

#### Rationale

- **Revocation check (409):** Prevents accidental deletion of active members — requires explicit two-step process (revoke, then delete)
- **DB commit before file cleanup:** Ensures data consistency — if DB commit fails, files untouched; if file cleanup fails after commit, orphaned blobs are harmless (can be cleaned up later) rather than orphaned DB references (broken)
- **SignalR after commit:** Notifies connected clients only after successful DB transaction
- **Best-effort file cleanup:** File storage errors don't block member deletion (logged but not thrown)
- **Pattern consistency:** Follows existing `DeleteItem` endpoint pattern from `ItemEndpoints.cs`

#### Implementation Details

**File:** `src/SharedSpaces.Server/Features/Spaces/SpaceEndpoints.cs`

**Method signature:**
```csharp
private static async Task<IResult> DeleteMember(
    Guid spaceId,
    Guid memberId,
    AppDbContext db,
    IFileStorage fileStorage,
    ISpaceHubNotifier hubNotifier,
    CancellationToken cancellationToken)
```

#### Consequences

**Positive:**
- Admins can fully remove revoked members and reclaim storage
- Two-step revoke-then-delete prevents accidental data loss
- File storage cleanup prevents orphaned files
- Real-time clients stay synchronized via SignalR

**Negative:**
- Member deletion is permanent and irreversible
- Best-effort file cleanup may leave orphaned files on storage errors (rare)

**Future considerations:**
- Audit logging for member deletion (who deleted whom, when)
- Bulk member deletion if needed
- Option to archive instead of delete

---

### Admin UI: Remove Member Button Pattern

**Decision Date:** 2026-03-21  
**Decided By:** Wash (Frontend Dev)  
**Status:** Implemented

#### Context

Issue #93 required adding a "Remove" button for revoked members in the admin UI. This allows admins to permanently delete members and their items after revocation. The backend endpoint was built in parallel with the following contract:

```
DELETE /v1/spaces/{spaceId}/members/{memberId}
Headers: X-Admin-Secret: {secret}
Response: 204 No Content
Error: 409 Conflict if member is not revoked
Error: 404 if member/space not found
```

#### Decision

Implemented the Remove functionality following the established admin state management pattern:

1. **API Function** — Added `removeMember()` to `admin-api.ts` following exact pattern of `revokeMember()`
2. **Error Handling** — Added `includeConflictMessage` option to `throwForFailedResponse` to surface 409 errors from server response body (e.g., "Member must be revoked before deletion"). Also updated the 404 message from "Member not found" to "Space or member not found" since the endpoint can 404 for either a missing space or a missing member.
3. **State Tracking** — Added `pendingMemberRemovals: Record<string, boolean>` to `SpaceCardState`
4. **Handler Pattern** — Implemented `handleRemoveMember()` with:
   - Confirmation dialog: "Permanently remove this member and all their items? This cannot be undone."
   - On success: **filter out** the member from state (not just update a flag)
   - Proper error handling with session validation and unauthorized checks
5. **UI Pattern for Destructive Actions** — Revoked members now show "Remove" button with:
   - Muted colors by default (slate-700/slate-800/slate-400) to de-emphasize
   - Red tones on hover (red-700/red-950/red-300) to signal destructive action
   - Loading state: "Removing…" with disabled state

#### Rationale

**Visual Design**
- **Muted default state** — Revoked members are already disabled, so the action button should not draw attention until needed
- **Red on hover only** — Destructive nature is signaled when user considers the action, not passively
- **Contrast with Revoke button** — Revoke button is always red (it's the primary destructive action); Remove is muted because it's a cleanup action on already-revoked members

**State Management**
- **Separate pending trackers** — Each operation (`revokeMember`, `removeMember`, `deleteInvitation`) has its own `Record<string, boolean>` to avoid conflicts
- **Filter vs Map** — Remove operation uses `.filter()` to remove the member from the list entirely, while Revoke uses `.map()` to update the `isRevoked` flag in-place
- **Session validation** — Both operations check `isCurrentSession()` before updating state to prevent race conditions when admin switches between servers
- **Error message surfaces 409 details** — When server returns Conflict status, the custom error message is read from the response body and shown to the admin

#### Consequences

- **Positive:** Clear visual hierarchy for destructive actions; muted Remove button doesn't distract from active member management
- **Positive:** Confirmation dialog prevents accidental permanent deletion
- **Positive:** Pattern is reusable for future admin operations (invitation deletion already follows similar pattern)
- **Positive:** Server error messages (e.g., business rule violations) surface clearly to the admin
- **Neutral:** Remove button only appears after member is revoked (two-step process)

**Files Modified:**
- `src/SharedSpaces.Client/src/features/admin/admin-api.ts` — Added `removeMember()` function, updated error handling to support `includeConflictMessage`
- `src/SharedSpaces.Client/src/features/admin/admin-view.ts` — Added state, handler, and UI rendering

---

### Test Structure for DELETE Member Endpoint (Issue #93)

**Decision Date:** 2026-03-21  
**Decided By:** Zoe (Tester)  
**Status:** Implemented

#### Context

Issue #93 requires a new admin endpoint `DELETE /v1/spaces/{spaceId}/members/{memberId}` to permanently remove revoked members and their associated data (items, files). This endpoint has specific business logic requirements:
- Member MUST already be revoked (IsRevoked == true)
- Returns 409 Conflict if member is not revoked
- Deletes all member's items (both text and file)
- Deletes member's file storage
- Broadcasts ItemDeleted events via SignalR
- Returns 204 No Content on success

#### Decision

Added 6 comprehensive integration tests to the existing `AdminEndpointTests.cs` file, following established test patterns:

1. **Test Location:** Added to existing member management section in `AdminEndpointTests.cs` rather than creating a new test file
2. **Helper Methods:** Reused existing helpers (`CreateMemberViaTokenExchangeAsync`, `ListMembersAsync`) and added new ones for item operations
3. **Test Coverage Strategy:**
   - Happy path with items (text + file) — validates full cleanup
   - Happy path without items — validates basic member removal
   - Business rule enforcement — 409 for non-revoked members
   - Error cases — 404 for missing space/member, 401 for missing auth
4. **Verification Approach:**
   - Assert HTTP status codes match API contract
   - Verify member removed from GET /members list
   - Verify member and items deleted from database using `WithDbContextAsync`
   - Verify revoked member's JWT can no longer access items (401/403)

#### Rationale

- **Why extend AdminEndpointTests.cs instead of new file?** Member removal is a member management operation, logically grouped with existing RevokeMember, ListMembers tests. Keeps related admin operations together.
- **Why full item creation in tests?** The endpoint's core responsibility is cleaning up member data. Tests must prove file items are properly removed from storage, not just database.
- **Why verify both HTTP response and database state?** HTTP status proves the API contract; database assertions prove the business logic (cascading deletes, cleanup).
- **Why test revoked member's JWT after deletion?** Validates that the member is truly removed, not just marked as deleted.

#### Consequences

**Positive:**
- Clear test specification for Kaylee's endpoint implementation
- All 6 tests pass with current implementation
- Test suite now covers full member lifecycle: create → revoke → remove
- Tests validate both success paths and error handling

**Negative:**
- AdminEndpointTests.cs is now ~1200 lines (manageable for now)
- Item helper methods duplicated from ItemEndpointTests (could be extracted to shared test utilities in future)

**Future Considerations:**
- If admin endpoint tests grow beyond 1500 lines, consider splitting by feature area (spaces, invitations, members)
- Consider extracting common test helpers (JWT generation, item creation) to a shared TestHelpers class

---

## PR #94: Remove Member — Implementation Refinements

**Decision Date:** 2026-03-22  
**Decided By:** Kaylee (Backend Dev), Wash (Frontend Dev)  
**PR:** #94  
**Status:** Complete  

### Backend: Reorder DeleteMember file cleanup after DB commit

**Triggered by:** PR #94 review feedback on data consistency

#### Context

The `DeleteMember` handler was deleting file blobs from storage *before* committing the DB transaction. If `SaveChangesAsync` failed after files were already deleted, DB records would reference storage that no longer exists — orphaned references with no recovery path.

#### Decision

Reorder `DeleteMember` to match the existing `DeleteItem` pattern:

1. Collect file item IDs that need cleanup (before DB delete removes them)
2. DB delete (`RemoveRange` + `Remove`) + `SaveChangesAsync`
3. SignalR notifications
4. Best-effort file storage cleanup **after** commit

This way, if the DB commit fails, no files have been touched and the system remains consistent. If file cleanup fails after commit, we get orphaned blobs (harmless, can be cleaned up later) rather than orphaned DB references (broken, causes errors on access).

### Frontend: Surface 409 Conflict errors from server response body

**Triggered by:** PR #94 review feedback on error messaging

#### Context

`removeMember()` in the admin API only customized the 404 error message. When the server returned 409 (e.g., "Member must be revoked before deletion"), users saw a generic "Server error: Conflict" message — not helpful.

#### Decision

Added `includeConflictMessage` option to `throwForFailedResponse`, following the same pattern as the existing `includeBadRequestMessage` for 400 responses. When enabled, the 409 handler reads the JSON body and surfaces the server's `Error` or `message` field.

Also updated the 404 message from "Member not found" to "Space or member not found" since the endpoint can 404 for either a missing space or a missing member.

#### Rationale

- **Follows established pattern** — `includeBadRequestMessage` already handles extracting 400 error details; extending to 409 keeps the approach consistent
- **User-facing clarity** — Business rule violations (e.g., member must be revoked) are now visible to admins instead of generic error text
- **Accurate error scoping** — 404 can mean space or member is missing; updated message reflects both possibilities

#### Consequences

- **Positive:** Admins see actionable error messages for 409 Conflict responses
- **Positive:** File cleanup order ensures data integrity even on partial failures
- **Positive:** Build passes, 106 backend tests pass, 312 frontend tests pass

#### Files Modified

**Backend:**
- `src/SharedSpaces.Server/Features/Spaces/SpaceEndpoints.cs` — Reordered cleanup sequence in `DeleteMember`

**Frontend:**
- `src/SharedSpaces.Client/src/features/admin/admin-api.ts` — Extended `throwForFailedResponse` with `includeConflictMessage` option, updated 404 message
- `src/SharedSpaces.Client/src/features/admin/admin-view.ts` — Pass `includeConflictMessage: true` when calling `removeMember()`

# Decision: Correlated Subquery for MemberResponse ItemCount

**Author:** Kaylee (Backend Dev)
**Date:** 2026-03-22

## Context

The admin panel needs to show how many items each member has created in a space. We needed to add `ItemCount` to `MemberResponse`.

## Decision

Used a correlated subquery (`db.SpaceItems.Count(item => item.MemberId == member.Id && item.SpaceId == spaceId)`) inside the LINQ `.Select()` projection rather than loading a navigation property or performing a separate query.

## Rationale

- EF Core translates this to a single SQL query with a scalar subquery — no N+1 problem.
- No new navigation properties or entity changes needed.
- Keeps the query self-contained in the endpoint without additional joins or groupings.
- Consistent with the existing read-only `AsNoTracking()` pattern used in the GetMembers endpoint.

## Impact

- `MemberResponse` record gains an `int ItemCount` parameter (positional record — any code constructing this record must be updated).
- All 108 existing tests pass without modification.

---

# Decision: Un-revoke Member Endpoint

**Author:** Kaylee (Backend Dev)
**Date:** 2026-03-21
**Issue:** #92 — Un-revoke space member

## Context

The admin panel needs to restore access for accidentally revoked members. We needed a mechanism to un-revoke a member and immediately restore their JWT validity.

## Decision

Added `POST /v1/spaces/{spaceId}/members/{memberId}/unrevoke` as the endpoint to re-activate revoked members. The endpoint mirrors the revoke pattern exactly: admin-only, idempotent (204 for already-active members), no schema changes.

## Rationale

- **Route name "unrevoke":** Clear and direct, mirrors how the API names other member actions (revoke, remove).
- **Mirrors revoke pattern exactly:** Same admin auth, same validation chain (space → member → conditional save), same 204 response. This keeps the API consistent and predictable.
- **Idempotent:** Un-revoking an already-active member is a no-op (204, no error), matching how revoking an already-revoked member is also a no-op.
- **No schema change:** `SpaceMember.IsRevoked` is a boolean that already supports toggling back to `false`.
- **JWT restoration:** Existing tokens of reinstated members become valid immediately via the existing per-request `IsRevoked` check.

## Impact

- Admin panel can now restore revoked members
- Client code calls `POST .../unrevoke` to un-revoke a member
- JWT validity continues to work via per-request `IsRevoked` check
- Reinstated members' existing tokens become valid again immediately without needing to refresh

---

# Decision: Un-revoke Member UI Pattern

**Author:** Wash (Frontend Dev)
**Date:** 2026-03-21
**Issue:** #92

## Context

Revoked members in the admin panel need a way to be restored. The UI must clearly indicate that restoration is different from deletion and maintain consistency with existing member action patterns.

## Decision

Revoked members now show two action buttons side-by-side: **Restore** (emerald/green) and **Remove** (slate/red). The Restore button calls `POST /v1/spaces/{spaceId}/members/{memberId}/unrevoke` to re-activate the member. Both buttons mutually disable during pending operations.

## Rationale

- Mirrors the existing revoke flow exactly (same pending state pattern, error handling, session validation)
- "Restore" wording chosen over "Un-revoke" — friendlier and clearer to admins
- Emerald color signals a positive/constructive action, contrasting with the destructive red/rose tones
- Buttons are wrapped in a flex container with `gap-2` for clean side-by-side layout on mobile and desktop
- Maintains consistency with how "Revoke" and "Remove" buttons appear for active members

## Impact

- Revoked member rows now display restoration UI
- Endpoint: `POST /v1/spaces/{spaceId}/members/{memberId}/unrevoke`
- Same auth pattern (`X-Admin-Secret` header), same error handling as existing member actions
- Frontend is ready to consume the backend endpoint

---

# Decision: Un-revoke Endpoint Test Contract

**Author:** Zoe (Tester)
**Date:** 2026-03-21
**Issue:** #92

## Context

Tests must validate that the un-revoke endpoint meets contract expectations: proper authorization, idempotency, error responses, JWT restoration, and data preservation.

## Decision

Un-revoke tests expect the endpoint at `POST /v1/spaces/{spaceId}/members/{memberId}/unrevoke` with these behaviors:

- **204 NoContent** on success (member is reinstated, IsRevoked = false)
- **204 NoContent** when un-revoking an already-active member (idempotent, mirrors revoke's behavior for already-revoked)
- **401 Unauthorized** when admin secret is missing or invalid
- **404 Not Found** with `{ "Error": "Member not found" }` for non-existent member
- **404 Not Found** with `{ "Error": "Space not found" }` for non-existent space
- **JWT Restoration:** Existing tokens of un-revoked members become valid immediately
- **Data Preservation:** Member metadata (created date, items, membership) remains unchanged

## Rationale

- Mirrors the existing revoke endpoint contract exactly, reducing cognitive load
- Idempotent behavior (204 for already-active) is consistent with how revoke handles already-revoked members
- Error responses follow the existing error format and status codes
- JWT restoration is critical for user experience — no need to re-authenticate
- Data preservation ensures no side effects beyond IsRevoked toggle

## Impact

- 8 integration tests written and passing
- Kaylee's endpoint implementation must match these expectations
- Tests validate the full un-revoke workflow from authorization through data preservation

---

# Decision: Alphabetical space sorting uses localeCompare

**Date:** 2026-03-22  
**Author:** Wash  
**Issue:** #96

## Decision

Spaces are sorted alphabetically (case-insensitive) client-side using `localeCompare(name, undefined, { sensitivity: 'base' })` in both the user pill bar (`app-shell.ts`) and admin panel (`admin-view.ts`).

## Rationale

- `localeCompare` with `sensitivity: 'base'` provides locale-aware, case-insensitive sorting — handles accented characters correctly.
- Sorting is applied at the data-setter level (not in the template) so dynamically added spaces are always in order.
- No server-side sorting needed; this is purely a display concern.

## Impact

- **Wash**: Pill bar and admin panel always show spaces A→Z.
- **Kaylee**: No server changes needed.
- **Zoe**: Existing tests unaffected; new sort-specific tests added.

---

# Decision: Mobile Members Modal — Stacked Layout

**Author:** Wash
**Date:** 2026-03-22
**Context:** Issue #92 / PR #97 — mobile admin members modal was messy at 390×844

## Problem
On mobile (390×844), member rows in the admin modal had name, REVOKED badge, join date, and action buttons all competing for horizontal space. Text wrapped unpredictably and buttons floated awkwardly next to wrapped text.

## Decision
Use Tailwind responsive classes to switch the member row from horizontal to vertical layout on mobile:
- **Mobile (<640px):** `flex-col` — member info stacks on top, buttons appear below, right-aligned via `self-end`
- **Desktop (≥640px):** `flex-row` — original horizontal layout preserved with `sm:flex-row sm:items-center sm:justify-between`

## Alternatives Considered
1. **CSS Grid with fixed columns** — More complex, harder to maintain with conditional button groups
2. **Custom breakpoint (~480px)** — Non-standard Tailwind breakpoint; `sm:` (640px) works fine since the modal content area on a 390px viewport is well below any reasonable threshold
3. **Truncating member info** — Loses information; stacking preserves all content

## Impact
- `admin-view.ts`: Changed Tailwind classes on member row div and button containers
- No new CSS or custom breakpoints needed
- Desktop layout unchanged
