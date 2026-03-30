# Session Log: Share Link Bugs Research

**Timestamp:** 2026-03-30T18:14:26Z
**Topic:** Research & architectural review for Issues #151 and #161

## Overview

Three-agent research squad investigated root causes and proposed solutions for share link deployment issues:
- **Issue #151:** 404 errors on GitHub Pages share routes
- **Issue #161:** Missing API URL in deployed share links

**Agents:** Wash (Frontend), Kaylee (Backend), Mal (Lead)

## Key Findings

### Issue #151: Share Link 404 on GitHub Pages
- **Root Cause:** Browser requests `/share/xyz` → server returns 404
- **Proposed Fix:** `--base ./` + `404.html` redirect to `index.html`
- **Status:** Validated; identified implementation risks

### Issue #161: Share Link Missing API URL
- **Root Cause:** Meta tag hardcoded to "/" blocks multi-domain deployments
- **Options Proposed:** 3 approaches evaluated (entity storage, query param, reverse proxy)
- **Recommendation:** Option A (API URL in SharedLink) or Option 1 (query param per Mal)

## Architectural Decision

Combined approach endorsed by Mal (Lead):
1. Use `--base ./` for base path (SPA best practice)
2. Use query parameter for API URL (minimal changes, zero storage overhead)
3. Implement 404.html fallback for unmatched routes

## Next Steps

1. Implement 404.html redirect strategy
2. Add query parameter API URL resolution
3. Test on GitHub Pages staging
4. Update deployment documentation

---
**Co-authored-by:** Copilot
