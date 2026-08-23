---
"web": patch
---

Add a live-engine CI gate for the game-creation pipeline (PF-1202).

The per-PR `test-e2e-engine-smoke` job now also runs
`e2e/tests/pipeline-live-engine.spec.ts`, which drives the real game-creation
pipeline against the real WASM engine under SwiftShader and clicks the real Play
button, asserting the engine itself reports `engineMode === 'play'`. Because
`dispatchCommand` returns `void`, a command the engine rejects or silently
mangles produces no signal in the fake-bridge integration suite — this is the
first automated gate that can see one. A companion negative test proves an
unwinnable design fails verification and that Play refuses it.

The 3D "Crystal Run" GDD used by both gates now lives in one shared fixture,
`web/e2e/fixtures/gdd/crystal-run-3d.json`, so the fast and slow gates cannot
drift into testing different games.
