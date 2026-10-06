# Replay-control timing evidence — 2026-10-05, NFR-C1 for #10007

Timing evidence for the shared #9773 NFR-C1 as carried by
[#10007](https://github.com/Tristan578/project-forge/issues/10007): a local
control (pause / resume / cancel on a runtime input replay) is acknowledged
within 100 ms at p95, and a long job shows its pending / progress state within
250 ms. `replay-nfr.json` holds the raw samples, the percentiles and the machine
manifest as written by the script that measured them.

## What was measured, and against what

The runner's control surface (`web/src/lib/playtest/replayRunner.ts`,
`startReplay` → `ReplayHandle`), driven by `web/scripts/measure-replay-nfr.ts`
against a deterministic fake engine boundary whose frames arrive on a real
wall-clock timer. The fake supplies what the runner's boundary needs — key
presses, frames, observation, the clock pin, pause / resume of the runtime — and
nothing else; it is not the WASM engine. These numbers therefore measure the
runner and its acknowledgement path (pure JS on the page's main thread), which
is what the NFR names, at two frame cadences: 60 fps (a desktop refresh) and
15 fps (the order SwiftShader manages on the CI engine runner).

The same two timings are also measured in the real browser against the live
engine by `web/e2e/engine/inputReplay.spec.ts` on every PR (attachment
`replay-nfr-timing.json` on the test), asserted against
`REPLAY_NFR_ACK_P95_MS` / `REPLAY_NFR_PENDING_DISPLAY_MS` from
`web/e2e/constants.ts`. That spec could not be run on this machine (no local
WASM build; the Engine Smoke Gate builds it in CI), so the browser numbers are
not reproduced here.

| | |
|---|---|
| Fixture | `minimal-2d-replay` — the trace a "hold `move_right` for 120 ticks" recording produces (the same trace `inputReplay.spec.ts` replays); fixture definition `web/e2e/fixtures/minimal-2d-replay-fixture.ts` |
| Runs | 20 per cadence; each run pauses at a tick between 5 and 14, resumes, then cancels three ticks later — 120 acknowledgement samples in all (pause + resume + cancel, both cadences) |
| Machine | AMD Ryzen 7 3800X (8 cores, 16 threads), 63.9 GB RAM, Windows 11 Home 10.0.26200 (build 26200) |
| Runtime | Node v24.5.0 (`npx tsx`), Git Bash; no other test run in progress |
| Git | branch `claude/10007-pinned-replay-gate`; re-measured on 2026-10-06 (`measuredAt` in the JSON) against the runner as committed in `f97c8ebfa` and its predecessors — the script and the runner are unchanged after the measurement |
| Reproduce | `cd web && npx tsx scripts/measure-replay-nfr.ts` — rewrites `replay-nfr.json` and prints the summary and a PASS / FAIL verdict |

## Results

Acknowledgement is the time from the control call to the subscriber seeing the
matching state: `pausing` and `cancelling` are set synchronously inside the
call; `running` (after resume) is reached one microtask later, once the runtime
has been asked to resume. "Settle" is the time to the settled state. A pause
settles as `paused` (every synthetic key released, runtime paused) at the next
tick boundary, so it is bounded by one engine frame — the boundary is what
makes "paused at tick 60" exact. A cancel settles as `cancelled` (keys
released, runtime restored, clock unpinned) without waiting for the frame in
flight, because a stopped engine never ticks again; it is bounded by microtasks,
not by the frame.

| Metric | 60 fps (16.7 ms frames) | 15 fps (66.7 ms frames) | Limit |
|---|---|---|---|
| Acknowledgement, all controls, n=120 | p50 0.004 ms · **p95 0.030 ms** · max 0.117 ms | (pooled across both cadences) | p95 <= 100 ms |
| Pending display (`pinning` visible after `startReplay` returns), n=20 each | p95 1.16 ms | p95 1.11 ms | <= 250 ms |
| Progress (`running`, after the pin round-trip and one frame), n=20 each | p95 31.5 ms | p95 79.3 ms | — (context) |
| Pause settle (`paused`), n=20 each | p95 31.5 ms | p95 77.6 ms | — (one frame) |
| Cancel settle (`cancelled`), n=20 each | p95 0.073 ms | p95 0.064 ms | — (microtasks) |

Verdict: **PASS** — acknowledgement p95 is three orders of magnitude inside the
100 ms limit, and the pending state is visible within a few milliseconds at
either cadence. The settle times are reported so that a reader does not mistake
"acknowledged" for "settled": at 15 fps a pause takes up to one frame (~80 ms)
to release input, which is the engine's cadence, not the runner's latency; a
cancel releases input in well under a millisecond at either cadence because it
does not wait for the frame (an earlier draft of the runner did, and measured
~32 / ~79 ms here — the same as a pause — which is what prompted the change).

## Read these numbers with the environment in mind

- **Fake boundary, real timer.** Frames were scheduled with `setTimeout` at the
  cadence's period, so the settle numbers include Node's timer granularity. The
  acknowledgement path has no timer in it at all.
- **The panel's own render is not in these numbers.** `PlaytestPanel` renders
  the progress line from the same subscription in the same React commit as the
  state change; `web/src/components/editor/__tests__/PlaytestPanel.replayControls.test.tsx`
  asserts the line is on screen within `REPLAY_NFR_PENDING_DISPLAY_MS` of the
  click in jsdom and prints the measured value.
- **Main-thread contention is not modelled.** A real editor frame that stalls
  the main thread delays every microtask with it; the browser-side attachment
  from the CI spec is the measurement that includes that.
