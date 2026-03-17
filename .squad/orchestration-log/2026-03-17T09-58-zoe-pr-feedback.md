# Zoe: PR #33 Feedback (2026-03-17 09:58)

## Task
Address Copilot PR review feedback on test code in `tests/SharedSpaces.Server.Tests/`.

## Feedback Items
1. **Reuse production PIN hasher:** Via `InternalsVisibleTo` instead of duplicating hash logic in tests
2. **PrivateAssets on test packages:** Prevent test dependencies from leaking to consumers
3. **history.md fix:** Add learning about `InternalsVisibleTo` for security-sensitive helpers

## Outcome
✅ All 3 items addressed

**Files Modified:**
- `tests/SharedSpaces.Server.Tests/TokenEndpointTests.cs`
- `tests/SharedSpaces.Server.Tests/SharedSpaces.Server.Tests.csproj`
- `src/SharedSpaces.Server/SharedSpaces.Server.csproj`
- `.squad/agents/zoe/history.md`

**Commits:**
- 328437e: test: address PR review feedback on test project

**Tests:** 13/13 passing
