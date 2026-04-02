---
name: "deterministic-test-time"
description: "How SharedSpaces should stabilize time-dependent screenshot and E2E fixtures"
domain: "testing"
confidence: "high"
source: "earned"
---

## Context

Use this when screenshot or E2E coverage needs deterministic timestamps without unnecessarily changing the public API contract.

SharedSpaces renders server-generated dates in several places, so freezing only the browser clock is not enough. But test determinism should not casually leak into public request DTOs if an internal runtime/config boundary will do the job.

## Patterns

### Prefer internal clock/config overrides over public test-only request fields

- Keep deterministic-time controls behind server configuration or a clock abstraction
- Use `DeterministicTime:SeededUtcNow` for the fixed UTC seed and `DeterministicTime:AutoAdvanceSeconds` when deterministic ordering needs monotonic increments
- Feed that configuration from AppHost when using Aspire
- Also allow direct server startup to set the same config, because screenshot workflows may bypass Aspire

### Treat AppHost as transport, not the architecture

- `src/AppHost.cs` is a good place to propagate config to the server
- Do not make the determinism design depend exclusively on AppHost; the server should accept the same override from normal configuration sources

### One frozen time is not enough when fixture ordering matters

- If screenshots rely on meaningful ordering or varied relative-time labels, a single global timestamp may be too blunt
- Watch for lists sorted by `CreatedAt`, `JoinedAt`, or `SharedAt`; identical timestamps can create unstable ordering and less realistic coverage
- Prefer a deterministic clock that auto-advances by a small fixed step per server write when the UI depends on descending timestamp order

### Freeze browser and server time separately

- Browser clock freezing keeps client-side relative time stable
- Server clock/config override keeps persisted timestamps stable
- Use both when screenshots include both client-rendered relative time and server-persisted dates

## Examples

- `src/AppHost.cs` forwards screenshot-specific DB/storage config and deterministic-time config to the server via environment variables
- `src/SharedSpaces.Client/e2e/screenshots.spec.ts` freezes browser `Date` and relies on the server clock/config path instead of request-level timestamp fields
- `src/SharedSpaces.Server/Program.cs` registers `ISystemClock` from configuration via `SystemClockFactory`

## Anti-Patterns

- **Adding test-only fields to multiple public request DTOs first** — fast, but increases external product surface for infrastructure needs
- **Making the solution AppHost-only** — breaks direct server startup paths and makes tests less portable
- **Using one identical timestamp for everything without checking ordering** — can create unrealistic UI and unstable list ordering
