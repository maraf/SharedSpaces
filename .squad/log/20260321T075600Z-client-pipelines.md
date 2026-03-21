# Session Log: Client CI/CD Pipelines

**Timestamp:** 2026-03-21T07:56:00Z  
**Topic:** Client publish and deploy workflows  
**Agent:** Wash (Frontend Dev)  
**Status:** Complete

**What happened:**
- Created `.github/workflows/client-publish.yml` (tag-triggered publish to GitHub Releases)
- Created `.github/workflows/client-deploy.yml` (manual deploy to GitHub Pages with CNAME-based base path detection)
- Updated `src/SharedSpaces.Client/vite.config.ts` to inject version via `VITE_APP_VERSION` env var
- All workflows and config validated; lint and build pass

**Outcome:** Two new workflows ready for team use. Version injection now environment-aware.
