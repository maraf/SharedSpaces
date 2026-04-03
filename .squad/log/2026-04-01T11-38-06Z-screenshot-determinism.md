# Session Log — Screenshot Determinism Initiative (2026-04-01)

**Date:** 2026-04-01  
**Duration:** Parallel background spawns across three agents  
**Topic:** Screenshot Determinism — Investigation & Recommendations  
**Team:** Wash (Frontend Dev), Zoe (Tester), Mal (Lead)

---

## Session Summary

Three-agent parallel investigation into Playwright screenshot test churn caused by dynamic content (timestamps, UUIDs, share URLs) changing on every test run.

**Outcome:** Unified recommendation for deterministic fixtures + frozen time mocking as near-term mitigation, with mock clock as permanent solution.

---

## Agents & Outputs

### Wash (Frontend Dev) — Screenshot Stabilization Analysis
- **Status:** Complete
- **Output:** `.squad/decisions/inbox/wash-screenshot-determinism.md`
- **Key Contribution:** Deep-dive on root causes (relative time rendering, dynamic UUIDs, share tokens) + 4 implementation strategies ranked by effort/impact
- **Recommendation:** Strategy 1 (Freeze Time) + Strategy 2 (Deterministic UUIDs) as Phase 1; estimated 2-3 hours, 80-90% churn reduction

### Zoe (Tester) — Screenshot Determinism Audit  
- **Status:** Complete
- **Output:** `.squad/decisions/inbox/zoe-screenshot-determinism.md`
- **Key Contribution:** Classified 12 churn sources into 3 tiers; identified 24 high-risk screenshots; proposed 3-phase mitigation sequence
- **Recommendation:** Phase 1 (30 min, 70% reduction) → Phase 2 (1-2 hours, 95% reduction)

### Mal (Lead) — Mitigation Strategy Alignment  
- **Status:** Complete
- **Output:** Orchestration log (no separate decision needed; summary below)
- **Key Contribution:** Cross-agent alignment, prioritized ladder, approved hybrid approach

---

## Unified Recommendation

**Mitigation Ladder (Approved):**

1. **Phase 1: Quick Win** (2-3 hours)
   - Freeze system time via `page.addInitScript()` in test beforeAll
   - Replace `crypto.randomUUID()` with fixed deterministic table
   - Achieves ~80% churn reduction
   - No component code changes

2. **Phase 2: Permanent Fix** (1-2 hours, optional)
   - Add Playwright mock clock in test setup
   - Ensures zero drift across all timezones
   - Achieves ~95% churn reduction

3. **Phase 3: Ongoing**
   - Quarterly re-baselining if Phase 2 deferred
   - Monitor for new dynamic content in future features

---

## Next Steps

- **Implementation:** Assign Phase 1 to Kaylee or Wash
- **Validation:** Run 5× consecutive test cycles → verify 0% churn
- **Documentation:** Update `.squad/skills/playwright-screenshots/SKILL.md` with final approach
- **Commit:** Merge with orchestration logs and merged decisions

---

**Spawned:** 2026-04-01 (three concurrent background agents)  
**Investigated:** 40+ Playwright screenshots, 80+ churn sources  
**Decision Ready:** Yes
