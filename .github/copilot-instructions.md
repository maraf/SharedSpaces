# Copilot Instructions — SharedSpaces

## UI Change Workflow

**Any change that touches UI** (components, templates, styles, layout) **must** include Playwright screenshot verification:

1. **Capture baseline** — Run `npx playwright test` from `src/SharedSpaces.Client` to capture current screenshots before making changes
2. **Make changes** — Edit components, styles, etc.
3. **Recapture** — Run `npx playwright test` again after changes
4. **Compare** — Review screenshots (especially mobile) for regressions, overflow, or broken layout
5. **Commit** — Include updated screenshots in the commit

See `.github/skills/playwright-screenshots/SKILL.md` for full details on isolated DB setup, seeding, and viewport specs.

### Mobile Layout Checks

After recapturing, inspect mobile screenshots (`390 × 844`) and call out:

- Text or elements overflowing their containers (UUIDs, URLs, long strings)
- Buttons wrapping below inputs unexpectedly
- Pill bar overflow or wrapping issues
- Truncated labels on narrow screens
- Modal content exceeding viewport without scrolling
