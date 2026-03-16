# Project Context

- **Owner:** Marek Fišera
- **Project:** SharedSpaces — A self-hostable web platform where users join shared spaces via QR code/URL+PIN, share files and text in real-time, with anonymous identity and JWT-based access.
- **Stack:** .NET (ASP.NET Core Web API), React SPA (Vite), SignalR (WebSocket), SQLite + EF Core, JWT auth
- **Created:** 2026-03-16

## Core Context

### Client Architecture
- React SPA built with Vite — independently deployable
- Can connect to any SharedSpaces server by URL
- A single client instance may connect to multiple servers simultaneously
- JWT stored in local storage per server+space combination

### Key Client Flows
- Join flow: parse invitation string or QR URL → display name input → exchange PIN for JWT
- Multi-server: JWT claims contain server_url and space_id — client manages multiple connections
- Space view: flat list of items ordered by SharedAt, text/file upload
- SignalR: connect to /v1/hubs/space/{spaceId} for live item updates (new/deleted)

### Project Structure (Client)
- src/SharedSpaces.Client/src/
  - features/ — join, space-view, admin
  - components/ — shared UI components
  - hooks/ — useSignalR, useOfflineQueue
  - main.tsx

## Learnings

<!-- Append new learnings below. Each entry is something lasting about the project. -->
