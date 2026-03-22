# Decision: Mobile Members Modal — Stacked Layout

**Author:** Wash
**Date:** 2026-03-21
**Context:** Issue #92 / PR #97 — mobile admin members modal was messy at 390×844

## Problem
On mobile (390×844), member rows in the admin modal had name, REVOKED badge, join date, and action buttons all competing for horizontal space. Text wrapped unpredictably and buttons floated awkwardly next to wrapped text.

## Decision
Use Tailwind responsive classes to switch the member row from horizontal to vertical layout on mobile:
- **Mobile (<640px):** `flex-col` — member info stacks on top, buttons appear below, right-aligned via `self-end`
- **Desktop (≥640px):** `flex-row` — original horizontal layout preserved with `sm:flex-row sm:items-center sm:justify-between`

## Alternatives Considered
1. **CSS Grid with fixed columns** — More complex, harder to maintain with conditional button groups
2. **Custom breakpoint (~480px)** — Non-standard Tailwind breakpoint; `sm:` (640px) works fine since the modal content area on a 390px viewport is well below any reasonable threshold
3. **Truncating member info** — Loses information; stacking preserves all content

## Impact
- `admin-view.ts`: Changed Tailwind classes on member row div and button containers
- No new CSS or custom breakpoints needed
- Desktop layout unchanged
