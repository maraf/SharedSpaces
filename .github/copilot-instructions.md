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

## Commit Messages & PR Titles

- Always prefix with a change type: `fix`, `feat`, `docs`, `refactor`, `test`, `chore`, `style`, `perf`, `ci`, `build`
- Append a scope tag indicating what was changed:
  - `(server)` — server-only changes
  - `(client)` — client-only changes
  - `(cli)` — command-line interface changes
  - `(client,server)` — touches both, similar with CLI and other scopes
- Never include an issue number in the PR title (e.g., don't write `(#88)`)
- Issue references belong in the PR body or commit body, not the title

Examples:
```
feat(client): add dark mode toggle
fix(server): handle null quota on space creation
docs(client,server): update API and component docs
refactor(cli): extract quota logic into service
```

## Issue Titles

- Don't include scope tags, instead use labels