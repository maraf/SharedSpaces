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
