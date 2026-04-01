# Playwright Screenshot Determinism

> **Problem:** E2E screenshot tests churn on every run due to dynamic timestamps and UUIDs, causing false visual-regression failures.
>
> **Pattern:** Screenshot determinism requires fixture determinism. Lock all test data to a fixed calendar date.

---

## The Problem

When you run Playwright E2E screenshot tests (`npx playwright test`), the captured images change every time because:

1. **Relative-time strings change monthly** — Components render `formatRelativeTime()` output ("Today", "Yesterday", "3d ago", "Mar 19") that depends on wall-clock time
   - On March 19: items show "Today"
   - On March 20: items show "Yesterday"
   - On March 26: items show "6d ago"
   - On April 2: items show "Mar 19"
   
2. **Full timestamps drift daily** — Admin view displays `.toLocaleString()` for space creation dates and member join dates
   - "3/19/2025, 2:47:12 PM" on test run 1
   - "3/20/2025, 3:15:44 PM" on test run 2
   - **Text width changes** → layout reflow → pixel-perfect diff fails

3. **UUIDs are fresh on every seed** — Invitation IDs and space IDs regenerate with `crypto.randomUUID()` on each test setup
   - Low visual impact (monospace, fixed-width) but causes diff noise

---

## Why This Matters for Testing

Screenshot tests are **pixel-perfect regression detectors**. They catch:
- Text overflow (timestamp too long pushes button off-screen)
- Layout reflow (count "(8)" vs "(10)" changes text width)
- Alignment bugs (time column misalignment in admin modal)

But if the baseline changes every month due to relative-time drift, you get **false positives**:
```
❌ space-share-modal--desktop.png
   [timestamp relative time changed from "Today" to "Yesterday"]
   [baseline created: 2025-03-19]
   [test run: 2025-03-26]
```

This is **not a UI regression**—it's a fixture time problem. Noisy CI makes the signal useless.

---

## Current Churn Analysis

**File:** `.squad/decisions/inbox/zoe-screenshot-determinism.md`

**Affected screenshots (24 of 58):**
- **High risk:** admin-spaces, admin-members, admin-invitations (full `.toLocaleString()` dates)
- **Medium risk:** space, space-share-modal, space-text-modal, pending-shares (relative time strings)
- **Low risk:** shared-item-*, space-offline, space-dead-auth (UUIDs, cosmetic churn)

**Severity breakdown:**
- Tier 1 (high): 4 admin screenshots + 8 space screenshots = 12 monthly drift events
- Tier 2 (medium): 6 screenshots with relative-time strings = 30 daily variations
- Tier 3 (low): UUIDs only, minimal visual impact

---

## Solution: Deterministic Fixtures

Lock test data to a **fixed calendar date**. All items and members seed with known timestamps.

### Tier 1: Deterministic Seed Timestamps (Low Risk, ~30 min)

**File:** `src/SharedSpaces.Client/e2e/screenshots.spec.ts`

**Change:**
```typescript
async function seedSpace(name: string) {
  // BEFORE: dates generated on each test run
  // const space = await apiCall(`${SERVER_URL}/v1/spaces`, { ... });
  
  // AFTER: use fixed seed date (e.g., always 2025-03-19T12:00:00Z)
  const SEED_DATE = new Date('2025-03-19T12:00:00Z');
  
  const space = await apiCall(`${SERVER_URL}/v1/spaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
    body: JSON.stringify({ 
      name,
      // Optional: if API accepts createdAt in future, use SEED_DATE
    }),
  });

  // Seed items with predictable timestamps (staggered by 10 minutes each)
  for (let i = 0; i < itemContents.length; i++) {
    const itemTimestamp = new Date(SEED_DATE.getTime() + i * 10 * 60_000);
    // Items render with itemTimestamp as sharedAt
    // On March 19: all show "Today"
    // On March 26: all show "6d ago"
  }
}
```

**Impact:**
- ✅ Screenshots render on a fixed calendar day
- ✅ All relative times stable ("Today", "3d ago", etc.)
- ✅ No component code changes
- ✅ Captures real UI rendering (you see real timestamp output)
- ❌ Relative times still drift monthly when day rolls over

**Maintenance:** Re-baseline quarterly (or when month changes in the office).

**Example re-baseline:**
```bash
# On month rollover (1st of April):
# Old baseline from March 19 shows "6d ago" for items seeded March 19
# New baseline needed:
npx playwright test --update-snapshots
git add docs/screenshots/
git commit -m "test(e2e): re-baseline screenshots for April"
```

### Implemented server-backed pattern

When screenshots are seeded through the live API, keep determinism at the seed point instead of adding a dedicated test endpoint:

- Send optional `seededAt` values from `src/SharedSpaces.Client/e2e/screenshots.spec.ts`
- Honor them in the server only when the request includes a valid `X-Admin-Secret`
- Reuse a shared resolver at `src/SharedSpaces.Server/Features/Seeding/SeededTimestampResolver.cs`
- Apply the same pattern to every server-generated timestamp that is visibly rendered (`space.CreatedAt`, `member.JoinedAt`, `item.SharedAt`, `sharedLink.CreatedAt`)

This keeps production behavior unchanged for normal callers while making screenshot fixture data deterministic end-to-end.

---

### Tier 2: Mock Clock (Medium Risk, ~1–2 hours, Permanent)

**File:** `src/SharedSpaces.Client/playwright.config.ts`

**Change:**
```typescript
export default defineConfig({
  testDir: './e2e',
  // ... existing config ...
  use: {
    baseURL: 'http://localhost:5173',
    // NEW: use fake timers—freeze all Date.now() and new Date() to a fixed point
    // This makes formatRelativeTime() stable forever
  },
  // Add clock configuration:
  // Option A: Playwright's native clock (v1.45+)
  // Option B: Mock in test.beforeAll() with vi.useFakeTimers()
});
```

**Implementation (with `vi.useFakeTimers()`):**
```typescript
// In screenshots.spec.ts test.beforeAll():
test.beforeAll(async () => {
  // Freeze time at 2025-03-19T12:00:00Z
  const frozenTime = new Date('2025-03-19T12:00:00Z').getTime();
  vi.useFakeTimers();
  vi.setSystemTime(frozenTime);

  // All Date.now() and new Date() calls now return frozenTime
  const space1 = await seedSpace('Project Alpha');
  // ... rest of setup ...

  vi.useRealTimers(); // Restore if needed after seeding
});
```

**Impact:**
- ✅ Screenshots **never drift** (time is locked globally)
- ✅ Timezone-agnostic testing (CI always matches local)
- ✅ Catches time-dependent UI bugs
- ❌ Adds test setup complexity
- ❌ Requires careful async handling (some operations may not respect fake time)
- ❌ All timestamps are frozen—can't test "2 days in future" scenarios

**Maintenance:** Zero. Once set up, screenshots are stable forever.

---

### Tier 3 (Not Recommended): Screenshot Masking

**Don't do this.** Masking timestamps hides real UI bugs:
- Text overflow bugs in timestamp rendering
- Alignment issues in admin modals
- Truncation on narrow screens

Use masking only if timestamp content is **not** testable (e.g., you need to capture a modal but the modal's timestamp is server-generated and you can't control it). This isn't the case here.

---

## Implementation Checklist

### Phase 1: Deterministic Fixtures (Tier 1)
- [ ] Update `seedSpace()` in `screenshots.spec.ts` to use fixed seed date
- [ ] Ensure items are seeded with staggered timestamps (10-minute intervals)
- [ ] Run `npx playwright test --update-snapshots`
- [ ] Verify all 58 screenshots re-baseline without semantic changes
- [ ] Commit with message: `test(e2e): use deterministic timestamps in screenshot fixtures`
- [ ] Document: "Screenshots re-baseline quarterly or when month changes"

### Phase 2: Mock Clock (Tier 2, Optional)
- [ ] Add `vi.useFakeTimers()` to test.beforeAll()
- [ ] Verify no async operations break under fake time
- [ ] Run tests—expect screenshots to be identical to Phase 1 baseline
- [ ] Commit: `test(e2e): use frozen time for screenshot determinism`

### Ongoing Maintenance
- [ ] Add to `.squad/skills/playwright-screenshots/SKILL.md`: "Screenshots are stable via deterministic fixtures. Re-baseline first-of-month if relative times drift."
- [ ] Monitor grep for new `formatRelativeTime()`, `.toLocaleString()`, or `Date.now()` calls in components
- [ ] On any timestamp rendering change, apply same determinism discipline (fixed seed dates)

---

## Files to Monitor

| File | Pattern | Action |
|------|---------|--------|
| `src/SharedSpaces.Client/src/lib/format-time.ts` | Relative time logic | Verify doesn't change format (would invalidate baseline expectations) |
| `src/SharedSpaces.Client/src/features/admin/admin-view.ts` | `.toLocaleString()` (lines 914, 1055, 1120) | Lock to fixed seed dates in seedSpace() |
| `src/SharedSpaces.Client/src/features/space-view/space-view.ts` | `sharedAt`, `createdAt` rendering (lines 1700, 1747, 2051) | Ensure items seed with controlled timestamps |
| `src/SharedSpaces.Client/src/app-shell.ts` | Pending share timestamps (line 795–799) | Mock pending share creation times in test |
| `src/SharedSpaces.Client/e2e/screenshots.spec.ts` | Fixture seeding (lines 96–213) | **Primary control point** |

---

## Key Lessons

1. **You can't mock your way out of dynamic test data.** Timestamps must be locked at the source (seed time).

2. **Relative-time strings are user-friendly and intentional.** Don't remove them to "fix" screenshots. The fix is deterministic fixtures, not changed UX.

3. **UUID churn is cosmetic.** Because UUIDs are monospace and fixed-width, they don't cause layout reflow. Accept low-impact visual diffs.

4. **Monthly re-baselining is acceptable.** If mock clock is too complex, quarterly screenshot updates are reasonable maintenance cost.

5. **Screenshot testing catches real bugs.** Don't mask or hide dynamic content—it defeats the regression detector. Lock it down instead.

---

## Related Tasks

- [x] Screenshot determinism analysis complete (Zoe)
- [x] Implement Tier 1 fixtures via admin-gated `SeededAt` seeding in `screenshots.spec.ts`
- [x] Stabilize browser rendering with fixed Playwright locale/timezone + frozen `Date`
- [x] Document final approach in team decision log

## Implemented Pattern (2026-04-01)

The screenshot harness now uses the extended deterministic seeding path:

1. Send `seededAt` on API-backed fixture creation for spaces, token exchange, item uploads, and shared-link creation.
2. Include `X-Admin-Secret` whenever a seeded timestamp is supplied so the server accepts the override.
3. Freeze browser time with `page.addInitScript()` and pin Playwright `locale` / `timezoneId` so relative and absolute dates stay stable.

This keeps screenshots realistic (real server responses, real UI formatting) while removing timestamp drift from visual baselines.

---

**Last updated:** 2026-04-01 (Zoe)  
**Status:** Implemented and validated
