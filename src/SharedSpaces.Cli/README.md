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

### `sharedspaces sync`

Sync files from a space to a local folder. Downloads existing files, then watches for changes in both directions in real-time.

```bash
sharedspaces sync --space-id 550e8400-e29b-41d4-a716-446655440000 --folder ~/shared
```

Both `--space-id` and `--folder` are required. The folder is created if it doesn't exist.

The sync engine:
- **Downloads** all existing files on startup
- **Streams** new files and deletions in real-time via SignalR
- **Uploads** new files added to the local folder automatically
- **Falls back** to HTTP polling when the WebSocket connection drops
- **Reconnects** automatically with exponential backoff

Press `Ctrl+C` to stop syncing.

## Config

Tokens are stored in `~/.sharedspaces/config.json`. Each entry contains only the JWT — all metadata (space ID, server URL, display name) is extracted from the token's claims at runtime.

```json
{
  "spaces": [
    { "jwtToken": "eyJ..." }
  ]
}
```
