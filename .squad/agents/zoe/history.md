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

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
