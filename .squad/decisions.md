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

## Governance

- All meaningful changes require team consensus
- Document architectural decisions here
- Keep history focused on work, decisions focused on direction
