# Project Context

- **Owner:** Marek Fišera
- **Project:** SharedSpaces — A self-hostable web platform where users join shared spaces via QR code/URL+PIN, share files and text in real-time, with anonymous identity and JWT-based access.
- **Stack:** .NET (ASP.NET Core Web API), React SPA (Vite), SignalR (WebSocket), SQLite + EF Core, JWT auth
- **Created:** 2026-03-16

## Core Context

### Architecture
- Server is a pure API (no rendered UI) — ASP.NET Core Web API + SignalR
- Client is a separate React SPA (Vite) — independently deployable, can connect to any server
- No deployment binding between client and server
- A single client instance may connect to multiple servers simultaneously

### Domain Model
- Space, SpaceInvitation, SpaceMember, SpaceItem — all IDs are GUIDs
- JWT tokens have no expiration — validity = SpaceMember existence + IsRevoked check
- Invitation PINs are hashed at rest, deleted after token is issued
- SpaceItem IDs are client-generated (PUT/upsert semantics)

### Implementation Phases
- Phase 1: Core Server (solution scaffold, domain entities, admin endpoints, join/auth, items CRUD)
- Phase 2: Real-time (SignalR hub per space)
- Phase 3: React Client (Vite scaffold, join flow, JWT storage, multi-server, SignalR client)
- Phase 4: Admin UI
- Phase 5: Offline & Polish (Service Worker, IndexedDB, Docker Compose)

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->

### Issue Decomposition Strategy (2026-03-16)

Created 14 GitHub issues (maraf/SharedSpaces#17-#30) breaking down the 5-phase implementation plan:

**Phase 1 (Core Server) — 5 issues:**
- #17: Solution scaffold + EF Core with SQLite — foundation work
- #18: Domain entities (Space, SpaceInvitation, SpaceMember, SpaceItem) + migrations
- #19: Admin endpoints (create space, generate invitations with optional QR)
- #20: Join/auth flow (PIN validation → JWT issuance → invitation deletion)
- #21: Items CRUD with quota enforcement and file storage abstraction

**Phase 2 (Real-time) — 1 issue:**
- #22: SignalR hub for broadcasting item events to space groups

**Phase 3 (React Client) — 4 issues:**
- #23: Vite + React scaffold with routing and project structure
- #24: Join flow with invitation parsing, display name input, JWT storage
- #25: Space view with item list and file/text upload UI
- #26: SignalR client integration for live updates

**Phase 4 (Admin UI) — 1 issue:**
- #27: Admin panel for space creation and invitation generation

**Phase 5 (Offline & Polish) — 3 issues:**
- #28: Service Worker + IndexedDB for offline support
- #29: Docker Compose for self-hosting
- #30: QR code generation for invitations

**Decomposition principles applied:**
- Each issue is a coherent unit of work for a single developer
- Issues include detailed acceptance criteria so devs don't need to constantly reference README
- Dependencies are explicit (e.g., "#21 requires #20")
- Granularity: not too fine (avoided 1 issue per endpoint), not too coarse (avoided 1 issue per phase)
- Labels: all have 'squad', plus phase labels (phase:1-5) and category labels (backend, frontend, infrastructure, real-time)
- Target: 10-15 issues total (achieved 14)

**Key architectural notes embedded in issues:**
- Client-generated GUIDs for SpaceItem IDs (PUT/upsert semantics)
- JWT claims include server_url for multi-server support
- Admin auth via simple header secret (not JWT)
- File storage abstraction for future cloud provider swap
- Invitation PINs are deleted after JWT issuance (no replay)
- JWT has NO expiration; validity = SpaceMember.IsRevoked check

### Phase 1 Completion: Kaylee & Zoe (2026-03-17)

**Status:** ✅ All Phase 1 core server APIs are now implemented and tested.

**Completed Issues:**
- #17: Solution scaffold + EF Core + SQLite ✅
- #18: Domain entities + migrations ✅
- #19: Admin endpoints ✅
- #20: Join/auth flow ✅
- #21: Items CRUD + file storage abstraction ✅

**Key Implementation Patterns for Future Phases:**

1. **Vertical Slice Architecture**
   - Each feature lives in `src/SharedSpaces.Server/Features/{Feature}/` with its own endpoints, models, and logic
   - Endpoints are thin wrappers calling into domain/application logic
   - Dependency injection in `Program.cs` keeps wiring centralized

2. **File Storage Abstraction**
   - `IFileStorage` interface in `Infrastructure/FileStorage/` enables testability and cloud migration
   - `LocalFileStorage` stores files relative to `Storage:BasePath` from config
   - Implementations are pluggable; future cloud storage (S3, Azure) is a one-endpoint swap

3. **Multipart File Upload Pattern**
   - Manual form parsing within the endpoint handler (not automatic model binding)
   - JWT authorization runs before form parsing — auth failures return 401 before payload is consumed
   - File size validation and quota checks happen server-side (never trust client)

4. **Quota Tracking**
   - Metadata-based: `SpaceItem.FileSize` is persisted to database
   - No filesystem scans at request time — O(1) quota enforcement via sum of item sizes
   - Allows accurate quota in distributed systems (future)

5. **Database & Testing**
   - SQLite is production database with proper migrations
   - EF Core `InMemory` provider is used in tests via `WebApplicationFactory`
   - `AppDbContext` is provided-aware; startup initialization detects SQLite vs InMemory and applies migrations/EnsureCreated accordingly
   - Solution targets .NET 10 with explicit `Microsoft.IdentityModel.JsonWebTokens` package (required for JWT validation in .NET 10)

6. **Authentication**
   - JWT tokens have no expiration claim
   - Validity is determined by `SpaceMember` existence + `IsRevoked` flag check
   - All protected endpoints use `.RequireAuthorization()` in route groups

**Ready for Phase 2:** SignalR hub can assume item CRUD is stable and tested. Hub should broadcast `item-created` and `item-deleted` events using the same `SpaceItem` model for serialization consistency.

**Ready for Phase 3:** React client can assume all server APIs are available and stable. Use same JWT structure and models from API responses for type safety.

### Lit HTML vs React Evaluation (2026-03-17)

**Status:** ✅ Completed architectural evaluation, split verdict awaiting Marek's decision.

Evaluated Marek's proposal to switch from React to Lit HTML + WebComponents for the SharedSpaces client SPA.

**Mal's Recommendation:** ✅ **APPROVE THE SWITCH**

Key findings:
- **SignalR integration:** Native, cleaner than React patterns (no wrapper boilerplate)
- **Multi-server JWT:** Simpler architecture without forced single-app-state
- **Bundle size:** 40% reduction (110-140 KB gzipped) = significant UX win for self-hosted, mobile-first deployments
- **Dependency footprint:** Fewer libraries to maintain
- **Standards-based:** WebComponents are the web platform, not a framework
- **Timeline:** ZERO impact (Phase 3 hasn't started yet)

**Fit assessment:** All 8 dimensions rated positive (SignalR excellent, bundle size decisive advantage, routing good enough). Risks all low with documented mitigations.

**Wash's Counter-Recommendation:** ⚠️ **RECOMMEND REACT** (see Wash's history for rationale)

**Decision Status:** Pending. Both evaluations recorded in `.squad/decisions.md` under "Lit HTML + WebComponents vs React — Team Evaluation" with status "Pending — awaiting user decision." Marek must choose based on project priorities (bundle size/standards vs ecosystem maturity/developer velocity).

### Lit Follow-up After Wash Pushback (2026-03-17)

Re-ran the Lit vs React decision against current public docs and current ecosystem evidence after Wash challenged the original recommendation.

**Corrections to my earlier call:**
- `@vaadin/router` is officially **deprecated** and **no longer actively maintained** — my earlier "mature, battle-tested" description was outdated and wrong for a new-project recommendation.
- `@lit-labs/router` is still a **Lit Labs** package with explicit warnings that it may receive breaking changes or be retired.
- Tailwind + Lit is **possible**, but only by either injecting built Tailwind CSS into component styles or rendering some components in light DOM, both of which add decision/setup cost.
- Lit testing is **capable** (`Web Test Runner`, `WebdriverIO`, `@open-wc/testing`, `@lit-labs/testing`), but React still has the more cohesive default path for a Tailwind-heavy SPA team.
- SignalR + Lit is technically straightforward because the SignalR client is framework-agnostic, but real-world examples are noticeably thinner than React.

**Updated recommendation:** For SharedSpaces specifically, keep **React** for the main SPA. Lit remains interesting for future isolated widgets or embeddable components, but it is no longer the pragmatic default for issue #23 once routing maturity and Tailwind delivery speed are weighted properly.

### Marek's Final Decision: Lit HTML + WebComponents (2026-03-17)

**Status:** ✅ **APPROVED — Lit HTML + WebComponents is the canonical choice for SharedSpaces SPA.**

After reviewing both team evaluations, Marek made the final decision: **switch to Lit HTML + WebComponents** for the Phase 3 client implementation.

**Key Insight:** The single-view app design (no routing beyond /join → /space/:spaceId) eliminates routing as a concern. With routing out of the way, Lit's advantages (40% smaller bundle, standards-based, native SignalR integration, light DOM + Tailwind) decisively outweigh React's ecosystem maturity.

**Actions Taken:**
1. Updated GitHub issue #23 with new title and acceptance criteria
2. Added decision comment to issue #23
3. Updated squad team docs (team.md, agents/wash/charter.md, routing.md)
4. Updated Wash's charter to reflect Lit expertise instead of React
5. Created decision document: `.squad/decisions/inbox/mal-lit-approved.md`

**Implications for Wash:**
- Wash's role remains unchanged (Frontend Dev)
- Expertise now: Lit, TypeScript, Vite, SignalR client, light DOM + Tailwind, responsive SPA design
- Same component ownership; different framework
- Vitest Browser Mode + Playwright for testing (instead of React Testing Library)

**Timeline:** Zero impact — Phase 3 hasn't started. Kaylee and Zoe are still completing Phase 1 and 2.

### Friction Research Follow-up (2026-03-17 13:36)

Marek asked both Mal and Wash to dive deeper into friction points to resolve the architectural split. After independent research, both agents converged on the same recommendation.

**Key findings:**
- `@vaadin/router` is deprecated; `@lit-labs/router` is still experimental Labs package
- Tailwind + Shadow DOM friction is real but workable (light DOM, CSS injection, tokens)
- Testing ecosystem gap has narrowed (Vitest Browser Mode + Playwright is credible)
- SignalR integration is framework-agnostic; React wins on example ecosystem, not capability
- Routing remains the weak point in the Lit story; all other concerns are manageable trade-offs

**Final recommendation:** Keep **React** for the main SharedSpaces SPA. Both agents agree this minimizes friction while maintaining shipping velocity. Lite remains viable for future isolated components with understood constraints.

**Status:** Decision documented in `.squad/decisions.md` as "Pending — awaiting user decision" with team consensus noted.

### Wash's Lit Client Bootstrap Complete (2026-03-18)

**Status:** ✅ Issue #23 completed successfully.

**Deliverables:**
- `src/SharedSpaces.Client/` bootstrapped with Vite + Lit + TypeScript
- Tailwind CSS v4 (light DOM)
- Vertical slice architecture (features/join, features/space-view, features/admin, components/, lib/)
- App shell with state-based view switching
- ESLint + Prettier + `@lit/context` for runtime config
- All validations passed (dev server, lint, build, .NET tests)

**Branch:** `squad/23-lit-vite-setup` (commit 2a493e7)

**Impact:** Frontend infrastructure now ready for feature development. Client framework and tooling are stable and can accept HTTP requests to backend APIs. Mal can now proceed with any frontend-backend integration planning.

### Issue #42 Research: Web Share Target API (2026-03-19)

**Status:** ✅ Research complete — queuing for Marek decision

**What is Web Share Target?**

The Web Share Target API lets installed PWAs appear in the OS share picker (like a native app). When a user shares content from another app, SharedSpaces can register as a target. The browser sends a POST request to a `/share-target/` endpoint with the shared content (files, text, links).

**Key Technical Facts:**
- Requires app to be **installed** (PWA with manifest + service worker)
- Browser support: ✅ Chrome 76+ (Android), Chrome 89+ (desktop), Edge 79+ | ❌ Safari, Firefox
- Flow: OS share picker → `/share-target/` POST → service worker intercepts → forward to server or foreground
- Shared data arrives as multipart form data; service worker must handle it
- **Critical blocker:** Requires service worker (Phase 5 #28, not yet done)

**Current SharedSpaces Status:**
- ❌ No `manifest.json` in client
- ❌ No PWA icons (192px, 512px PNG)
- ❌ No service worker
- ⚠️ HTTPS only in production (Phase 5 #29)
- Technically feasible; fit naturally into Phase 5 offline + polish work

**Architecture Decisions Needed:**

1. **Authentication model:** Does shared content go to pre-existing space (user must be member) or new space?
2. **Data flow:** Service worker forwards POST to backend, or parse in foreground?
3. **File types:** Accept all (`*/*`) or restrict MIME types?
4. **UX after share:** Auto-navigate to space, toast, or silent?
5. **Mobile priority:** Android-first, or include iOS fallback strategies?
6. **Phase timing:** Batch with Phase 5 (#28–#30), or prioritize separately?

**Scope (MVP):**
- Create manifest with `share_target` declaration
- Add 192px + 512px app icons
- Register service worker to intercept `/share-target/` POST
- Forward shared content to backend (new endpoint TBD) or existing upload flow
- Redirect user to space view

**Open Questions for Marek:**
All 6 architecture decisions listed above require user input before implementation. Full research documented in `.squad/decisions/inbox/mal-share-target-research.md` with options, pros/cons, and recommendations.

**Next Steps:**
1. Marek answers open questions
2. Reassign to Kaylee (backend) + Wash (frontend) for parallel work
3. Integrate with Phase 5 timeline or reprioritize
4. Create backend endpoint for share intake (if needed)

**Resources:**
- Web Share Target spec: https://web.dev/web-share-target/
- PWA install criteria: https://web.dev/install-criteria/
- Shared service worker concern: Phase 5 #28 owns offline; Share Target adds fetch handler

### README Rewrite: From Architecture Doc to User-Facing README (2026-03-19)

**Status:** ✅ Complete

**Task:** Rewrote README.md from an architecture/implementation plan into a proper user/developer-facing project README.

**Key Changes:**
1. **Replaced architecture doc with user guide** — Removed domain model tables, JWT claims structure, implementation phases, and security considerations
2. **Added project value prop** — Clear tagline, 2-3 paragraph description explaining what SharedSpaces is and who it's for
3. **Added screenshots** — Included `home--desktop.png` and `space--desktop.png` with relative paths from repo root
4. **Updated tech stack** — Corrected client from "React SPA" to "Lit HTML + Web Components, TypeScript, Vite, Tailwind CSS v4" (reflects actual implementation)
5. **Added Getting Started section** — Prerequisites, dev server setup, build commands for both server and client
6. **Kept project structure** — Updated to reflect Lit client (features/, components/, lib/) instead of React hooks
7. **Preserved architecture summary** — Kept decoupled server/client architecture explanation at the end
8. **No LICENSE section** — No LICENSE file exists in repo

**Writing Decisions:**
- Kept it scannable: short paragraphs, bullet lists, clear headings
- "Anonymous by design" value prop emphasized — no accounts, no tracking
- Self-hosting as primary use case (SQLite, local filesystem, zero cloud dependencies)
- Multi-server support called out as differentiator
- Moved deep architecture details to implied `/docs` location

**Verified Against Reality:**
- Client uses Lit HTML + Web Components (NOT React) — confirmed from `.squad/agents/mal/history.md` decision log
- Screenshots exist in `docs/screenshots/`
- Tech stack matches actual implementation (.NET 10, SQLite, SignalR, JWT)

### CLI Config vs JWT Claims Analysis (PR #121 Review)

**Context:** Marek asked on PR #121 whether CliConfig fields are redundant with JWT claims.

**JWT Claims in SharedSpaces tokens** (from `Features/Tokens/TokenEndpoints.cs` and `JwtAuthenticationExtensions.cs`):
- `sub` — member ID (GUID)
- `display_name` — member's display name
- `server_url` — server URL
- `space_id` — space UUID
- `space_name` — space name

**CliConfig SpaceEntry fields vs JWT:**
- `SpaceId` — ✅ redundant (in JWT as `space_id`)
- `ServerUrl` — ✅ redundant (in JWT as `server_url`)
- `DisplayName` — ✅ redundant (in JWT as `display_name`)
- `JwtToken` — must be stored (it IS the credential)
- `JoinedAt` — must be stored (NOT in JWT; no `iat` claim is set)

**Recommendation:** Config can be reduced to `JwtToken` + `JoinedAt`. Other fields parsed from JWT at runtime. Trade-off: requires JWT parsing dependency in Cli.Core, but ensures single source of truth and prevents config/token drift.

**Key file paths:**
- JWT generation: `src/SharedSpaces.Server/Features/Tokens/TokenEndpoints.cs` (CreateToken method)
- Claim type constants: `src/SharedSpaces.Server/Features/Tokens/JwtAuthenticationExtensions.cs` (SpaceMemberClaimTypes)
- CLI config model: `src/SharedSpaces.Cli.Core/Models/CliConfig.cs`
