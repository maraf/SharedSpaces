# Zoe background sync test coverage decision (2026-04-04)

## Context
The background-sync worker now depends on a service-worker-readable token store, but existing users may still only have JWTs in `localStorage`. We also need a clear regression line between permanent sync failures and retryable ones.

## Decision
1. Legacy token migration stays lazy and transparent. Test coverage assumes `localStorage` remains the compatibility source, while reads and writes mirror tokens into IndexedDB `auth-tokens` for service worker use.
2. Only permanent auth and validation failures are dropped. The queue should remove true 4xx rejections, but keep network failures, `5xx`, and backoff-style statuses (`408`, `425`, `429`) for retry.
3. Cover worker sync at the shared helper seam. `processAllOfflineQueues()` is the right client-level test seam because it validates multi-space token lookup and queue draining without a brittle service-worker harness.

## Rationale
- Prevent silent regressions for already-joined users after the token-store migration.
- Lock in retry semantics so transient server issues do not delete queued shares.
- Keep tests robust and fast while still verifying the important contract the service worker depends on.

## Coverage added
- `src/SharedSpaces.Client/src/lib/token-storage.test.ts`: token mirroring, legacy migration, mirrored removal
- `src/SharedSpaces.Client/src/lib/idb-storage.test.ts`: IndexedDB mirror storage helpers
- `src/SharedSpaces.Client/src/lib/offline-sync.test.ts`: shared sync helper path, background-sync request, retry vs permanent failure semantics
- `src/SharedSpaces.Client/src/lib/sw-registration.test.ts`: service worker registration lookup failure fallback
