# SharedSpaces CLI

A command-line tool for interacting with [SharedSpaces](https://github.com/maraf/SharedSpaces) servers — join spaces, list them, upload files, and sync folders from your terminal.

## Install

```bash
dotnet tool install --global SharedSpaces.Cli
```

## Commands

### `sharedspaces join`

Join a space by exchanging an invitation PIN for an access token.

```bash
# Using a full invitation string (serverUrl|spaceId|pin)
sharedspaces join "https://server.example.com|550e8400-e29b-41d4-a716-446655440000|123456"

# Using a client invite URL
sharedspaces join "https://app.example.com/?join=https%3A%2F%2Fserver.example.com%7C550e8400-e29b-41d4-a716-446655440000%7C123456"

# PIN provided separately
sharedspaces join "https://server.example.com|550e8400-e29b-41d4-a716-446655440000" --pin 123456

# With a custom display name
sharedspaces join "https://server.example.com|550e8400-e29b-41d4-a716-446655440000|123456" --display-name "Alice"
```

### `sharedspaces upload`

Upload a file to a space you have already joined.

```bash
sharedspaces upload myfile.txt --space-id 550e8400-e29b-41d4-a716-446655440000
```

The access token for the space is read automatically from the local config stored during `join`.

### `sharedspaces spaces`

List all joined spaces. Also available as `sharedspaces list`.

```bash
# Formatted table output
sharedspaces spaces

# Machine-readable JSON output
sharedspaces spaces --json
```

### `sharedspaces items`

List all items in a space.

```bash
# Formatted table output
sharedspaces items --space-id 550e8400-e29b-41d4-a716-446655440000

# Machine-readable JSON output
sharedspaces items --space-id 550e8400-e29b-41d4-a716-446655440000 --json
```

### `sharedspaces sync`

Sync files from a space to a local folder. By default, downloads existing files and then watches for changes in both directions in real-time. A [passive mode](#passive-mode) is also available for periodic, low-bandwidth syncing.

```bash
sharedspaces sync --space-id 550e8400-e29b-41d4-a716-446655440000 --folder ~/shared
```

Options:

| Option | Required | Description |
| --- | --- | --- |
| `--space-id <guid>` | yes | ID of the space to sync from |
| `--folder <path>` | yes | Local folder for synced files (created if missing) |
| `--passive` | no | Skip the SignalR hub and poll the journal on a fixed interval. See [Passive mode](#passive-mode). |
| `--interval <seconds>` | no | Passive poll interval. Default `300`, minimum `5`. Only valid with `--passive`. |

The default (active) sync engine:

- **Downloads** all existing files on startup
- **Streams** new files and deletions in real-time via SignalR
- **Uploads** new files added to the local folder automatically
- **Falls back** to HTTP polling when the WebSocket connection drops
- **Reconnects** automatically with exponential backoff

Press `Ctrl+C` to stop syncing.

#### Passive mode

For use cases that don't need real-time updates (e.g., periodic snapshots, low-bandwidth or offline-mostly scenarios), pass `--passive` to skip the SignalR hub and pull the journal on a fixed interval instead:

```bash
# Default: pull journal every 5 minutes
sharedspaces sync --space-id <guid> --folder ~/shared --passive

# Custom interval (seconds, minimum 5)
sharedspaces sync --space-id <guid> --folder ~/shared --passive --interval 60
```

In passive mode:

- **No SignalR connection** is opened.
- The journal is fetched once at startup and again on every tick at `--interval` seconds (default `300`).
- Local file uploads still happen immediately via the file watcher — only inbound changes are delayed.
- `--interval` is only valid together with `--passive`.

## Config

Tokens are stored in `~/.sharedspaces/config.json`. Each entry contains only the JWT — all metadata (space ID, server URL, display name) is extracted from the token's claims at runtime.

```json
{
  "spaces": [
    { "jwtToken": "eyJ..." }
  ]
}
```