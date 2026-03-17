# Kaylee CI Workflow Proposal

## Context
We need a baseline GitHub Actions workflow so pull requests targeting `main` get automatic server build and test feedback before merge.

## Proposed Decision
Add `.github/workflows/ci.yml` as a simple repository-wide CI workflow that runs on `pull_request` to `main` and `push` to `main`, using `ubuntu-latest` plus .NET 9 to restore, build, and test `SharedSpaces.sln`.

## Why This Shape
- Keeps the first CI pass intentionally small and reliable.
- Uses the solution file so server and test projects stay aligned automatically.
- Mirrors local validation commands already used by the team.

## Follow-ups
- If client-side automation is added later, expand CI in a separate decision rather than overloading this baseline workflow.
