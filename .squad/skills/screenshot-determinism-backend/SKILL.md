---
name: "screenshot-determinism-backend"
description: "Keep backend-driven screenshots stable by seeding timestamps, IDs, tokens, and invitation PINs from runtime configuration."
domain: "testing"
confidence: "high"
source: "earned"
---

## Context
Use this when Playwright screenshots churn because the UI renders values that come directly from live server responses. In SharedSpaces, the risky fields are not just timestamps; visible GUIDs and shared-link URLs also need to be reproducible.

## Patterns
- Treat screenshot determinism as a runtime concern, not a public API contract change.
- Reuse `DeterministicTime:SeededUtcNow` as the single switch that enables all deterministic server generators.
- Register deterministic services in `src/SharedSpaces.Server/Program.cs`:
  - `ISystemClock` for timestamps
  - `IInvitationPinGenerator` for invitation PINs
  - `IGuidGenerator` for server-generated IDs/tokens
- In create endpoints, assign IDs and tokens explicitly instead of relying on entity property initializers.
- Keep default behavior random when the seeded config is absent.

## Examples
- `src/SharedSpaces.Server/Features/Spaces/SpaceEndpoints.cs` sets `space.Id = guidGenerator.NewGuid()` and `CreatedAt = systemClock.UtcNow`.
- `src/SharedSpaces.Server/Features/Invitations/InvitationEndpoints.cs` creates deterministic invitation IDs while `IInvitationPinGenerator` keeps the visible PIN stable.
- `src/SharedSpaces.Server/Features/Tokens/TokenEndpoints.cs` assigns deterministic member IDs so downstream seeded artifacts stay reproducible.
- `src/SharedSpaces.Server/Features/SharedLinks/SharedLinkEndpoints.cs` assigns deterministic `Id` and `Token`, which stabilizes the share URL shown in `space-share-modal`.

## Anti-Patterns
- Don’t add test-only request fields like `createdAt`, `seed`, or `id` to production DTOs just for screenshots.
- Don’t enable deterministic IDs globally for normal app runs.
- Don’t rely on `Guid.NewGuid()` or entity defaults for values that are rendered in screenshot baselines.
