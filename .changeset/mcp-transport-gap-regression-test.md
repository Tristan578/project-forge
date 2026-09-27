---
"@project-forge/mcp-server": patch
---

No behavior change. Added a regression test (`src/transport/__tests__/transportGap.test.ts` + `test-fixtures/transportGapProbe.ts`) for the `@modelcontextprotocol/sdk` `Transport.onclose`/`onerror`/`onmessage` type gap tracked in #10278: it compiles the un-cast form of the two `as Transport` casts in `src/transport/http.ts` standalone and asserts it still fails, so the test starts failing (a clear signal to drop both casts) the day a newer SDK release fixes the gap. Verified the SDK still disagrees with itself at the pinned 1.30.0; the two casts remain necessary and are unchanged.
