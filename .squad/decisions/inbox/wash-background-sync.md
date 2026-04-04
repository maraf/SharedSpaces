# Background Sync Token Mirroring

**Date:** 2026-04-04
**Author:** Wash
**Status:** Implemented

## Decision

For offline queue uploads, the client now keeps the existing `localStorage` token format for app behavior **and** mirrors those tokens into IndexedDB so the service worker can authenticate `sync` event uploads even when no tabs are open.

## Why

- `localStorage` is unavailable inside the service worker.
- The previous `sync` flow depended on an open client tab to do the upload work.
- Marek explicitly asked for a migration path so existing users keep working without rejoining spaces.

## Outcome

1. **No server changes required** — uploads still use the existing authenticated `PUT /v1/spaces/{spaceId}/items/{itemId}` endpoint.
2. **Backward compatible migration** — any legacy tokens still living only in `localStorage` are mirrored automatically on normal client startup/access.
3. **Retry semantics preserved** — successful uploads are removed, permanent auth/validation failures are dropped, transient failures stay queued for a later retry.
4. **Open clients stay fresh** — the service worker posts sync completion messages so `space-view` refreshes queued counts and item lists.
