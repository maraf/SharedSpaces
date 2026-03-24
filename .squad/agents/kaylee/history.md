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
- Per-space quota overrides use a nullable `long? MaxUploadSize` on the Space entity; null means "use server default from `StorageOptions.MaxSpaceQuotaBytes`". The effective quota is resolved as `space.MaxUploadSize ?? serverDefault` at both API response time and upload enforcement.
- When generating EF Core migrations, always build first (don't use `--no-build`) to ensure the model snapshot picks up property changes.
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
- Aspire local orchestration now lives in the single-file app `src/AppHost.cs`, which replaces the old `src/SharedSpaces.AppHost/` project and keeps local orchestration outside `SharedSpaces.sln`.
- The file-based AppHost uses `Aspire.AppHost.Sdk@13.0.2`, `Aspire.Hosting.NodeJs@9.5.2`, and a `#:project` directive to `src/SharedSpaces.Server/SharedSpaces.Server.csproj`.
- The Vite client is registered from `./SharedSpaces.Client` with `AddNpmApp("client", "./SharedSpaces.Client", "dev")`, waits for the server, wires `Server__DefaultClientAppUrl`, and should be started with `dotnet run src/AppHost.cs`.
- Admin space management lives in `src/SharedSpaces.Server/Features/Spaces/SpaceEndpoints.cs`, where both `POST /v1/spaces` and `GET /v1/spaces` use `AdminAuthenticationFilter`, and listing returns `SpaceResponse` ordered newest-first for admin space selection.
- Admin space management now also covers `/v1/spaces/{spaceId}/members` and `/v1/spaces/{spaceId}/invitations`: member listings return `MemberResponse` newest-first, revocation is idempotent via `POST .../members/{memberId}/revoke`, and invitation listings/deletes never expose hashed PIN values.
- Space-scoped admin endpoints should check whether the space exists before looking up nested resources so missing spaces return `{ Error = "Space not found" }` consistently ahead of nested 404s.
- Server container publishing uses .NET SDK container support (`EnableSdkContainerSupport`) in `.csproj`, targeting `ghcr.io/maraf/sharedspaces-server` with tag format `{VersionPrefix}-{RuntimeIdentifier}`.
- The `server-container.yml` workflow triggers on `server-*` tags, extracts version via shell parameter expansion (`${GITHUB_REF_NAME#server-}`), and publishes for `linux-x64` using `dotnet publish` with `-p:PublishProfile=DefaultContainer`.
- `ForwardedHeadersOptions` must clear `KnownIPNetworks` and `KnownProxies` for reverse proxy deployments (containers, cloud)—ASP.NET Core defaults to trusting only localhost, silently ignoring `X-Forwarded-*` headers from real proxies. Note: `KnownNetworks` is deprecated in .NET 10; use `KnownIPNetworks`.
- `UseForwardedHeaders()` is placed first in the middleware pipeline (before CORS, auth, HTTPS redirection) so `HttpRequest.Scheme` and `HttpRequest.Host` reflect the proxy's values when endpoints generate URLs.
- To include related entity counts in response DTOs (e.g. `ItemCount` on `MemberResponse`), use a correlated subquery via `db.SpaceItems.Count(...)` inside the `.Select()` projection rather than a navigation property or join — EF Core translates it to efficient SQL and keeps the query as a single round-trip.

## Team Updates (2026-03-17 Continued)

**Kaylee completed Issue #22 (SignalR Hub):** Implemented real-time space updates via SignalR:
- `SpaceHub` initially routed at `/v1/hubs/space/{spaceId}` with JWT bearer auth via query param token extraction
- `JoinSpace(Guid spaceId)` method validates space_id claim before adding connection to group
- Event broadcasting integration: `IHubContext<SpaceHub>` injected into `ItemEndpoints`
- `ItemAdded` event broadcast on item creation, `ItemDeleted` on item deletion
- CORS configured to allow WebSocket connections from `Server:DefaultClientAppUrl`
- Branch: `squad/22-signalr-hub`, commit: 8ec9b4f
- Ready for merge after Zoe's test pass (all 46 tests passing post-fix)

## Team Updates (2026-03-17 Continued)

**Kaylee applied PR #37 backend feedback (2026-03-17T15:22Z):** Implemented cleaner SignalR boundary, automatic hub group joining, and required storage configuration:
- Extracted hub broadcast behind `ISpaceHubNotifier` / `SpaceHubNotifier` service interface
- Auto-join space group in `SpaceHub.OnConnectedAsync` with :guid route constraint
- Removed file-storage defaults; `Storage:BasePath` now required
- All item broadcasts now best-effort with warning logs
- Branch: `squad/pr-feedback`, backend commit: 9d723bd
- Ready for merge after test feedback pass

**Zoe applied PR #37 test feedback (2026-03-17T15:22Z):** Updated test async patterns and assertion ordering per Copilot reviewer:
- Updated `TaskCompletionSource` with `TaskCreationOptions.RunContinuationsAsynchronously`
- Reordered assertions to verify HTTP success before awaiting hub events
- Removed explicit `JoinSpace` calls (now automatic)
- Verified test storage paths at `./artifacts/storage-tests`
- Branch: `squad/pr-feedback`, test commit: 0a93ad9
- All 46 tests passing

**Decision documented:** PR #37 feedback decision captured in `.squad/decisions.md` with context, rationale, and validation.

## Team Updates (2026-03-18)

**Coordinated PR #41 feedback resolution (2026-03-18T17:27:29Z):**

Marek's code review on PR #41 spawned a 4-agent squad to address 9 Copilot comments and implement auth flow changes:

- **Kaylee** (commit b130fc0): Added `GET /v1/spaces` admin endpoint, enabling credential validation without side effects. Returns `SpaceResponse[]` on success; 401 on invalid secret.
- **Wash** (commit 7b8a1f5): Fixed 5 frontend PR review comments—disabled async inputs, fixed error parsing/display, normalized server URL, eliminated render-side effects, corrected back navigation.
- **Zoe** (commit af96c28): Fixed QR test naming convention; added 3 new `GET /v1/spaces` tests (valid/invalid/format). Test suite now 67 total.
- **Wash** (commit 2c92ca3): Rewrote admin auth flow—removed localStorage, validate-by-fetching `GET /v1/spaces`, in-memory state only. Page refresh returns to login form. Moved back navigation to shell chrome.

**New decisions documented:**
- `wash-admin-auth-flow.md`: Ephemeral in-memory state, validate via `GET /v1/spaces`, 401 bounces to login.
- `wash-pr-feedback.md`: Back navigation in shell chrome (app-shell.ts) for cross-view consistency.

**Decisions.md updated:** Admin secret validation section corrected from outdated localStorage + test-space behavior to current GET /v1/spaces validation pattern.

## Research — Issue #42 (Share Target API Backend Requirements)

**Kaylee completed research on Share Target backend needs (2026-03-20T)**

### Key Findings:

**Web Share Target API Mechanics:**
- Browser invokes a POST (or GET for text-only) to a manifest-declared `action` URL
- No JWT is auto-attached — the share target launch is a fresh app context (new window/tab)
- Payload: `multipart/form-data` with form fields (title, text, url, files) as declared in manifest's `params`
- Example: OS shares a photo → browser POSTs to `/share` with `title`, `text`, `url`, and a `files` form field

**Current Backend Gaps:**
- ItemEndpoints.cs requires JWT + member identity; share target has neither
- Items require client-generated GUIDs; share target has none
- All item endpoints are behind `RequireAuthorization()`

**Architectural Decision: Dedicated Share Endpoint**
- Reusing PUT /v1/spaces/{spaceId}/items/{itemId} is not feasible without breaking auth semantics
- New endpoint needed: `POST /v1/spaces/{spaceId}/share` (or similar)
- Decouples share target flow from member-based item creation

**Authentication Options for Share Target:**
1. **Option A (Automatic Anonymous Member):** PIN validation + auto-create temporary member
   - Pros: Simple, no extra complexity
   - Cons: Dilutes member list with ephemeral accounts
2. **Option B (PIN-based, No Member):** Create item with MemberId=null or system ID
   - Pros: No member creation overhead
   - Cons: Breaks current domain model (items FK to member)
3. **Option C (Share Token Exchange):** Client-side pre-share token for POST-only access
   - Pros: Secure, explicit consent, audit-friendly
   - Cons: Complex; requires client coordination

**PWA Infrastructure:**
- No manifest.json or service worker currently in client codebase
- Backend has no static file serving (Program.cs doesn't call UseStaticFiles)
- Manifest must declare share_target with action URL + multipart/form-data + file fields

**Key Backend Unknowns for Marek:**
1. Identity model: Should shares create real members, or be anonymous/system-attributed?
2. Share flow entry: Should manifest action point to SPA or backend endpoint?
3. PIN reusability: Can a single invitation PIN be used multiple times for sharing?
4. File validation: Same quota/MIME rules as regular uploads, or relaxed for shares?
5. Static manifest: Does backend need to serve manifest.json, or is Vite sufficient?

**Recommendation:**
- Phase 1 (MVP): Backend endpoint with PIN validation, auto-generated item ID, system/anonymous member
- Phase 2 (Polish): Service worker for offline queuing and sync

## Team Updates (2026-03-21)

**Kaylee completed Issue #58 (Server Container Build):**
- Implemented Docker container building via .NET SDK built-in support (`EnableSdkContainerSupport`)
- Modified `src/SharedSpaces.Server/SharedSpaces.Server.csproj` with container metadata (registry, repository, base image)
- Added `.github/workflows/server-container.yml` workflow triggered on `server-*` git tags
- Workflow extracts version via parameter expansion and publishes to `ghcr.io/maraf/sharedspaces-server` with tag format `{version}-linux-x64`
- PR #59 opened; architecture documented in `.squad/decisions.md`
- Decision: SDK container support (declarative, no Dockerfile), tag-driven CI (explicit versioning), single RID now, extensible matrix for future multi-arch

## Team Updates (2026-03-21 Continued)

**Kaylee completed Issue #72 (Per-Space Upload Quota):**
- Added nullable `MaxUploadSize` property to `Space` entity for optional per-space quota override
- Updated `CreateSpaceRequest` to accept optional `MaxUploadSize`, validated against server default (`StorageOptions.MaxSpaceQuotaBytes`)
- `SpaceResponse` now includes both `MaxUploadSize` (nullable, space-specific) and `EffectiveMaxUploadSize` (resolved value)
- Upload enforcement in `ItemEndpoints.UpsertItem()` reads `space.MaxUploadSize ?? serverDefault` instead of always using global config
- EF Core migration `AddSpaceMaxUploadSize` adds nullable INTEGER column to Spaces table
- Branch: `squad/72-per-space-upload-quota`, commit: 78909a3

## Team Update: Per-Space Upload Quota Feature Complete (2026-03-21, Issue #72)

**Kaylee + Wash + Zoe completed per-space upload quota feature:**

- **Kaylee (Backend):** Implemented `Space.MaxUploadSize` property (nullable long), EF migration, quota validation in create endpoint (rejects ≤ 0 or > 100MB), and enforcement in upload endpoint (resolves `maxUploadSize ?? serverDefault`). API contract: `CreateSpaceRequest.MaxUploadSize`, `SpaceResponse.MaxUploadSize`, `SpaceResponse.EffectiveMaxUploadSize`. Commit: 78909a3.

- **Wash (Frontend):** Updated `admin-api.ts` types to match backend contract. Added quota input field (MB-based, `Math.round(parseFloat(mb) * 1024 * 1024)` conversion) to create form with two-row layout for mobile responsiveness. Space list displays effective quota with "(default)" label when `maxUploadSize` is null. Commit: 326c4b9.

- **Zoe (Tester):** Wrote 9 integration tests — 6 admin endpoint tests (quota validation, rejection, display) and 3 upload enforcement tests (per-space limit, fallback to server default). Updated test DTOs. All 100 tests passing. Commit: d5e1d0c.

**Key Design Decision:** Nullable column distinguishes "not set" from "explicitly set to default". Server default (100MB) acts as ceiling — prevents quotas exceeding storage capacity. Resolved in two places: API response (display) and upload validation (enforcement).

**Status:** ✅ Feature complete and tested. Recorded in `.squad/decisions.md`.

## Team Update: Member Deletion Endpoint (2026-03-22, Issue #93)

**Kaylee completed DELETE member endpoint for Issue #93:**

- **Endpoint:** `DELETE /v1/spaces/{spaceId:guid}/members/{memberId:guid}`
- **Admin-only:** Uses `AdminAuthenticationFilter` like the revoke endpoint
- **Validation:** Returns 404 if space or member not found; returns 409 Conflict if member is not revoked
- **Cleanup:** Finds all SpaceItems for the member, deletes file storage for file-type items, removes items from DB, removes member record
- **SignalR:** Broadcasts `ItemDeletedEvent` for each deleted item to notify connected clients
- **Pattern:** Follows existing `DeleteItem` pattern in `ItemEndpoints.cs` for file cleanup and SignalR notification
- **Learnings:** DELETE operations require revocation check (409 if not revoked), file cleanup before DB removal, SignalR notification after DB commit
- **File:** `src/SharedSpaces.Server/Features/Spaces/SpaceEndpoints.cs` (added imports for IFileStorage and ISpaceHubNotifier)
- **Build:** Verified with `dotnet build --no-restore` — successful compilation

### Issue #92: Un-revoke (Reinstate) Space Member
- **Endpoint:** `POST /v1/spaces/{spaceId:guid}/members/{memberId:guid}/reinstate`
- **Admin-only:** Uses `AdminAuthenticationFilter`, matching the revoke endpoint
- **Behavior:** Sets `IsRevoked = false` on the member; idempotent (no-op if already active)
- **Validation:** Returns 404 if space or member not found; returns 204 No Content on success
- **Pattern:** Exact mirror of `RevokeMember` handler — same space-exists check, member lookup, conditional save
- **No schema changes needed:** `SpaceMember.IsRevoked` is a simple boolean toggle
- **File:** `src/SharedSpaces.Server/Features/Spaces/SpaceEndpoints.cs`
- **Tests:** All 108 existing tests pass after change

## Team Update (2026-03-21 — Issue #92 Un-revoke Member — Complete)

**Status:** ✅ Done
**Commit:** 8bc868d (Kaylee), 2d44723 (Wash), 8590338 (Zoe), adb78df (Coordinator)

**Kaylee's Work:**
- Implemented `POST /v1/spaces/{spaceId}/members/{memberId}/unrevoke` endpoint
- Mirrors revoke pattern: admin-only, idempotent (204 for already-active), no schema changes
- JWT restoration: existing tokens become valid immediately via per-request IsRevoked check
- All 116 tests pass

**Wash's Work:**
- Added `unrevokeMember()` API function to admin-api.ts
- Added UI "Restore" button (emerald) for revoked members in admin-view.ts
- Restore + Remove buttons appear side-by-side with mutual disabling during pending operations
- Button label "Restore" chosen for clarity; emerald color signals constructive action

**Zoe's Work:**
- Wrote 8 integration tests for un-revoke endpoint covering: happy path, auth, 404s, idempotency, JWT restoration, data preservation
- Tests expect: 204 NoContent on success and for already-active (idempotent), 401 for missing/invalid auth, 404 for missing space/member
- All tests pass; no regressions

**Coordinator Work:**
- Fixed endpoint naming mismatch: `/reinstate` → `/unrevoke` to align server with client tests and UI

**Cross-Team Learning:**
- Endpoint contract for un-revoke mirrors revoke exactly (status codes, error responses, idempotency)
- JWT restoration is automatic — no token refresh needed after un-revoke
- UI pattern extends existing member action patterns (pending state, mutual button disabling, color coding)

## Issue #109: Auto-Convert Long Text to .txt File

**Date:** 2026-03-24  
**Status:** ✅ Complete  
**Branch:** `squad/109-auto-convert-long-text`

### Implementation Summary

Added automatic conversion of long text messages (> 64 KB) to `.txt` files in the item upsert endpoint.

**Key Changes:**
- **File:** `src/SharedSpaces.Server/Features/Items/ItemEndpoints.cs`
- **Constants:** Added `DefaultMaxTextToFileThresholdBytes = 65_536` (64 KB threshold)
- **Logic:** When `ContentType=text` and byte count > 64 KB:
  1. Acquire quota lock (same as file uploads)
  2. Check per-space storage quota
  3. Write text to `.txt` file via `IFileStorage`
  4. Change `ContentType` to `"file"`
  5. Set `Content` to `"{itemId:N}.txt"` (GUID without dashes)
  6. Set `FileSize` to actual byte count
  7. Use database transaction for consistency

**Quota Enforcement:**
- Auto-converted files count against per-space storage quota
- Returns `413 Payload Too Large` if quota exceeded
- Same quota lock and transaction handling as regular file uploads

**Resource Management:**
- Refactored quota lock and transaction handling to support dynamic acquisition
- Changed from `await using var` to manual `try-finally` with disposal
- `IAsyncDisposable? quotaLock` and `IDbContextTransaction? transaction` acquired on demand
- Proper cleanup in `finally` block for both success and failure paths

**Filename Format:**
- Uses `{itemId:N}.txt` format (GUID without dashes)
- Example: `f03e56cc54ae4e3ebf64f5ad7eb8cca5.txt`
- Matches test expectations and provides clean, URL-safe filenames

**SignalR Broadcasts:**
- Auto-converted items broadcast as file items (`ContentType="file"`)
- Clients see them as downloadable `.txt` files

### Key Architectural Decisions

**Threshold Rationale:**
- 64 KB threshold balances inline storage convenience with file handling practicality
- Most text messages stay inline (< 64 KB)
- Large documents (64 KB - 1 MB) auto-convert seamlessly
- Maximum text size remains 1 MB (existing limit)

**Auto-Conversion vs Rejection:**
- Automatic conversion provides better UX than rejection
- No client changes required; server handles conversion transparently
- Backwards compatible with existing API clients

**Quota Integration:**
- Auto-converted files must count against quota to prevent bypass
- Consistent resource accounting across all file types
- Uses same quota lock mechanism as regular file uploads

### Testing

**Test File:** `tests/SharedSpaces.Server.Tests/ItemAutoConvertTests.cs` (written by Zoe)
- 13 comprehensive tests covering happy paths, edge cases, quota enforcement
- All 130 total tests pass
- Fixed one test bug: quota test had wrong text size calculation

**Test Coverage:**
- Short text stays inline
- Long text auto-converts to file
- Converted files are downloadable with correct content
- Quota enforcement works correctly
- Filename format matches expectations
- Update scenarios handled correctly

### Technical Challenges

**Resource Management:**
- Initial approach used `await using var` declarations which prevented conditional acquisition
- Solution: Manual disposal in `finally` block for both `IAsyncDisposable` and `IDbContextTransaction`
- Pattern: `quotaLock?.DisposeAsync()` in finally for graceful cleanup

**Transaction Handling:**
- Auto-conversion path needs transaction mid-method (after initial checks)
- Solution: Nullable references with conditional acquisition
- Ensures consistent quota lock + transaction pairing for file operations

**Test Alignment:**
- Zoe's tests expected 64 KB threshold and GUID-without-dashes filename format
- Implementation matched test expectations perfectly after fixing one test bug

### Build & Verification

```bash
dotnet build    # Success
dotnet test     # All 130 tests pass
```

### Learnings

**Pattern: Dynamic Resource Acquisition**
- When resource acquisition depends on runtime conditions, use nullable references with manual disposal
- `try-finally` with `DisposeAsync()` ensures cleanup even on early returns
- Avoid `await using var` when you need conditional/delayed acquisition

**Pattern: Quota-Protected Operations**
- File writes (including text-to-file conversion) require quota lock + transaction
- Check quota before writing, rollback on failure, cleanup file on error
- Consistent pattern across regular uploads and auto-conversions

**Pattern: Transparent Conversions**
- Auto-conversion should be invisible to clients (no API contract changes)
- Response reflects final item state (file, not text)
- Download endpoint works identically for auto-converted files

**Test-Driven Implementation:**
- Zoe wrote comprehensive tests before implementation
- Tests defined expected behavior (64 KB threshold, filename format)
- Implementation matched test expectations exactly
- One test bug found and fixed: quota math error

**Imports:**
- Added `using Microsoft.EntityFrameworkCore.Storage;` for `IDbContextTransaction`
- Needed for manual transaction management in try-finally pattern

### Files Modified

- `src/SharedSpaces.Server/Features/Items/ItemEndpoints.cs` — Core implementation
- `tests/SharedSpaces.Server.Tests/ItemAutoConvertTests.cs` — Fixed one test bug
- `.squad/decisions/inbox/kaylee-auto-convert-long-text.md` — Decision documentation

### Decision Documentation

Documented in `.squad/decisions/inbox/kaylee-auto-convert-long-text.md`:
- Threshold values and rationale
- Implementation details
- API behavior changes
- Quota enforcement approach
- Filename format
- Testing coverage
- Alternatives considered

---

## Session: Issue #109 (2026-03-24)

### Zoe's Test Work Validated Implementation

Zoe created 13 comprehensive integration tests that validate all aspects of the auto-convert feature:

- **Boundary Tests:** Empty text, below-threshold, at-threshold, above-threshold scenarios
- **Unicode Edge Cases:** Emoji (4-byte UTF-8) and CJK characters with byte-count validation
- **Round-Trip Verification:** Upsert → download → content comparison ensures encoding preservation
- **Quota Integration:** Auto-converted files count against space quota; 413 rejection when exceeded

**Key Insight:** Zoe's tests define the complete specification for auto-convert behavior. Implementation matched test expectations exactly, validating the 64 KB threshold, filename format, and quota integration work correctly.

### Tests Passed

All 130 tests pass including Zoe's 13 auto-convert specific tests. One test bug discovered during validation and fixed.

### Cross-Implementation Verification

- Zoe's round-trip verification confirms UTF-8 encoding preserved through storage/retrieval
- Quota tests validate consistent accounting across regular and auto-converted files
- Boundary tests confirm threshold behavior at edge cases

