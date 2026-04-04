# Implementation Notes: Large Space Mode (Issue #157 - First Slice)

## What Was Implemented

This first shippable slice adds **web-only** large space mode with journal-based sync:

### Core Features
1. **Opt-in Toggle UI** - Added a "Large Space Mode" toggle in the space view that allows users to enable/disable journal sync per space
2. **Local Preference Storage** - Settings stored in IndexedDB, scoped by `serverUrl|spaceId`
3. **Journal Sync Flow** - When enabled, startup follows this sequence:
   - Load cached items from IndexedDB
   - Fetch journal delta from server (`GET /journal`)
   - Apply additions/deletions to cached items
   - Update checkpoint (`POST /journal/checkpoint`)
   - Start SignalR connection
4. **Full Sync Fallback** - If server indicates `fullSyncRequired`, falls back to standard `GET /items`
5. **Cache Maintenance** - Local cache updated when items are added/deleted via SignalR
6. **Existing Behavior Preserved** - Non-opted-in spaces continue to use the original full-fetch approach

### Files Modified
- `src/SharedSpaces.Client/src/lib/idb-storage.ts` - Added journal sync settings and cache stores (DB v2)
- `src/SharedSpaces.Client/src/features/space-view/space-api.ts` - Added `getJournal()` and `updateJournalCheckpoint()` API calls
- `src/SharedSpaces.Client/src/features/space-view/space-view.ts` - Implemented journal sync logic and UI toggle
- Test files - Added 19 new tests covering settings, cache, and API calls

### Testing
- All 644 tests pass (added 19 new tests)
- Unit tests cover:
  - Journal sync settings (get/set/scope)
  - Journal cache (get/set/clear/scope)
  - Journal API calls (getJournal, updateJournalCheckpoint)
  - Error handling and network failures

## What Was Intentionally Left Out (Future Slices)

1. **Background Sync Integration** - Not integrated with service worker background sync in this slice
2. **CLI Support** - Journal sync is web-only; CLI still uses full fetch
3. **Automatic Opt-in** - No logic to auto-enable for spaces over a certain size threshold
4. **Cache Eviction** - No cache size limits or eviction policy yet
5. **Migration Path** - No automatic migration for existing users
6. **Performance Metrics** - No telemetry to measure sync performance improvements

## UI Impact

A new toggle was added to the space view:
- Appears above the compose box
- Shows "Large Space Mode" label with description
- Toggle switch (off by default)
- Requires reload when toggled (automatic)

**Note:** Screenshots in `docs/screenshots/` should be regenerated to reflect the new UI element. Run the Playwright screenshot suite after starting both server and client:
```bash
# From repository root
npm run screenshots
```

## Server Requirements

Uses existing journal endpoints:
- `GET /v1/spaces/{spaceId}/journal` - Returns delta since last checkpoint
- `POST /v1/spaces/{spaceId}/journal/checkpoint` - Acknowledges sync up to a timestamp

No server changes were required for this slice.

## Browser Compatibility

- Requires IndexedDB support
- Gracefully falls back to full fetch if IndexedDB unavailable
- Works in all modern browsers (Chrome, Firefox, Safari, Edge)

## Known Limitations

1. **First Load** - On first opt-in, performs a full fetch (no cache exists yet)
2. **Stale Cache** - If journal has been pruned on server, performs full sync
3. **No Conflict Resolution** - Assumes journal delta is authoritative
4. **No Offline Mode** - Journal sync requires network; offline queue is separate

## Next Steps (Suggested)

1. Add automatic opt-in for spaces with >100 items
2. Integrate with Background Sync for offline-first scenarios
3. Add cache eviction policy (e.g., LRU, size-based)
4. Add performance telemetry to measure impact
5. Consider CLI support for journal sync
6. Add UI indicator showing cache age/staleness
