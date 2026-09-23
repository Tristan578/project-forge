# Performance fixture capture

Operation `performance.FR-3.OP-01` ([#9904](https://github.com/Tristan578/project-forge/issues/9904), [#10013](https://github.com/Tristan578/project-forge/issues/10013)).

A performance number is only useful when you know what was measured, on what,
and how. Every capture in SpawnForge produces the same versioned report: the
measurement manifest (build SHA, fixture checksum, OS, exact browser version,
GPU, render backend, viewport, device memory, cache state, sample count), the
raw frame-time samples, the aggregates (p50/p95/p99 frame time, first-interactive
time, memory availability) and a pass / fail / unknown verdict for every budget
of the chosen device profile.

## The rule that matters: unknown is never zero

A value the browser cannot measure is recorded as `"unknown"`. It is never
written as `0`, and a budget whose metric is unknown is `unknown`, not `pass`.
A report's verdict is `pass` only when every applicable budget passed. The same
applies to a capture taken while the page was hidden (animation frames are
throttled) and to a capture whose warm-up or window differs from the profile's
protocol: the frame budget reads `unknown`, with the reason.

## Pieces

| Piece | Where |
|---|---|
| Pinned fixtures `perf-2d@1`, `perf-3d@1` | `web/src/lib/perf/fixtures/*.scene.json`, built by `fixtureScenes.ts` (`npm run perf:fixtures`), registered with their checksum in `perfFixtures.ts` |
| Device profiles (`desktop@1`) | `web/src/lib/perf/deviceProfiles.ts` |
| Report, budgets, comparison | `web/src/lib/perf/performanceReport.ts` |
| Windowing, percentiles, cache state, memory | `web/src/lib/perf/frameCapture.ts` |
| Editor capture (manual and AI) | `web/src/lib/perf/editorCapture.ts`, `PerformanceCapturePanel.tsx`, `performanceHandlers.ts` |
| Exported-game harness | `web/src/lib/export/perfHarnessFragment.ts`, turned into a report by `web/src/lib/perf/exportedCapture.ts` |
| Local GPU capture of the fixtures | `web/e2e/perf/fixtureCapture.spec.ts`, `web/playwright.perf.config.ts` |
| Observatory adapter | `web/src/lib/perf/observatoryAdapter.ts` |

A fixture's identity is `computeSceneFixtureChecksum` of the scene: a djb2
digest of the canonical JSON (keys sorted, entities ordered by id, save
timestamps dropped), so line endings and key order do not change it. Editing a
fixture changes its checksum; register the edit as a new version (`perf-3d@2`)
rather than changing what `@1` measures.

## `desktop@1`

| Budget | Limit | Applies to |
|---|---|---|
| `frame-time-p95` | p95 frame time <= 16.7 ms | every run on the 10 s + 60 s protocol |
| `first-interactive-cold` | first interactive <= 5000 ms | runs whose cache state is `cold`; `not_applicable` on a warm run, `unknown` when the cache state is unknown |

Frame time is the interval between consecutive animation frames: what the
player sees. It is not GPU work time (GPU timers are
[#9880](https://github.com/Tristan578/project-forge/issues/9880)).

## Capturing in the editor

Open the performance profiler (F12 or Ctrl+Shift+P), expand it, and use
**Timed capture**: warm-up and capture seconds, device profile, cache state
(Detect, Warm, Cold, Unknown), then **Run capture**. It measures the live
engine; the fixture checksum is the checksum of the scene the engine holds, read
back when the capture starts. When it finishes the panel shows the verdict,
percentiles, first interactive, memory and each budget. **Download report
(JSON)** saves the full report including raw samples. **Pin as baseline**
persists the report in this browser; **Compare with baseline** compares the
latest report with it.

The in-app AI has the same five operations, with the same argument checks and
the same error text: `capture_performance_report`, `get_performance_report`,
`compare_performance_reports`, `set_performance_baseline` and
`cancel_performance_capture`. Capturing never changes the pinned baseline.

In the editor, first interactive is the time from navigation start to the
engine reporting ready (`forge:engine-ready` mark).

## Capturing an exported fixture on a GPU

Every exported game carries a dormant harness. Opening the exported page with
`?forgePerf=1` (and optionally `forgePerfWarmupMs`, `forgePerfCaptureMs`) arms
it; it records frames from the first game-loop frame and leaves the run in
`window.__forgePerf`. First interactive is measured from the player's click to
the first game-loop frame.

The local capture drives that end to end:

```bash
# 1. Build the engine packages into web/public (build_wasm.ps1 builds all four;
#    the capture needs engine-pkg-webgpu and/or engine-pkg-webgpu-runtime).
powershell -ExecutionPolicy Bypass -File build_wasm.ps1

# 2. Capture: five cold runs of each fixture.
cd web
PERF_ENGINE=editor npx playwright test --config=playwright.perf.config.ts
```

Reports, a `summary.json`, a screenshot per fixture and a
`run-environment.json` land in `web/test-results/perf-evidence/<timestamp>/`
(or `PERF_OUT_DIR`). The spec refuses to run from an uncommitted tree unless
`PERF_ALLOW_DIRTY=1`, in which case the build SHA is recorded as unknown.

| Variable | Effect |
|---|---|
| `PERF_RUNS` | runs per fixture (default 5) |
| `PERF_FIXTURES` | comma-separated fixture ids |
| `PERF_CACHE=warm` | prime the HTTP cache in the same browser context first (default: a fresh context per run, which is cold) |
| `PERF_CPU_THROTTLE=N` | CDP CPU throttling, for a deliberately failing budget |
| `PERF_EXPECT_VERDICT` | assert every run's verdict |
| `PERF_ENGINE=editor` | serve only the editor engine packages |
| `PERF_BACKEND=webgl2` | hide `navigator.gpu` so the WebGL2 package loads |
| `PERF_VSYNC=1` | pace frames to the display (default: uncapped) |
| `PERF_WARMUP_MS`, `PERF_CAPTURE_MS` | shortened smoke runs; budgets then read unknown |

### Why `PERF_ENGINE=editor` today

The runtime engine build queues `load_scene` but never applies it
([#10195](https://github.com/Tristan578/project-forge/issues/10195)), so a run
on it measures the engine's default scene. The harness notices: it waits for
the engine's `SCENE_LOADED` event, and `buildExportedRunReport` refuses a run
that never saw it. With `PERF_ENGINE=editor` the server serves only the editor
packages, so the export template takes its own fallback to the editor build.

### Why frames are uncapped by default

With vsync on, a frame interval cannot be shorter than the display's refresh
period. On a 60 Hz display a perfectly smooth run already sits at the 16.7 ms
budget, and jitter decides the verdict. Uncapped
(`--disable-gpu-vsync --disable-frame-rate-limit`), the interval is the time
the page needed per frame. `run-environment.json` records which mode was used.

### Differences from production to state with any number

- The engine is served over loopback, not the CDN: the cold first-interactive
  time has no network latency or bandwidth limit in it.
- The engine binary is served uncompressed; the CDN negotiates brotli.
- The browser is launched by Playwright with GPU flags, not a user's profile.

## Comparing reports

Two reports compare like-for-like only when fixture checksum, exact browser
version and backend are known and equal, and cache state, device profile and
capture protocol are equal. Otherwise the comparison's claim is
`incompatible-baseline`, it lists the differing fields, and it carries no
deltas. OS, GPU, viewport and device-memory differences are reported as
advisories. A compatible comparison claims `improved` / `regressed` only for a
p95 frame-time change beyond 5 %.
