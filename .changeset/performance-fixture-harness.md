---
"web": minor
"@project-forge/mcp-server": minor
---

Add a timed, manifest-pinned performance report. The profiler's new Timed capture section and the in-app AI (`capture_performance_report`, `get_performance_report`, `compare_performance_reports`, `set_performance_baseline`, `cancel_performance_capture`) share one implementation: a 10 s warm-up and 60 s capture produce p50/p95/p99 frame time, first-interactive time and memory availability, pinned to the build, fixture checksum, exact browser version, GPU, backend, viewport and cache state, and judged against the versioned `desktop@1` budgets (p95 frame time at most 16.7 ms, cold first interactive at most 5 s). Anything the browser cannot measure is reported as unknown and never passes a budget. A comparison against a baseline from a different browser version or fixture is flagged incompatible instead of claiming an improvement. Reports download as JSON with raw samples.

Two pinned fixtures (`perf-2d@1`, `perf-3d@1`) and a dormant harness in every exported game (`?forgePerf=1`) let the same report be captured on an exported game.

Exported games now send a scene load the engine accepts: the exporters sent `load_scene` as a JSON string immediately after `init_engine`, which the engine refused. They now send `{ json }` once the engine accepts commands, switch 2D projects to the 2D camera so sprites render, and send `set_quality` as an object. The runtime engine build still does not apply scene loads, so an export that carries it shows the default scene until #10195 is fixed; `/play` and exported script commands still send string payloads (#10196). The profiler no longer reports 0 MB of memory when the browser does not expose the JS heap.
