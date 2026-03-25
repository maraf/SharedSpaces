# SharedSpaces CLI

A command-line tool for interacting with [SharedSpaces](https://github.com/nicka-fi/SharedSpaces) servers — join spaces and upload files from your terminal.

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
sharedspaces join "https://app.example.com/?join=https%3A%2F%2Fserver.example.com%7C550e8400%7C123456"

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

## Config

Tokens are stored in `~/.sharedspaces/config.json`. Each entry contains only the JWT — all metadata (space ID, server URL, display name) is extracted from the token's claims at runtime.

```json
{
  "spaces": [
    { "jwtToken": "eyJ..." }
  ]
}
```
