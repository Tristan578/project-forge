---
"web": patch
---

Add a live-engine CI gate for the game-creation pipeline (PF-1202).

The per-PR `test-e2e-engine-smoke` job now also runs
`e2e/tests/pipeline-live-engine.spec.ts`, which drives the real game-creation
pipeline against the real WASM engine under SwiftShader and clicks the real Play
button, asserting the engine itself reports `engineMode === 'play'`.

What that buys over the existing fake-bridge integration suite is real
deserialization, real routing through `route_domain`, and a real play
transition. Because `dispatchCommand` returns `void`, a payload the engine HARD
rejects leaves its pipeline step reporting `completed` and surfaces only as the
`Engine rejected command '<name>'` line `editorStore`'s `tracked` wrapper writes
to the console — so both tests collect console errors and page errors for their
whole lifetime and assert zero of each. A payload the engine accepts but whose
keys deserialize to `None` still logs nothing and is still not caught here; that
remains the job of the pick-based payload builders and their unit pins.

A companion negative test proves an unwinnable design fails verification, that
Play refuses it by appending the winnability refusal to the chat surface, and
that the engine is still answering commands afterwards — so a dead engine cannot
pass it by staying silent.

The 3D "Crystal Run" GDD used by both gates now lives in one shared fixture,
`web/e2e/fixtures/gdd/crystal-run-3d.json`, so the fast and slow gates cannot
drift into testing different games.
