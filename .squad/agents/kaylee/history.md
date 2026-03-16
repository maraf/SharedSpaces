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
- SignalR hub: /v1/hubs/space/{spaceId}

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
