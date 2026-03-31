# Kebab Menu: Mobile Action Overflow Pattern

**Date:** 2026-03-31  
**Author:** Wash (Frontend Dev)  
**Issue:** #152

## Decision

Mobile (< 640px) shows only the **primary action button** plus a **kebab menu (⋮)** that consolidates secondary actions. Desktop (≥ 640px) remains unchanged with all buttons inline.

## Pattern

- **Responsive split:** `hidden sm:flex` for desktop buttons, `flex sm:hidden` for mobile layout
- **Primary actions:** Copy (text items), Download (file items) — always visible
- **Kebab contains:** Manage Links, Send To (conditional), Delete (with divider)
- **State:** Single `openMenuItemId` reactive property — only one menu open at a time
- **Dismissal:** Click outside (`data-kebab-menu` attribute check), Escape key, or selecting an action
- **Delete flow:** Kebab menu closes, then standard delete confirmation overlay appears

## Rationale

Four inline icon buttons on a 390px viewport caused cramped touch targets and visual clutter. The kebab pattern keeps the most-used action instantly accessible while consolidating less-frequent actions behind one tap.

## Impact

- Establishes the kebab overflow pattern for future mobile action menus
- No changes to existing button render methods or desktop layout
- Delete confirmation flow unchanged on both mobile and desktop
