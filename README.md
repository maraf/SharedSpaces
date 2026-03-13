# SharedSpaces — Architecture & Implementation Plan

## Concept Summary

A self-hostable (or managed) web platform where users can join **shared spaces** via a URL+PIN pair, share files/content in real-time, with anonymous identity (display name only), token-based access, and WebSocket-driven live updates.

---

## Tech Stack

- **Server:** .NET (ASP.NET Core) — minimal API or controller-based
- **Client:** React (SPA, web-only) — good ecosystem, works well with WebSockets and PWA/offline support
- **Real-time:** ASP.NET Core SignalR (WebSocket abstraction)
- **Database:** SQLite (self-host friendly, zero-config) with EF Core; swappable to PostgreSQL for managed instances
- **File storage:** Local filesystem (self-host) with abstraction layer for future cloud storage

---

## Core Domain Model

### SharedSpace
| Field | Type | Notes |
|---|---|---|
| `Id` | GUID | |
| `Name` | string | |
| `StorageQuotaBytes` | long | |
| `CreatedAt` | datetime | |
| `TTL` | datetime? | optional expiry |

### SpaceInvitation (PIN)
| Field | Type | Notes |
|---|---|---|
| `Id` | GUID | |
| `SpaceId` | GUID | FK → SharedSpace |
| `Pin` | string | one-time, no expiry |
| `IsUsed` | bool | |
| `CreatedAt` | datetime | |

### SpaceToken (session credential)
| Field | Type | Notes |
|---|---|---|
| `Id` | GUID | |
| `SpaceId` | GUID | FK → SharedSpace |
| `DisplayName` | string | set at join time |
| `TokenValue` | string | opaque string, like a JWT or random GUID |
| `CreatedAt` | datetime | |
| `IsRevoked` | bool | |

### SpaceItem (shared content)
| Field | Type | Notes |
|---|---|---|
| `Id` | GUID | |
| `SpaceId` | GUID | FK → SharedSpace |
| `TokenId` | GUID | who shared it |
| `SharedAt` | datetime | |
| `ContentType` | string | text/file |
| `Content` | string | text or file reference |
| `TTL` | datetime? | optional expiry |

---

## Key Flows

### 1. Joining a Space
1. User visits `{server-url}` and enters URL+PIN (or scans QR)
2. Server validates PIN → marks it used → issues a `SpaceToken` (opaque value stored in browser)
3. User picks a display name → associated with their token

### 2. Service Account / Admin
A privileged role that can:
- Create spaces (set quota, optional TTL)
- Generate invitation PINs (batch or one-off)
- Revoke tokens (by display name or token ID)
- Remove space items

### 3. Sharing Content
- Text or file upload, stored with `SharedAt` + token reference
- Per-space storage quota enforced on upload
- Flat list, ordered by `SharedAt`

### 4. Real-time Updates
- SignalR hub per space (`/hubs/space/{spaceId}`)
- On new item → broadcast to all connected tokens in that space
- On token revocation → disconnect that client

### 5. Offline Support (future-friendly)
- Client caches loaded items in IndexedDB
- Service Worker intercepts uploads → queues them if offline → background sync when reconnected

---

## Project Structure

```
SharedSpaces/
├── src/
│   ├── SharedSpaces.Server/          # ASP.NET Core Web API + SignalR
│   │   ├── Domain/                   # Entities, value objects
│   │   ├── Features/                 # Vertical slice: Spaces, Tokens, Items, Admin
│   │   ├── Infrastructure/           # EF Core, file storage, SignalR hub
│   │   └── Program.cs
│   └── SharedSpaces.Client/          # React SPA (Vite)
│       └── src/
│           ├── features/             # join, space-view, admin
│           ├── components/
│           ├── hooks/                # useSignalR, useOfflineQueue
│           └── main.tsx
├── tests/
│   ├── SharedSpaces.Server.Tests/
│   └── SharedSpaces.Client.Tests/
└── docker-compose.yml                # For self-hosting
```

---

## Implementation Phases

### Phase 1 — Core Server
- Solution scaffold (`.sln`, projects, EF Core + SQLite)
- Domain entities + migrations
- Admin endpoints: create space, generate PINs
- Join endpoint: validate PIN → issue token
- Items endpoints: list, upload (text + file), enforce quota

### Phase 2 — Real-time
- SignalR hub: join space group, broadcast new items
- Token revocation via hub (force-disconnect)

### Phase 3 — React Client
- Vite + React scaffold
- Join flow (URL+PIN input or QR scan)
- Space view: flat item list, file/text upload
- SignalR client integration for live updates

### Phase 4 — Admin UI
- Simple admin panel: space management, PIN generation, token revocation

### Phase 5 — Offline & Polish
- Service Worker + IndexedDB for offline read/write queue
- Docker Compose for self-hosting
- QR code generation for URL+PIN pairs

---

## Security Considerations

- Tokens are opaque random values (not JWTs) — no private key material to manage
- PINs are one-time use; single-use enforcement is atomic (DB transaction / optimistic concurrency)
- Per-space storage quota prevents abuse
- Admin endpoints protected by a separate admin secret/token
- HTTPS enforced in production (standard ASP.NET Core middleware)

