# Kaylee: Hub route change

Requested by: Marek Fišera
Date: 2026-03-17

## Decision
Change the SignalR hub route from `/v1/hubs/space/{spaceId}` to `/v1/spaces/{spaceId}/hub`.

## Why
This aligns the hub endpoint with the rest of the API surface, where space-scoped resources live under `/v1/spaces/{spaceId}/...`.

## Implementation notes
- Updated `HubEndpoints` to map `SpaceHub` at `/v1/spaces/{spaceId}/hub`.
- Updated JWT query-string token extraction to recognize SignalR hub requests under `/v1/spaces/...` for both the hub endpoint and the negotiate endpoint.
- Updated `SpaceHubTests.CreateHubConnection` to use the new route.
- Refreshed the README route example to match the implementation.

## Validation
- `dotnet build SharedSpaces.sln --nologo`
- `dotnet test SharedSpaces.sln --nologo`
