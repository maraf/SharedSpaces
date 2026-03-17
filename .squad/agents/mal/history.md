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
