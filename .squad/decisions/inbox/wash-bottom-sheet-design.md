# Decision: Bottom Sheet for Mobile Space Navigation

**Author:** Wash (Frontend Dev)
**Date:** 2026-03-22
**Issue:** #99 — Space pills and admin button wrapping on mobile

## Context

After researching 4 variants (horizontal scroll, two-row, admin-in-title, compact pills), Marek chose the **bottom sheet** pattern for mobile space navigation. This replaces the wrapping pill bar on mobile with a fixed bottom bar + slide-up sheet.

## Decision

### Marek's Requirements:
1. **Desktop (≥640px):** No changes — existing pill layout stays as-is
2. **Mobile (<640px):** Fixed bottom bar (active space name) → bottom sheet (all spaces)
3. **Join button:** Inside the sheet (not prime real estate)
4. **Admin button:** In the header title row on mobile

### Implementation:
- Desktop nav wrapped in `hidden sm:flex` — completely unchanged layout
- Mobile bottom bar: `fixed bottom-0 sm:hidden`, shows active space + connection dot + chevron
- Bottom sheet: CSS transform slide-up animation (0.3s), rounded top corners, scrollable list
- Admin button duplicated: title row (`sm:hidden`) + pill nav (`hidden sm:flex`)
- `pb-20 sm:pb-6` on container for bottom bar clearance
- Body scroll lock when sheet is open
- Backdrop with opacity transition closes sheet on tap

## Status

Implementation on branch `squad/99-pill-wrapping-research`. Screenshots posted to issue #99. Awaiting Marek's review before merge.

## Impact

- Resolves mobile wrapping issue for any number of spaces
- Thumb-reachable interaction pattern for mobile users
- Desktop experience completely unchanged
