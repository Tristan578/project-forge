---
"@project-forge/mcp-server": patch
---

No behavior change. Added a regression test (`src/transport/__tests__/transportGap.test.ts`) for the `@modelcontextprotocol/sdk` `Transport` type gap tracked in #10278 (`onclose`, `onerror`, `onmessage` and `sessionId` are declared optional without `| undefined` on `Transport` but as `| undefined` on `StreamableHTTPServerTransport`). The test finds the `as Transport` casts in the real `src/transport/http.ts`, recompiles that file with the casts removed under the real `tsconfig.json`, and reads the disagreeing members off the SDK's own `.d.ts`; it asserts the gap is still there, so it starts failing (a clear signal to drop both casts) the day a newer SDK release fixes the gap, and it also fails if the casts are removed or replaced. Verified the SDK still disagrees with itself at the pinned 1.30.0; the two casts remain necessary and are unchanged.
