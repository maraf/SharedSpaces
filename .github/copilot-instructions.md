# Copilot Instructions — SharedSpaces

## UI Change Workflow

**Any change that touches UI** (components, templates, styles, layout) **must** pass the CI screenshot verification:

1. **Make changes** — Edit components, styles, etc.
2. **Push** — Open or update a PR targeting `main`
3. **CI verifies** — The `Screenshots` workflow regenerates screenshots and fails if any differ from the committed versions
4. **Regenerate** — If CI fails, comment `/regenerate-screenshots` on the PR to have CI regenerate and commit updated screenshots
5. **Review** — Check the committed screenshot diff (especially mobile) for regressions, overflow, or broken layout

**Do not generate or commit screenshots locally.** Only CI-generated screenshots should be committed to the repo. This ensures consistency across environments.

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

## PR Descriptions

- Use backticks for inline code in PR/issue bodies
- PowerShell treats `` ` `` as an escape character — backticks in strings get swallowed
- Always write PR body to a **temp file** and pass it via `--body-file`, never inline with `--body`

## Issue Titles

- Don't include scope tags, instead use labels