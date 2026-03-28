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

## Team Updates (2026-03-27)

**Issue #135 completed (Copy and move items between spaces):**
- **Kaylee:** Implemented `POST /v1/spaces/{sourceSpaceId}/items/{itemId}/transfer` endpoint with dual-token auth, quota locks, file streaming, and SignalR broadcasts. Key design: server-generated destination item IDs, serializable transactions on destination space only, broadcast ordering (ItemAdded → ItemDeleted).
- **Wash:** Built client transfer UI — "Send to…" button, space-picker modal with Copy/Move buttons, loading states, error feedback in modal, success via existing `syncMessage` banner. Also fixed Issue #100 (pending share card layout unification).
- **Zoe:** Wrote 11 integration tests covering copy/move for text/file items, quota enforcement, token validation, revoked member rejection. Fixed critical JWT `MapInboundClaims` bug in transfer endpoint: handler now preserves original claim names (matches `JwtAuthenticationExtensions.cs`). All 151 tests passing.
- **Cross-agent pattern:** Dual-token authorization ensures user membership in both spaces; serializable transactions + quota locks prevent TOCTOU on destination; stream-based file copy suits large files. Established for reuse in future cross-space operations.
- **PR #136 ready for merge.**
- The `server-container.yml` workflow triggers on `server-*` tags, extracts version via shell parameter expansion (`${GITHUB_REF_NAME#server-}`), and publishes for `linux-x64` using `dotnet publish` with `-p:PublishProfile=DefaultContainer`.
- `ForwardedHeadersOptions` must clear `KnownIPNetworks` and `KnownProxies` for reverse proxy deployments (containers, cloud)—ASP.NET Core defaults to trusting only localhost, silently ignoring `X-Forwarded-*` headers from real proxies. Note: `KnownNetworks` is deprecated in .NET 10; use `KnownIPNetworks`.
- `UseForwardedHeaders()` is placed first in the middleware pipeline (before CORS, auth, HTTPS redirection) so `HttpRequest.Scheme` and `HttpRequest.Host` reflect the proxy's values when endpoints generate URLs.
- To include related entity counts in response DTOs (e.g. `ItemCount` on `MemberResponse`), use a correlated subquery via `db.SpaceItems.Count(...)` inside the `.Select()` projection rather than a navigation property or join — EF Core translates it to efficient SQL and keeps the query as a single round-trip.
- CLI `ConfigService.SaveAsync` uses atomic temp-file + `File.Move(overwrite: true)` and sets 0600 Unix permissions via `File.SetUnixFileMode` to protect JWT tokens at rest.
- CLI PIN validation enforces exactly 6 digits (`^\d{6}$`) to match server-generated PINs; previously accepted any digit length.
- CLI error handling strategy: catch `HttpRequestException`, `UnauthorizedAccessException`, `IOException`, and `JsonException` in command handlers, printing user-friendly messages to stderr rather than crashing with stack traces.

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


---

## Cross-Agent Note: Test Pattern Change (2026-03-24)

**From Zoe:** SignalR hub auth tests now use resilient assertion pattern (`ThrowAsync<Exception>()` + connection state check) instead of specific exception types. This change affects how new hub tests should be written going forward and may inform how server code handles auth failures. See `.squad/decisions.md` for full decision.


---

## Session: Issue #115 (2026-03-24)

### CORS Configuration Updated to Support Multiple Origins

**What:** Changed `Cors:Origins` from a single string to an array to support multiple allowed origins for production/staging scenarios.

**Why:** Previous config only supported one origin. For multi-environment deployments (e.g., production + staging), multiple origins need to be whitelisted.

**Changes Made:**
1. **Program.cs (lines 29-38):** Updated CORS config to read from `builder.Configuration.GetSection("Cors:Origins").Get<string[]>()` instead of single string. Falls back to `["https://localhost:5173"]` if not configured. The `WithOrigins()` method already accepts `params string[]`, so no signature change needed.
   
2. **appsettings.Development.json:** Changed `"Origins": "http://localhost:5173"` to `"Origins": ["http://localhost:5173"]` (JSON array format).

3. **AppHost.cs (line 30):** Changed `server.WithEnvironment("Cors__Origins", ...)` to `server.WithEnvironment("Cors__Origins__0", ...)` to match ASP.NET Core array config format (double underscore + index).

4. **AdminEndpointTests.cs (line 1468):** Changed in-memory config from `["Cors:Origins"]` to `["Cors:Origins:0"]` to match array index format (colon + index for in-memory provider).

**Config Format Examples:**
- **appsettings.json:** `"Origins": ["http://localhost:5173", "https://example.com"]`
- **Environment variables:** `Cors__Origins__0=http://localhost:5173`, `Cors__Origins__1=https://example.com`
- **In-memory (tests):** `["Cors:Origins:0"] = "...", ["Cors:Origins:1"] = "..."`

**Build Verification:** Both `SharedSpaces.Server.csproj` and `SharedSpaces.Server.Tests.csproj` build successfully with the changes.

### Files Modified

- `src/SharedSpaces.Server/Program.cs` — CORS config now reads array
- `src/SharedSpaces.Server/appsettings.Development.json` — Array format
- `src/AppHost.cs` — Environment variable uses index format
- `tests/SharedSpaces.Server.Tests/AdminEndpointTests.cs` — In-memory config uses index format

- CLI config (`SpaceEntry`) now stores only `JwtToken`; `SpaceId`, `ServerUrl`, `DisplayName`, and `SpaceName` are computed at runtime by decoding JWT claims via `JwtSecurityTokenHandler`. `JoinedAt` was dropped entirely per Marek's directive. Package `System.IdentityModel.Tokens.Jwt` (8.17.0) added to `SharedSpaces.Cli.Core`.

### JWT-Only CLI Config Refactor (Session 2026-03-25)

**What:** Refactored `SpaceEntry` to store only JWT token; all metadata extracted from claims at runtime.

**Why:** Marek directive to drop `JoinedAt` and simplify config to single source of truth. JWT already carries all needed claims (`space_id`, `server_url`, `display_name`, `space_name`).

**Changes:**
1. **SpaceEntry.cs:** Made `SpaceId`, `ServerUrl`, `DisplayName`, `SpaceName` computed properties that decode JWT claims. Added `[JsonIgnore]` so they never serialize. Only `JwtToken` persists in config.
2. **ConfigService.cs:** No logic changes needed — GetSpaceAsync/UpsertSpaceAsync already work with computed properties.
3. **JoinCommand.cs:** Updated to set only `JwtToken` when creating new entries.
4. **SharedSpaces.Cli.Core.csproj:** Added `System.IdentityModel.Tokens.Jwt` 8.17.0 dependency.
5. **All tests:** Still pass (19/19) — no API changes, only implementation.

**Implementation Notes:**
- JWT decoding happens on every config read (negligible cost; can add in-memory cache later)
- Claims are base64-encoded (not encrypted), so no key needed for decoding
- Removed `JoinedAt` entirely — never in JWT, added no value

**Build & Test:** ✅ Clean build, ✅ 19/19 tests pass

**Collaboration:** Zoe updated all test fixtures and added `SpaceEntry_ExtractsClaimsFromJwt` test. Both commits to cli-scaffold, PR #121 updated.

---

## Session: NuGet Trusted Publishing (2026-03-25)

### CLI Workflow Enhanced with NuGet.org Trusted Publishing

**What:** Added OIDC-based trusted publishing to `.github/workflows/cli-publish.yml` to enable automatic NuGet package publication without API key secrets.

**Why:** Trusted publishing uses GitHub's OIDC tokens for authentication, eliminating the need to manage/rotate API keys. More secure and aligns with modern GitHub Actions best practices.

**Changes Made:**
1. **Permissions:** Added `id-token: write` to workflow permissions (required for OIDC token requests)
2. **Environment:** Added `environment: nuget.org` to job config (maps to trusted publisher policy on nuget.org)
3. **Push Step:** Added `dotnet nuget push` step that pushes to `https://api.nuget.org/v3/index.json` with `--skip-duplicate` flag
4. **Documentation:** Included inline comments explaining the manual nuget.org setup:
   - Navigate to nuget.org package management
   - Configure trusted publisher for GitHub Actions
   - Specify owner/repo, workflow file, and environment name

**How OIDC Trusted Publishing Works:**
- GitHub Actions requests an OIDC token when job runs
- `dotnet nuget push` automatically uses this token for authentication
- NuGet.org validates the token against the trusted publisher policy
- No secrets stored in GitHub repository

**Manual Configuration Required:**
Owner must configure trusted publisher on nuget.org:
- Package: `SharedSpaces.Cli`
- Publisher: GitHub Actions
- Repository: `{owner}/{repo}`
- Workflow: `cli-publish.yml`
- Environment: `nuget.org`

**File Modified:** `.github/workflows/cli-publish.yml`

**Commit:** `ci(cli): add NuGet trusted publishing to CLI workflow` (7e0e74b)


---

## Session: PR #121 Second Round Review (2026-03-25)

### Applied Reviewer Feedback on Error Handling & Security

**What:** Addressed 5 unresolved PR review threads with fixes for error handling, documentation accuracy, and security issues.

**Why:** 
1. CLI should catch local filesystem/config failures gracefully instead of crashing
2. Documentation examples should use valid data that passes validation
3. Security: temp files containing JWTs should have restrictive permissions from creation
4. Error messages should accurately describe the failure source

**Changes Made:**

1. **JoinCommand.cs (Thread r2987688869):**
   - Added catch blocks for `UnauthorizedAccessException`, `IOException`, and `JsonException`
   - Local config write failures now show user-friendly stderr messages with exit code 1
   - Mirrors UploadCommand's comprehensive error handling

2. **README.md (Thread r2987688890):**
   - Fixed truncated GUID in client invite URL example
   - Changed `550e8400` → `550e8400-e29b-41d4-a716-446655440000`
   - Now passes InvitationParser's GUID validation

3. **InvitationParser.cs (Thread r2987688910):**
   - Updated XML doc to reflect optional PIN parameter
   - Format changed from `"serverUrl|spaceId|pin"` → `"serverUrl|spaceId[|pin]"`
   - Added note that optional PIN must be 6 digits

4. **ConfigService.cs (Thread r2987688928):**
   - Fixed security issue: temp file now created with 0600 permissions from start
   - Uses `FileStreamOptions` with `UnixCreateMode` on non-Windows platforms
   - Prevents brief window where JWT file could be world-readable with permissive umask

5. **UploadCommand.cs (Thread r2987764102):**
   - Narrowed try/catch scope to separate config errors from server response errors
   - Config read errors handled at start with "Failed to read CLI config"
   - Server response JsonException now shows "Failed to parse server response"
   - Eliminates misleading error messages

**Build & Test:** ✅ Clean build, ✅ 19/19 tests pass

**Commit:** `fix(cli): apply second round of PR review feedback` (02877cb)

**PR Activity:** Replied to all 5 unresolved threads on PR #121 confirming fixes with commit reference.

## Learnings

### Exception Handling Strategy
- **Scope Matters:** Narrow try/catch blocks to specific operations when error sources differ (config I/O vs server responses). This enables accurate error messages.
- **Local vs Remote Failures:** Commands should catch both network errors (HttpRequestException) and local filesystem errors (UnauthorizedAccessException, IOException, JsonException).
- **Mirror Patterns:** When two commands do similar operations (join/upload both use config), mirror their error handling for consistency.

### Unix File Permissions
- **FileStreamOptions.UnixCreateMode:** Sets permissions atomically at file creation (available in .NET 6+).
- **Security:** For sensitive files (JWT tokens), use 0600 from creation — don't rely on post-creation `SetUnixFileMode()`.
- **Pattern:** `new FileStream(path, new FileStreamOptions { Mode = FileMode.Create, Access = FileAccess.Write, UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite })`

### Documentation Best Practices
- **Valid Examples:** All code/URL examples in docs should pass the actual parser/validator.
- **Full GUIDs:** Always use complete GUIDs in examples (8-4-4-4-12 format), never truncated.
- **Optional Params:** XML docs should accurately reflect optional parameters with `[|param]` notation.

---

## 2026-03-25: PR #121 Feedback Round 2 Completed

📌 **Team update (2026-03-25T12:07:59Z):** All 5 unresolved PR #121 review feedback items applied — error handling, documentation, file permissions, error messaging. 19 tests passing, committed 02877cb, pushed, thread replies sent.

**Session:** `2026-03-25T12-07-59Z-pr-feedback-round2`  
**Outcome:** ✅ Complete

---

## 2026-03-25: Issue #119 - `sync` Command Implementation

📌 **Task:** Implement `sync` command for real-time file synchronization from SharedSpaces spaces via SignalR with HTTP polling fallback.

**Session:** `2026-03-25T16-30Z-sync-command`  
**Outcome:** ✅ Complete

### Implementation

**1. Added NuGet Package**
- Added `Microsoft.AspNetCore.SignalR.Client` to `SharedSpaces.Cli.Core.csproj`
- Version: 10.0.5 (matching .NET 10 target framework)

**2. Extended SharedSpacesApiClient.cs**
- `ListItemsAsync(serverUrl, spaceId, jwtToken, ct)` — GET /v1/spaces/{spaceId}/items
- `DownloadFileAsync(serverUrl, spaceId, itemId, jwtToken, ct)` — GET /v1/spaces/{spaceId}/items/{itemId}/download
- Added `SpaceItemResponse` record with all item fields (Id, SpaceId, MemberId, ContentType, Content, FileSize, SharedAt)
- Download method uses `HttpCompletionOption.ResponseHeadersRead` for efficient streaming

**3. Created SyncService.cs**
- **Initial sync:** Lists all items, downloads files (skips text items)
- **SignalR connection:** Connects to `/v1/spaces/{spaceId}/hub` with JWT via `AccessTokenProvider`
- **Auto-reconnect:** Uses `WithAutomaticReconnect()` for resilience
- **Event handlers:**
  - `ItemAdded` → downloads file items automatically
  - `ItemDeleted` → logs only (no local deletion per MVP scope)
- **Polling fallback:** If disconnected >30 seconds, polls every 5 seconds via HTTP
- **In-memory manifest:** Tracks downloaded item IDs (`HashSet<Guid>`) to avoid re-downloads
- **File naming:** Uses `item.Content` field as filename, falls back to `{itemId}.bin` if empty
- **Conflict strategy:** Overwrites existing files (same itemId)
- **Connection state tracking:** Logs all state changes (connected, reconnecting, reconnected, closed)
- **Graceful shutdown:** Accepts CancellationToken, disposes hub and timer cleanly

**4. Created SyncCommand.cs**
- Follows UploadCommand pattern exactly
- Options: `--space-id` (required), `--folder` (required)
- Validates space exists in config, creates folder if needed
- Runs SyncService until cancelled (Ctrl+C / SIGTERM)
- Error handling: HttpRequestException, UnauthorizedAccessException, IOException, JsonException, OperationCanceledException

**5. Registered Command**
- Added `rootCommand.Add(SyncCommand.Create())` to `Program.cs`

### Build Verification
✅ `dotnet build SharedSpaces.sln` succeeded  
✅ All projects compile cleanly

### Key Decisions
- **SignalR hub route:** Uses existing `/v1/spaces/{spaceId}/hub` endpoint with JWT query string auth
- **Polling threshold:** 30 seconds disconnect before fallback (balances reconnection attempts vs responsiveness)
- **Polling interval:** 5 seconds (conservative, avoids server overload)
- **Event payload records:** Defined internally in SyncService.cs to avoid coupling CLI Core to server event types
- **File overwrite:** MVP behavior — same itemId always overwrites (no versioning/conflict resolution)
- **No local deletion:** `ItemDeleted` events are logged but don't trigger local file removal (safety-first for MVP)

### SignalR Connection Pattern
```csharp
var connection = new HubConnectionBuilder()
    .WithUrl($"{serverUrl}/v1/spaces/{spaceId}/hub", options =>
    {
        options.AccessTokenProvider = () => Task.FromResult<string?>(jwtToken);
    })
    .WithAutomaticReconnect()
    .Build();
```

### Learnings

- **System.CommandLine API:** Option required flag is `Required = true` (property), not `IsRequired = true`
- **SignalR event handlers:** Must use exact event names from server (`ItemAdded`, `ItemDeleted`) and matching payload types
- **Async disposal:** HubConnection implements `IAsyncDisposable` — must call `DisposeAsync().AsTask().Wait()` in synchronous Dispose
- **Timer threading:** Timer callbacks execute on thread pool; must capture CancellationToken in closure for async operations
- **Polling vs SignalR:** Best-effort fallback pattern — don't stop trying SignalR reconnection while polling
- **Stream disposal:** DownloadFileAsync returns Stream — caller owns disposal, but underlying HttpResponseMessage must stay alive
- **Connection state events:** SignalR provides `Reconnecting`, `Reconnected`, and `Closed` — hook all three for complete observability
- **Hub auto-join:** Server-side `OnConnectedAsync` auto-joins space groups, so CLI doesn't need explicit join method call


## 2025-01-26 — Bidirectional Upload via FileSystemWatcher (Issue #120)

### Implementation

Extended `SyncService` with FileSystemWatcher-based upload to detect and upload locally-created files to the space in real-time.

**Changes to `SyncService.cs`:**

1. **Added filename-based loop prevention:**
   - `ConcurrentDictionary<string, byte> _knownFiles` — Tracks filenames (case-insensitive) to distinguish downloaded vs user-created files
   - `ScanExistingFiles()` — Scans local folder on startup to build initial manifest of pre-existing files
   - `DownloadAndSaveFileAsync()` now adds filename to `_knownFiles` after saving

2. **FileSystemWatcher integration:**
   - `FileSystemWatcher? _watcher` field
   - `StartFileWatcher(CancellationToken)` — Creates watcher on local folder, subscribes to `Created` events
   - Filter: `*.*` (all files), `IncludeSubdirectories = false`
   - Ignores temp files (`.*.tmp` pattern used by download process)

3. **Upload flow:**
   - `OnFileCreated(FileSystemEventArgs, CancellationToken)` — Handler for Created events:
     - Checks if filename is in `_knownFiles` → skip if yes (downloaded or pre-existing)
     - Adds filename to `_knownFiles` immediately (prevent double-upload)
     - Fires async upload on background task (don't block FileSystemWatcher thread)
   - `UploadLocalFileAsync(string, CancellationToken)` — Upload logic:
     - Generates `Guid.NewGuid()` for item ID
     - Waits 100ms for file to be fully written
     - Retries file access up to 3 times (handles locked files)
     - Calls `_apiClient.UploadFileAsync()`
     - Adds item ID to `_downloadedItems` (prevents SignalR echo from triggering download)
     - Removes from `_knownFiles` on failure (allows retry)

4. **RunAsync flow updated:**
   - `ScanExistingFiles()` called before `InitialSyncAsync()`
   - `StartFileWatcher(ct)` called after `ConnectSignalRAsync(ct)`

5. **Disposal:**
   - `_watcher?.Dispose()` in `DisposeAsync()`

### Thread Safety

- `_knownFiles` is `ConcurrentDictionary` — FileSystemWatcher events fire on ThreadPool threads
- Upload task runs on background thread via `Task.Run` to avoid blocking watcher
- CancellationToken properly propagated to async operations

### Loop Prevention Strategy

**Two-level tracking:**
1. **Guid-based** (`_downloadedItems`) — Tracks items by server-assigned IDs (prevents re-download of same item)
2. **Filename-based** (`_knownFiles`) — Tracks filenames to distinguish:
   - Files downloaded from space → in `_knownFiles` → ignore Created events
   - Pre-existing files on startup → in `_knownFiles` → ignore Created events
   - User-created files → NOT in `_knownFiles` → upload to space

**Flow:**
- Download: Add filename to `_knownFiles` → FileSystemWatcher ignores it
- User creates file: Not in `_knownFiles` → upload → add to `_knownFiles` + add Guid to `_downloadedItems`
- SignalR echo: Item ID in `_downloadedItems` → skip download

### Build Verification
✅ `dotnet build src/SharedSpaces.Cli.Core/SharedSpaces.Cli.Core.csproj` succeeded  
✅ `dotnet build src/SharedSpaces.Cli/SharedSpaces.Cli.csproj` succeeded

### Learnings

- **FileSystemWatcher temp file handling:** Must explicitly ignore `.*.tmp` files created by download atomic write pattern
- **File locking:** Need retry logic in upload — file may be locked briefly after creation (antivirus, indexing, etc.)
- **Task.Run for FSW events:** FileSystemWatcher events fire synchronously on ThreadPool thread — must offload async work to avoid blocking watcher
- **Case-insensitive filename tracking:** Use `StringComparer.OrdinalIgnoreCase` for cross-platform filename comparison
- **100ms write delay:** Brief delay before reading new file ensures it's fully written (especially for large files or slow writes)
- **NotifyFilters:** Setting `NotifyFilters.FileName | NotifyFilters.CreationTime` reduces spurious events

### 2026-03-17 — PR #123 Review: SyncService Robustness Fixes

Applied 6 targeted fixes to `SyncService.cs` from PR review feedback:

1. **Case-insensitive temp-file filtering** — Changed `.EndsWith(".tmp")` to use `OrdinalIgnoreCase` comparison in both `ScanExistingFiles` (line 307) and `OnFileCreated` (line 339). Prevents `.TMP` variants from bypassing exclusion on Windows.

2. **FileSystemWatcher filter** — Changed `Filter = "*.*"` to `Filter = "*"`. The `*.*` pattern misses extensionless files on some platforms (Linux/macOS).

3. **FileSystemWatcher disposal guard** — Added `_watcher?.Dispose()` before creating a new watcher in `StartFileWatcher`. Prevents OS handle leaks if the method is called multiple times.

4. **Atomic duplicate upload prevention** — Replaced `ContainsKey` check + `TryAdd` with a single `TryAdd` as gate. The `!_knownFiles.TryAdd(...)` pattern is atomic and prevents race conditions where multiple FileSystemWatcher events for the same file can trigger duplicate uploads.

5. **Cleanup on file-not-found** — Added `_knownFiles.TryRemove(fileName, out _)` when `File.Exists(filePath)` returns false in `UploadLocalFileAsync`. Ensures vanished files don't block future uploads with the same name.

**Pattern learned:** Always use `StringComparison.OrdinalIgnoreCase` for file extension checks in cross-platform code. Windows is case-insensitive but explicit comparison ensures consistent behavior.

**Pattern learned:** `ConcurrentDictionary.TryAdd` as a gate is cleaner than separate `ContainsKey` checks — it's atomic and avoids TOCTOU bugs.

---

## 2026-03-26: PR #130 Race Condition Fix - Polling Deletion vs In-Flight Uploads

**What:** Fixed a race condition in `SyncService.cs` where the polling-based deletion check could delete a user's local file mid-upload when SignalR was disconnected.

**Why:** The polling loop compared `serverFileIds` against all `_downloadedItems` keys, but uploads pre-add `itemId` before the PUT completes. A slow upload during a SignalR disconnect made polling think the item was deleted on the server.

**Fix:** Added `ConcurrentDictionary<Guid, byte> _pendingUploads` to track in-flight upload item IDs. The ID is added before the PUT starts and removed on completion or failure. The polling deletion loop skips any ID present in `_pendingUploads`.

**Pattern learned:** When a ConcurrentDictionary serves dual purposes (echo-prevention AND state tracking), use a separate tracking collection to disambiguate in-flight vs confirmed entries.

**Build:** Clean build after fix
---

## 2026-03-26: Transfer Endpoint Implementation (Issue #135)

**What:** Implemented POST /v1/spaces/{sourceSpaceId}/items/{itemId}/transfer endpoint to copy or move items between spaces.

**Key Implementation Details:**
- **Dual token authorization:** Source space via Bearer header, destination space via destinationToken in request body
- **Server-generated destination IDs:** Unlike normal item creation, transfer generates new GUIDs server-side for destination items
- **Quota enforcement:** Destination quota checked and locked (serializable transaction), consistent with existing UpsertItem pattern
- **File streaming:** Files copied via IFileStorage stream API (no memory buffering)
- **Move semantics:** Source item deleted after destination created; SignalR broadcasts ItemAdded to destination, then ItemDeleted to source
- **Same-space rejection:** Returns 400 if source and destination space IDs match

**Pattern Reuse:**
- AcquireQuotaLockAsync(destinationSpaceId) — same SemaphoreSlim pattern as UpsertItem
- JwtTokenSigningKeyFactory.Create(configuration) — reused JWT validation from JwtAuthenticationExtensions.cs
- ISpaceHubNotifier — consistent broadcast pattern for ItemAdded/ItemDeleted events
- Serializable transaction + rollback on exception

**Files Modified:**
- src/SharedSpaces.Server/Features/Items/Models.cs — Added TransferItemRequest record
- src/SharedSpaces.Server/Features/Items/ItemEndpoints.cs — Added TransferItem endpoint (~250 lines) + using Microsoft.IdentityModel.Tokens

**Design Decisions:**
- Destination member attribution: Transferred item owned by transferring user in destination space (not original author)
- Move quota check: Only destination quota matters; move fails if destination full even though source would shrink
- Auto-converted text items (>65KB stored as files) transferred as files with updated .txt content field
- V1 is single-item only (no batch transfers)

**Pattern Learned:** For server-side operations that touch multiple spaces, dual-token validation ensures proper authorization without relying on client-provided credentials. The destination token must be independently validated, not just trusted.

**Pattern Learned:** When scoping variables for cleanup in exception handlers, declare them before the try block if they're needed in catch/finally. Avoids regenerating resource IDs that should match the ones created in the try block.

**Build:** Clean build after implementation
