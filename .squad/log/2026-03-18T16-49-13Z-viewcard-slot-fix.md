# Session: view-card light DOM slot fix

**Date:** 2026-03-18T16:49:13Z  
**Agent:** Wash (Frontend Dev)  
**Task:** Fix view-card slot bug in light DOM  
**Files Modified:** 4 (view-card.ts, admin-view.ts, join-view.ts, space-view.ts)  
**Status:** ✅ Complete

### Change Summary

Replaced `<slot></slot>` pattern with property-based `.body` template binding. Light DOM components cannot rely on slots; must use properties for dynamic content.

### Validation

- Lint: ✅ Pass
- Build: ✅ Pass
- Commit: `6e5c13a`

### Decision

BaseElement-based components must use property-driven templates for composition, not slots.
