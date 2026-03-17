# Zoe: JWT claim validation in auth-flow tests

## Context
Issue #20 requires JWTs issued by the token exchange flow to carry specific claims (`sub`, `display_name`, `server_url`, `space_id`) and explicitly omit expiration. Several auth-flow tests were only proving that a token existed or had JWT shape, which left claim regressions under-tested.

## Decision
For every successful token issuance path covered in `tests/SharedSpaces.Server.Tests/TokenEndpointTests.cs`, decode the JWT payload and validate the concrete claim values against the created `SpaceMember`, the requested display name, the configured `Server:Url`, and the target space ID. Keep a dedicated no-expiration assertion as well.

## Rationale
This makes the integration suite verify the contract the client actually depends on, not just token issuance mechanics. It also turns common auth-flow tests into regression coverage for claim mapping, configuration wiring, and the no-expiration policy.
