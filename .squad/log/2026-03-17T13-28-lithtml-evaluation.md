# Session Log: Lit HTML vs React Evaluation

**Date:** 2026-03-17 13:28  
**Requested By:** Marek Fišera  
**Context:** GitHub issue #23 — Framework choice for SharedSpaces client SPA  
**Status:** Complete — Team Split Verdict

## Summary

Marek requested team feedback on switching from React to Lit HTML + WebComponents for the SharedSpaces client. The team spawned two background evaluations:

1. **Mal (Lead/Architect)** → Recommends **APPROVE** the Lit switch
2. **Wash (Frontend Dev)** → Recommends **STICK WITH REACT**

Both evaluations are comprehensive and document distinct perspectives: architectural fit vs developer velocity/tooling maturity.

## Key Split Points

| Dimension | Mal's Take | Wash's Take |
|-----------|-----------|-----------|
| Routing | Good enough (Vaadin) | Major red flag (deprecated/experimental) |
| Tailwind + Shadow DOM | Not addressed | Dealbreaker |
| Testing Ecosystem | Adequate for SharedSpaces | Fragmented and slower than React |
| Developer Velocity | Good (20%+ faster startup) | Bad (30% lost to tooling friction) |
| Timeline | Zero impact (Phase 3 not started) | Risk if routing immature |
| Bundle Size | 40% savings significant | Nice-to-have, not critical |

## Decision Required

This is a **genuine architectural disagreement** with supporting evidence on both sides. Marek must decide whether to:
- Prioritize bundle size, architectural purity, and standards (Mal's case → Lit)
- Prioritize routing maturity, Tailwind integration, testing ecosystem (Wash's case → React)

Both evaluations are recorded in `.squad/decisions/inbox/` pending merge.

## Deliverables

- ✅ `.squad/orchestration-log/2026-03-17T13-28-mal.md` — Mal's brief outcome summary
- ✅ `.squad/orchestration-log/2026-03-17T13-28-wash.md` — Wash's brief outcome summary
- ✅ `.squad/decisions/inbox/mal-lithtml-evaluation.md` — Full technical proposal (Lit)
- ✅ `.squad/decisions/inbox/wash-lithtml-evaluation.md` — Full technical proposal (React)
