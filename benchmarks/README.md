# Performance benchmarks

This directory holds `baseline.json` — the recorded timings that
`scripts/run-benchmarks.sh` compares every run against.

## What actually runs

| Piece | File |
|---|---|
| The benchmarks (real product code) | `web/src/lib/perf/__tests__/productBenchmarks.test.ts` |
| Comparator helpers used by product code | `web/src/lib/perf/benchmark.ts` |
| Comparator used by CI (no TS runner at that point) | `scripts/compare-benchmarks.mjs` |
| Comparator's own tests | `scripts/compare-benchmarks.test.mjs` (`node --test`) |
| Driver | `scripts/run-benchmarks.sh` |
| Workflow | `.github/workflows/benchmarks.yml` |
| Budget table (documentation, not the gate) | `web/src/lib/perf/baselines.ts` |

Run it locally:

```bash
bash scripts/run-benchmarks.sh                     # measure and compare
bash scripts/run-benchmarks.sh --update-baseline   # re-record
node --test scripts/compare-benchmarks.test.mjs    # comparator unit tests
```

## History: why this exists

Issue #6697 was closed COMPLETED for "add a benchmark harness". What actually
shipped was `scripts/run-benchmarks.sh` — a complete regression comparator
that no workflow invoked, pointed at a `benchmarks/` directory containing
nothing but `.gitkeep`, so it had no baseline and had never run. It also
hardcoded `web/node_modules/.bin/vitest`; this repo has a single root
lockfile, so that path does not exist on any checkout and the script would
have failed immediately if anyone had tried to run it.

The only thing the "performance suite" ran was `benchmark.test.ts`, which
builds hand-written `makeResult()` objects with hardcoded timings and asserts
on those. It times no product code at all, and still does not, by design — it
is the comparator's unit test and is labelled as such.

PF-9458 (#9458) is the follow-up that wires the whole thing together. Do not
close a benchmark ticket on a harness's existence again: check that each
benchmark calls a named product function, and that a baseline is committed.

## Machine variance

Wall-clock timing on a shared GitHub-hosted runner is noisy. Four mechanisms
absorb that.

**1. Warm-up.** `BENCH_WARMUP` unmeasured calls run before the timed ones (5
locally, 20 in the workflow), so JIT tier-up and first-touch allocation are
not charged to iteration 1.

**2. Iterations.** `BENCH_ITERATIONS` samples per benchmark (40 locally, 200
in the workflow). The reported metrics are order statistics over that many
samples, so a single preempted iteration cannot move the median.

**3. Batching.** The comparator ignores any pair of readings where both sides
sit at or below a 0.05 ms noise floor, because the ratio between two
sub-microsecond readings is clock granularity rather than signal. A benchmark
whose timing lands under that floor is therefore *silently unguarded*: it
could get ten times slower and nothing would be reported. Every benchmark
here is batched — its product call repeated N times inside one measured
iteration — until it clears roughly 3x the floor. Batch sizes live next to
the benchmarks as named constants and are part of each benchmark's
definition: change one and the baseline must be re-recorded.

Batch sizes are chosen by measuring, not by dividing the floor by a
single-call timing. Repeating a hot path over the same input lets V8's inline
caches amortize it, so per-repetition cost falls as the batch grows —
`material-preset-lookup` needed 128 repetitions where arithmetic predicted 5.

`findUnguarded()` in the comparator turns this from a convention into a
check. If a committed baseline entry drops under the floor, the run reports
`UNGUARDED: "<name>" ...` and exits non-zero. The fix is always to raise that
benchmark's batch size, never to lower the floor.

**4. Metric choice and threshold.** The comparator compares `min` and `p50`
only, at a **3.0x** threshold. Both were chosen by measuring. Five
back-to-back runs of *identical* code at 200 iterations on one machine gave
these worst-case run-to-run spreads:

| Metric | Worst-case spread on identical code |
|---|---|
| `min` | 1.80x |
| `p50` | 1.96x |
| `avg` | 5.93x |
| `p95` | 10.79x |
| `p99` | 79.28x |

`avg`, `p95` and `p99` are unusable as a CI signal — they are dominated by GC
pauses and scheduler preemption, and a gate built on them would fire on
identical code. `min` and `p50` are stable. 3.0x sits above the observed
1.96x `p50` ceiling with headroom for a runner noisier than the machine those
numbers came from.

A tighter gate (1.2x, 1.5x) would be permanently red and would get ignored,
which is worse than no gate. 3.0x still catches the failure mode that matters
— an algorithmic regression, a linear scan turning quadratic — which shows up
as 5x-50x, not 2.9x.

## Why the CI job does not block merges

`.github/workflows/benchmarks.yml` is not a required check, and its timing
step carries `continue-on-error`. Timings on a shared runner move for reasons
that have nothing to do with the PR being tested, and a check that goes red
for unrelated reasons is a check people learn to click past. The regression
signal is delivered as a workflow annotation plus a job summary instead, both
visible on the PR without blocking a merge.

The comparator's own unit tests are deterministic and *do* fail the job. Only
the timing comparison is advisory.

## Re-recording the baseline

```bash
bash scripts/run-benchmarks.sh --update-baseline
```

Then commit `benchmarks/baseline.json` **and say in the commit message why the
numbers moved**. A baseline re-recorded without a reason is how a real
regression gets absorbed into the reference and disappears.

`benchmarks/.gitignore` ignores `*.json` and then un-ignores this one file
deliberately: generated per-run reports do not belong in git, but a reference
that is not committed does not exist as far as CI is concerned.

## Adding a benchmark

1. Add an `it()` to `productBenchmarks.test.ts` that calls **real product
   code** — a named function reachable from a real caller in `src/`, running
   in node/jsdom with no WASM build.
2. Assert on **correctness**, never on timing. The everyday `vitest run` must
   stay deterministic; regression detection happens in the comparator.
3. Add a matching entry to `PERFORMANCE_BASELINES` in
   `web/src/lib/perf/baselines.ts`. A harness self-check fails if a measured
   benchmark has no budget entry, or if a registered budget goes unmeasured
   without an entry in `UNMEASURED_BASELINES` explaining why.
4. Re-record the baseline and confirm the new entry is not `UNGUARDED`.
