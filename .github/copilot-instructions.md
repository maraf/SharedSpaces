# Copilot Instructions — SharedSpaces

## UI Change Workflow

**Any change that touches UI** (components, templates, styles, layout) **must** pass the CI screenshot verification:

1. **Make changes** — Edit components, styles, etc.
2. **Push** — Open or update a PR targeting `main`
3. **CI verifies** — The `Screenshots` workflow regenerates screenshots and fails if any differ from the committed versions
4. **Regenerate** — If CI fails, comment `/regenerate-screenshots` on the PR to have CI regenerate and commit updated screenshots
5. **Review** — Check the committed screenshot diff (especially mobile) for regressions, overflow, or broken layout

### When to Use `/regenerate-screenshots`

A screenshot validation failure only means the rendered UI changed — it does not by itself mean the change is correct. Before commenting the slash command:

- Confirm the failure is explained by the UI change you intentionally made (e.g., you changed a component's layout, styles, or copy, and the diff reflects that).
- If you are not 100% sure the failure only reflects your intended change (e.g., unrelated elements shifted, unexpected diffs, or you didn't touch UI at all), **do not** comment `/regenerate-screenshots`. Investigate the cause first and flag it to the user instead.
- Only comment the slash command once you can attribute every changed screenshot to an expected, intentional UI change.

**Do not generate or commit screenshots locally.** Only CI-generated screenshots should be committed to the repo. This ensures consistency across environments.

See `.github/skills/playwright-screenshots/SKILL.md` for full details on isolated DB setup, seeding, and viewport specs.

## Agent Test State Setup

When an AI agent needs realistic app state for development tests or browser verification, create that state through the public/admin HTTP APIs instead of editing SQLite directly. For normal development testing, use the default Aspire AppHost and development database:

```bash
cd src
dotnet run AppHost.cs
```

Default local URLs are the Vite client at `http://localhost:5173` and the server at `http://localhost:5165`. Read the admin secret from `Admin:Secret` in `src/SharedSpaces.Server/appsettings.Development.json`. Use an isolated screenshot database only when capturing screenshots or running visual-regression scenarios that must be deterministic; see `.github/skills/playwright-screenshots/SKILL.md` for that workflow.

Core state setup flows:

- **Create a space:** use the admin API (`POST /v1/spaces`) with `X-Admin-Secret`.
- **Join a user to a space:** create an invitation for that space (`POST /v1/spaces/{spaceId}/invitations`), extract the one-time PIN from the returned invitation string, then exchange it through `POST /v1/tokens` with a display name. Repeat this invitation/token flow for each member you need.
- **Open the app as a joined user:** prefer the real join flow with `/?join=<invitationString>` and submit the display-name form. Only seed `localStorage["sharedspaces:tokens"]` and dispatch `view-change` directly for narrowly scoped tests where bypassing the join UI is intentional. The app uses event-based view switching; do not navigate to fake `/space` or `/admin` routes.
- **Upload an item:** call `PUT /v1/spaces/{spaceId}/items/{itemId}` with the member JWT and `multipart/form-data`. Text items use fields `id`, `contentType=text`, and `content`; file items use fields `id`, `contentType=file`, and `file`. Add `ttlSeconds` when testing expiration behavior.
- **Create a public shared link:** first upload an item, then call `POST /v1/spaces/{spaceId}/items/{itemId}/share/` with the member JWT. Public reads use `GET /v1/shared/{token}` and public file downloads use `GET /v1/shared/{token}/download`. Client share URLs are built by `src/SharedSpaces.Client/src/lib/share-link.ts`.
- **Create other useful states:** delete items with `DELETE /v1/spaces/{spaceId}/items/{itemId}`, download member-visible files with `GET /v1/spaces/{spaceId}/items/{itemId}/download`, copy/move items with `POST /v1/spaces/{spaceId}/items/{itemId}/transfer`, and use the journal endpoints when testing sync checkpoints or deletion journal entries.

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