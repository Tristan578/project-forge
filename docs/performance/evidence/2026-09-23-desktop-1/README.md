# Performance evidence — 2026-09-23, `desktop@1`

Real-hardware evidence for [#9904](https://github.com/Tristan578/project-forge/issues/9904) /
[#10013](https://github.com/Tristan578/project-forge/issues/10013), operation
`performance.FR-3.OP-01`. Captured with `web/e2e/perf/fixtureCapture.spec.ts`
under `web/playwright.perf.config.ts`; how to reproduce and how to read a report
is in [`docs/guides/performance-fixture-capture.md`](../../../guides/performance-fixture-capture.md).
Every `*-run*.json` is the complete downloadable report: manifest, raw
frame-time samples, aggregates and budget verdicts.

## Machine and build

| | |
|---|---|
| OS | Windows 11 Home 10.0.26200 |
| CPU / RAM | AMD Ryzen 7 3800X (8 cores, 16 threads) / 64 GB |
| GPU / driver | NVIDIA GeForce RTX 2080 SUPER, driver 32.0.16.1060 (from the OS; the browser exposes only `nvidia turing`) |
| Display | 2560 x 1440 at 59 Hz (not used for pacing: frames were uncapped) |
| Browser | Google Chrome 153.0.8010.53 (sets A–C), Microsoft Edge 153.0.4234.48 (set D); headless, Playwright 1.63.0 |
| Launch flags | `--enable-gpu --ignore-gpu-blocklist --enable-unsafe-webgpu --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --use-angle=d3d11 --disable-gpu-vsync --disable-frame-rate-limit` |
| Viewport | 1280 x 720, device pixel ratio 1 |
| Git | set A at `9a05928c`, sets B–C at `5b659888`, set D at `9367b6de` (the commits between them add docs, a handlers-README line, a spec comment, the capture config's browser-channel option and a report-comparison script; none touches the capture path) |
| Engine | tree `efd64ce2` (identical on `origin/main` `9261e23f`), built locally the way `cd.yml` does: `cargo +1.98.1 build --release --target wasm32-unknown-unknown`, then `wasm-bindgen` 0.2.127, no `wasm-opt` |
| Editor package | `engine-pkg-webgpu`, 95,835,203 B, sha256 `6b5b9939c74952de586816b2cc8ff030f7bdd124e2ed7eb47763d896ce9a7bfc` |
| Runtime package | `engine-pkg-webgpu-runtime`, 90,842,966 B, sha256 `aa1f6782858186ee9cbef4c229574ddddf418443b7ec9f08a29c5bb5dc06c40d` |

Every run's own `run-environment.json` repeats these facts as recorded at the time.

## Read these numbers with the environment in mind

- **The machine was busy.** Other processes (other agents' test runs) kept total
  CPU at a median of 90.8 % (minimum 50.1 %, maximum 100 %) across the capture
  window; `cpu-load.csv` has one sample every ~5 s. Frame and first-interactive
  times include that contention. The spread between runs (for example `perf-2d@1`
  run 2, and `perf-3d@1` run 2's 6.1 s first interactive) is consistent with it.
- **Editor engine build, not the runtime build.** The runtime build does not
  apply scene loads ([#10195](https://github.com/Tristan578/project-forge/issues/10195));
  set C shows the harness refusing it. Sets A, B and D serve only the editor
  packages, so the unmodified single-HTML export template takes its own fallback
  to the editor build (the build `/play` loads).
- **Loopback, uncompressed.** The engine is served from a local server with the
  CDN's cache headers but no network latency or bandwidth limit, and without
  brotli. A real cold load over a network is slower.
- **Uncapped frames.** A frame-time sample is the interval between animation
  frames with vsync off, i.e. the time the page needed per frame.
- **Cold by construction.** Each run is a fresh browser context, so the HTTP
  cache is empty; the spec declares the cache state `cold`.

## Results

| Set | What | Runs | p95 frame time (ms) | Cold first interactive (ms) | `desktop@1` verdicts |
|---|---|---|---|---|---|
| A | `perf-2d@1`, Chrome | 5 | 14.51–17.2 (median 14.8) | 2891–3244 (median 3079) | pass, fail, pass, pass, pass |
| A | `perf-3d@1`, Chrome | 5 | 16.8–20.2 (median 17.7) | 2788–6073 (median 2943) | fail x5 (frame budget) |
| B | `perf-2d@1`, Chrome, CPU throttled 6x — the deliberately failing budget | 1 | 184.28 | 23447 | fail (both budgets) |
| C | `perf-3d@1`, Chrome, runtime engine build | 1 | — | — | refused: "never applied the fixture scene" (#10195) |
| D | `perf-3d@1`, Edge | 1 | 17.6 | 3095 | fail (frame budget) |

What the evidence shows:

1. **Manual and AI success (report contents).** Every A/B/D report carries
   p50/p95/p99 frame time, first-interactive time, JS heap and WASM memory, and
   the manifest (build SHA, fixture id and checksum, OS, exact browser version,
   GPU, backend, viewport, device memory, cache state, sample count).
2. **The 3D fixture misses the 60 fps budget on this machine** in every run;
   the 2D fixture meets it in four of five. Both meet the 5 s cold first
   interactive except `perf-3d@1` run 2.
3. **A deliberately failing budget** (set B) reports `fail` with the observed
   value next to the limit for both budgets.
4. **Unknown never passes** (negative scenario): set C's run was accepted by
   `load_scene` but the scene was never applied; the report builder refused it
   instead of filing a PASS for the default scene. Before that check existed, a
   runtime-build run produced `verdict: pass` (p95 9.1 ms) for `perf-3d@1` with
   the default scene on screen; the spec's on-screen colour check was the only
   thing that caught it.
5. **Boundary scenario, on real reports** (`E-comparisons/`):
   - Edge vs Chrome, same fixture: `incompatible-baseline`, differing field
     `browserVersion` (`Edge 153.0.4234.48` vs `Chrome 153.0.8010.53`), no deltas.
   - `perf-3d@1` vs `perf-2d@1`: `incompatible-baseline` on `fixtureChecksum`.
   - Chrome run 3 vs run 1 of `perf-3d@1`: compatible, claim `unchanged`
     (p95 17.7 vs 17.5 ms).

Not covered by this evidence: a browser without `performance.memory` (Firefox,
Safari) on real hardware — the unknown path for memory is covered by unit tests
only; WebGL2 captures; warm-cache captures; and any production (CDN, network)
measurement.

## Per-run detail

Generated from the reports in this directory.

#### A-editor-engine-cold-5-runs

git head 9a05928c2c62ceb28a2f32c1f56a02864f4e1473 (build SHA recorded: 9a05928c2c62ceb28a2f32c1f56a02864f4e1473), engine tree efd64ce248aea65dba5e07b5244918cf10e03b28, engine-pkg-webgpu 95835203 B sha256 6b5b9939c74952de..., chromium 153.0.8010.53 headless=true, vsync off (uncapped: --disable-gpu-vsync --disable-frame-rate-limit), CPU x1, cache cold

| Report | Fixture (checksum) | Backend | Cache | Samples | p50 ms | p95 ms | p99 ms | First interactive ms | JS heap MB | WASM MB | frame-time-p95 | first-interactive-cold | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| perf-2d-v1-cold-run1.json | perf-2d@1 (b620e09f) | webgpu | cold | 4480 | 13.3 | 15.2 | 18.8 | 2891.4 | 15 | 41.4 | pass (15.2 / 16.7) | pass (2891.4 / 5000) | pass |
| perf-2d-v1-cold-run2.json | perf-2d@1 (b620e09f) | webgpu | cold | 4613 | 13 | 17.2 | 39.46 | 3096.3 | 33.4 | 41.4 | fail (17.2 / 16.7) | pass (3096.3 / 5000) | fail |
| perf-2d-v1-cold-run3.json | perf-2d@1 (b620e09f) | webgpu | cold | 5006 | 12.6 | 14.7 | 17.4 | 3078.7 | 28.5 | 41.4 | pass (14.7 / 16.7) | pass (3078.7 / 5000) | pass |
| perf-2d-v1-cold-run4.json | perf-2d@1 (b620e09f) | webgpu | cold | 5358 | 10.2 | 14.51 | 16.94 | 3243.6 | 20.8 | 41.4 | pass (14.51 / 16.7) | pass (3243.6 / 5000) | pass |
| perf-2d-v1-cold-run5.json | perf-2d@1 (b620e09f) | webgpu | cold | 4607 | 13 | 14.8 | 18.49 | 3049.6 | 29.8 | 41.4 | pass (14.8 / 16.7) | pass (3049.6 / 5000) | pass |
| perf-3d-v1-cold-run1.json | perf-3d@1 (5e285ced) | webgpu | cold | 3864 | 15.4 | 17.5 | 21.3 | 2849.6 | 27.8 | 46.1 | fail (17.5 / 16.7) | pass (2849.6 / 5000) | fail |
| perf-3d-v1-cold-run2.json | perf-3d@1 (5e285ced) | webgpu | cold | 3709 | 15.6 | 20.2 | 31.3 | 6072.8 | 27.3 | 46.6 | fail (20.2 / 16.7) | fail (6072.8 / 5000) | fail |
| perf-3d-v1-cold-run3.json | perf-3d@1 (5e285ced) | webgpu | cold | 3926 | 15.3 | 17.7 | 21.12 | 3026 | 27.6 | 46.1 | fail (17.7 / 16.7) | pass (3026 / 5000) | fail |
| perf-3d-v1-cold-run4.json | perf-3d@1 (5e285ced) | webgpu | cold | 3905 | 14.9 | 19.3 | 25.99 | 2788.2 | 33.1 | 46.6 | fail (19.3 / 16.7) | pass (2788.2 / 5000) | fail |
| perf-3d-v1-cold-run5.json | perf-3d@1 (5e285ced) | webgpu | cold | 4071 | 14.9 | 16.8 | 20.43 | 2942.8 | 36.5 | 46.6 | fail (16.8 / 16.7) | pass (2942.8 / 5000) | fail |

perf-2d@1: 5 runs; p95 frame 14.51–17.2 ms (median 14.8); cold first interactive 2891.4–3243.6 ms (median 3078.7); verdicts pass, fail, pass, pass, pass; manifest: Windows, Chrome 153.0.8010.53, GPU "nvidia turing", viewport {"width":1280,"height":720,"devicePixelRatio":1}, device memory 32 GB

perf-3d@1: 5 runs; p95 frame 16.8–20.2 ms (median 17.7); cold first interactive 2788.2–6072.8 ms (median 2942.8); verdicts fail, fail, fail, fail, fail; manifest: Windows, Chrome 153.0.8010.53, GPU "nvidia turing", viewport {"width":1280,"height":720,"devicePixelRatio":1}, device memory 32 GB

#### B-editor-engine-cold-cpu6x-failing-budget

git head 5b659888050904f7f354ff61a8439e54293e60d6 (build SHA recorded: 5b659888050904f7f354ff61a8439e54293e60d6), engine tree efd64ce248aea65dba5e07b5244918cf10e03b28, engine-pkg-webgpu 95835203 B sha256 6b5b9939c74952de..., chromium 153.0.8010.53 headless=true, vsync off (uncapped: --disable-gpu-vsync --disable-frame-rate-limit), CPU x6, cache cold

| Report | Fixture (checksum) | Backend | Cache | Samples | p50 ms | p95 ms | p99 ms | First interactive ms | JS heap MB | WASM MB | frame-time-p95 | first-interactive-cold | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| perf-2d-v1-cold-cpu6x-run1.json | perf-2d@1 (b620e09f) | webgpu | cold | 453 | 135 | 184.28 | 240.12 | 23446.8 | 12.8 | 40.7 | fail (184.28 / 16.7) | fail (23446.8 / 5000) | fail |

perf-2d@1: 1 runs; p95 frame 184.28–184.28 ms (median 184.28); cold first interactive 23446.8–23446.8 ms (median 23446.8); verdicts fail; manifest: Windows, Chrome 153.0.8010.53, GPU "nvidia turing", viewport {"width":1280,"height":720,"devicePixelRatio":1}, device memory 32 GB

#### C-runtime-engine-scene-never-applied

git head 5b659888050904f7f354ff61a8439e54293e60d6 (build SHA recorded: 5b659888050904f7f354ff61a8439e54293e60d6), engine tree efd64ce248aea65dba5e07b5244918cf10e03b28, engine-pkg-webgpu-runtime 90842966 B sha256 aa1f6782858186ee..., chromium 153.0.8010.53 headless=true, vsync off (uncapped: --disable-gpu-vsync --disable-frame-rate-limit), CPU x1, cache cold

(no report written)

#### D-edge-editor-engine-cold

git head 9367b6de5496114d5eac00256c23d417298335aa (build SHA recorded: 9367b6de5496114d5eac00256c23d417298335aa), engine tree efd64ce248aea65dba5e07b5244918cf10e03b28, engine-pkg-webgpu 95835203 B sha256 6b5b9939c74952de..., chromium 153.0.4234.48 headless=true, vsync off (uncapped: --disable-gpu-vsync --disable-frame-rate-limit), CPU x1, cache cold

| Report | Fixture (checksum) | Backend | Cache | Samples | p50 ms | p95 ms | p99 ms | First interactive ms | JS heap MB | WASM MB | frame-time-p95 | first-interactive-cold | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| perf-3d-v1-cold-run1.json | perf-3d@1 (5e285ced) | webgpu | cold | 3941 | 15.4 | 17.6 | 21.5 | 3095.4 | 26.5 | 46.6 | fail (17.6 / 16.7) | pass (3095.4 / 5000) | fail |

perf-3d@1: 1 runs; p95 frame 17.6–17.6 ms (median 17.6); cold first interactive 3095.4–3095.4 ms (median 3095.4); verdicts fail; manifest: Windows, Edge 153.0.4234.48, GPU "nvidia turing", viewport {"width":1280,"height":720,"devicePixelRatio":1}, device memory 32 GB
