# Session Log: Fix Flaky Hub Test #112

**Date:** 2026-03-24T13:54:25Z  
**Topic:** ConnectToHub_WithoutJwt_Fails flaky test resolution  
**Agent:** Zoe (Tester)  
**Status:** COMPLETE ✅  

## Summary

Fixed 4 flaky SignalR hub authentication tests by switching from specific exception type assertions to resilient behavior-based assertions. Pattern: `ThrowAsync<Exception>()` + `connection.State.Should().NotBe(Connected)`.

## Impact

- All 130 server tests pass
- Hub auth tests now reliable across CI/local environments
- Pattern documented for future hub auth test development
- Decision: .squad/decisions/inbox/zoe-flaky-hub-test.md

## Artifacts

- Branch: squad/112-flaky-hub-test
- PR: #113
- Modified: tests/SharedSpaces.Server.Tests/SpaceHubTests.cs
