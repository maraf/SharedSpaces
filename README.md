# SharedSpaces

> A self-hostable web platform for real-time file and text sharing via QR code and PIN.

## About

**SharedSpaces** is a lightweight, anonymous collaboration tool that lets users join shared spaces with a simple QR code or PIN — no accounts, no tracking, no friction. Share files, text, and links in real-time with anyone in the space, all under a display name you choose.

The platform is built for **self-hosting** with minimal dependencies (SQLite, local filesystem) and clean architecture. The server is a pure API with no rendered UI. The client is a standalone web app that can connect to any server — including multiple servers simultaneously. Perfect for quick file drops, event collaboration, classroom sharing, or temporary project spaces.

Anonymous by design: users pick a display name when joining a space. No email, no registration, no persistent identity across spaces. When you're done, leave. When the space is deleted, everything is gone.

## Key Features

- **QR/PIN join** — Scan a code or enter a short PIN to join a space instantly
- **Real-time sync** — See files and messages appear live via WebSocket (SignalR)
- **Anonymous identity** — Display name only, no accounts or persistent profiles
- **Multi-server support** — Connect to multiple servers simultaneously from one client
- **Self-hostable** — SQLite database, local file storage, zero cloud dependencies
- **JWT-based access** — Secure, token-based authentication with no expiration
- **File + text sharing** — Upload files or post text snippets; quota enforced per space
- **Admin controls** — Create spaces, generate invitations, manage content

## Screenshots

**Home view** — Your spaces across multiple servers:

![SharedSpaces home view](docs/screenshots/home--desktop.png)

**Inside a space** — Real-time shared content:

![SharedSpaces space view with content](docs/screenshots/space--desktop.png)

## Tech Stack

- **Server:** .NET 10 (ASP.NET Core Web API)
- **Client:** Lit HTML + Web Components, TypeScript, Vite, Tailwind CSS v4
- **Real-time:** SignalR (WebSocket)
- **Database:** SQLite with EF Core (swappable to PostgreSQL)
- **Auth:** JWT (no expiration; validity = member existence)
- **Storage:** Local filesystem (abstracted for future cloud providers)

## Getting Started

### Prerequisites

- [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0)
- [Node.js 20+](https://nodejs.org/) (for client build)

### Development

1. **Clone the repository:**
   ```bash
   git clone https://github.com/maraf/SharedSpaces.git
   cd SharedSpaces
   ```

2. **Run the server:**
   ```bash
   cd src/SharedSpaces.Server
   dotnet restore
   dotnet run
   ```
   The API will be available at `https://localhost:5001` (or the port displayed in terminal).

3. **Run the client (in a separate terminal):**
   ```bash
   cd src/SharedSpaces.Client
   npm install
   npm run dev
   ```
   The client will be available at `http://localhost:5173`.

4. **Configure the client API endpoint:**
   - Set `VITE_API_BASE_URL` in your environment or `.env` file to point to the server (e.g., `https://localhost:5001`)

### Building for production

**Server:**
```bash
cd src/SharedSpaces.Server
dotnet publish -c Release -o ./publish
```

**Client:**
```bash
cd src/SharedSpaces.Client
npm run build
```

The built client will be in `dist/` and can be served by any static file host.

## Project Structure

```
SharedSpaces/
├── src/
│   ├── SharedSpaces.Server/          # ASP.NET Core Web API + SignalR
│   │   ├── Domain/                   # Entities, value objects
│   │   ├── Features/                 # Vertical slice: Spaces, Invitations, Tokens, Items, Admin
│   │   ├── Infrastructure/           # EF Core, file storage, SignalR hub
│   │   └── Program.cs
│   └── SharedSpaces.Client/          # Lit HTML + Web Components SPA
│       └── src/
│           ├── features/             # join, space-view, admin
│           ├── components/           # Reusable UI components
│           ├── lib/                  # SignalR client, API client, utilities
│           └── index.ts
├── tests/
│   ├── SharedSpaces.Server.Tests/
│   └── SharedSpaces.Client/e2e/      # Playwright tests
├── docs/
│   └── screenshots/                  # UI screenshots
└── SharedSpaces.sln
```

## Architecture

The server and client are **fully decoupled**. The server is a pure API with no UI. The client is a standalone SPA that connects to any server via its base URL. A single client instance can connect to multiple servers simultaneously, each with its own JWT token for authentication.

**Key design decisions:**
- **JWT tokens have no expiration** — validity is determined by the existence of a `SpaceMember` record and its `IsRevoked` flag
- **Invitation PINs are one-time use** — deleted immediately after a token is issued
- **Space item IDs are client-generated** — the client creates GUIDs and uses PUT/upsert semantics
- **Multi-server by default** — JWT claims include `server_url` so the client knows where to send requests

For detailed architecture, domain model, and API documentation, see the implementation notes in `/docs` (or explore the codebase — the code is the spec).

