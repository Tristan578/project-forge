/**
 * measure-replay-nfr.ts — NFR-C1 timing for the replay controls (#10007).
 *
 * Measures, against a deterministic fake engine ticking at a real wall-clock
 * cadence, what the shared #9773 NFR asks of the runner:
 *   - LOCAL ACKNOWLEDGEMENT: the time from calling `pause()` / `resume()` /
 *     `cancel()` on a replay handle to the subscriber receiving the matching
 *     state (`pausing` / `running` / `cancelling`). Target: p95 <= 100 ms.
 *   - PENDING DISPLAY: the time from `startReplay()` returning to the first
 *     progress notification a UI can render (`pinning`), and to `running`
 *     (after the pin round-trip and one engine frame). Target: <= 250 ms.
 *   - SETTLE: the time from `pause()` to `paused` (input released, runtime
 *     paused), which is bounded by one engine frame and reported for context.
 *
 * It writes the raw samples, percentiles and the machine manifest to
 * `docs/performance/evidence/<date>-replay-controls/replay-nfr.json` and prints
 * a summary. Run from `web/`:
 *
 *   npx tsx scripts/measure-replay-nfr.ts
 *
 * The fake engine is the runner's boundary only — key presses, frames,
 * observation, clock pin — not the WASM engine, so these numbers measure the
 * runner and its control surface (pure JS), which is also what the NFR names.
 * The same acknowledgement and pending timings are measured in the real browser
 * against the live engine by `e2e/engine/inputReplay.spec.ts` and attached to
 * its evidence on every CI run.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  startReplay,
  type ReplayEnvironment,
  type ReplayHandle,
  type ReplayObservation,
  type ReplayRunState,
} from '../src/lib/playtest/replayRunner';
import { INPUT_TRACE_VERSION, type InputTrace } from '../src/lib/playtest/inputTrace';

const FIXTURE_ID = 'minimal-2d-replay';
const TICKS = 120;
const RUNS_PER_CADENCE = 20;
/** Frame cadences to drive: a desktop refresh and a SwiftShader-like crawl. */
const CADENCES_HZ = [60, 15] as const;
const EVIDENCE_DIR = join(process.cwd(), '..', 'docs', 'performance', 'evidence', '2026-10-05-replay-controls');

function trace(): InputTrace {
  return {
    version: INPUT_TRACE_VERSION,
    fixtureId: FIXTURE_ID,
    actionNames: ['move_right'],
    durationMs: TICKS * 16,
    frames: Array.from({ length: TICKS }, (_, tick) => ({
      tick,
      actions: { move_right: { pressed: true, axis: 1 } },
    })),
  };
}

/** A fake engine whose frames arrive on a wall-clock timer at `cadenceHz`. */
function makeEngine(cadenceHz: number) {
  const held = new Set<string>();
  let x = 0;
  let coin = true;
  let paused = false;
  const frameMs = 1000 / cadenceHz;
  const observe = (): ReplayObservation => {
    const entities: ReplayObservation['entities'] = { player: { position: [x, 0, 0] } };
    if (coin) entities.coin = { position: [1, 0, 0] };
    return { entities };
  };
  const env: ReplayEnvironment = {
    resolveKeys: (name) => (name === 'move_right' ? ['KeyD'] : []),
    pressKeys: (codes) => {
      for (const c of codes) held.add(c);
    },
    releaseKeys: (codes) => {
      for (const c of codes) held.delete(c);
    },
    advanceFrame: () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          if (!paused) {
            if (held.has('KeyD')) x += 0.05;
            if (coin && x >= 1) coin = false;
          }
          resolve();
        }, frameMs);
      }),
    observe,
    playerEntityId: 'player',
    collectibleEntityIds: ['coin'],
    pinFrameRate: () => true,
    unpinFrameRate: () => undefined,
    pauseRuntime: () => {
      paused = true;
    },
    resumeRuntime: () => {
      paused = false;
    },
  };
  return env;
}

function waitForState(handle: ReplayHandle, state: ReplayRunState): Promise<number> {
  return new Promise((resolve) => {
    if (handle.getProgress().state === state) {
      resolve(performance.now());
      return;
    }
    const unsubscribe = handle.subscribe((p) => {
      if (p.state === state) {
        unsubscribe();
        resolve(performance.now());
      }
    });
  });
}

function percentile(samples: number[], p: number): number {
  if (samples.length === 0 || samples.some((s) => !Number.isFinite(s))) {
    throw new Error('a sample is missing or non-finite; the measurement is not trustworthy');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function summarize(samples: number[]) {
  return {
    n: samples.length,
    p50Ms: round(percentile(samples, 50)),
    p95Ms: round(percentile(samples, 95)),
    maxMs: round(Math.max(...samples)),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

interface CadenceSamples {
  pendingPinningMs: number[];
  pendingRunningMs: number[];
  pauseAckMs: number[];
  pauseSettleMs: number[];
  resumeAckMs: number[];
  cancelAckMs: number[];
  cancelSettleMs: number[];
}

async function measureCadence(cadenceHz: number): Promise<CadenceSamples> {
  const samples: CadenceSamples = {
    pendingPinningMs: [],
    pendingRunningMs: [],
    pauseAckMs: [],
    pauseSettleMs: [],
    resumeAckMs: [],
    cancelAckMs: [],
    cancelSettleMs: [],
  };
  for (let run = 0; run < RUNS_PER_CADENCE; run += 1) {
    const env = makeEngine(cadenceHz);
    let firstNotification = Number.NaN;
    const t0 = performance.now();
    const handle = startReplay(trace(), env, {
      onHandle: (h) => {
        h.subscribe(() => {
          if (Number.isNaN(firstNotification)) firstNotification = performance.now();
        });
      },
    });
    // The pending state exists as soon as the handle does.
    const pinningAt = handle.getProgress().state === 'pinning' ? performance.now() : Number.NaN;
    samples.pendingPinningMs.push(pinningAt - t0);
    const runningAt = await waitForState(handle, 'running');
    samples.pendingRunningMs.push(runningAt - t0);

    // Let a few ticks run, then pause: acknowledgement is the synchronous
    // transition to `pausing`; settle is `paused` (input released).
    const pauseTick = 5 + (run % 10);
    await new Promise<void>((resolve) => {
      const unsubscribe = handle.subscribe((p) => {
        if (p.state === 'running' && p.tick >= pauseTick) {
          unsubscribe();
          resolve();
        }
      });
    });
    const pausedPromise = waitForState(handle, 'paused');
    const pausingPromise = waitForState(handle, 'pausing');
    const pauseCall = performance.now();
    handle.pause();
    samples.pauseAckMs.push((await pausingPromise) - pauseCall);
    const pausedAt = await pausedPromise;
    samples.pauseSettleMs.push(pausedAt - pauseCall);

    // Resume: acknowledged as the transition back to `running`, which the
    // runner reaches once the runtime has been asked to resume — a microtask
    // after the call, not a frame.
    const runningPromise = waitForState(handle, 'running');
    const resumeCall = performance.now();
    handle.resume();
    samples.resumeAckMs.push((await runningPromise) - resumeCall);

    // Cancel mid-run: acknowledgement is `cancelling`; settle is `cancelled`.
    await new Promise<void>((resolve) => {
      const unsubscribe = handle.subscribe((p) => {
        if (p.state === 'running' && p.tick >= pauseTick + 3) {
          unsubscribe();
          resolve();
        }
      });
    });
    const cancellingPromise = waitForState(handle, 'cancelling');
    const cancelCall = performance.now();
    handle.cancel();
    samples.cancelAckMs.push((await cancellingPromise) - cancelCall);
    const result = await handle.result;
    samples.cancelSettleMs.push(performance.now() - cancelCall);
    if (result.status !== 'cancelled') throw new Error(`run ${run} ended ${result.status}`);
  }
  return samples;
}

async function main() {
  const cadences: Record<string, unknown> = {};
  const allAcks: number[] = [];
  for (const cadenceHz of CADENCES_HZ) {
    const samples = await measureCadence(cadenceHz);
    allAcks.push(...samples.pauseAckMs, ...samples.resumeAckMs, ...samples.cancelAckMs);
    cadences[`${cadenceHz}fps`] = {
      frameMs: round(1000 / cadenceHz),
      pendingPinning: summarize(samples.pendingPinningMs),
      pendingRunning: summarize(samples.pendingRunningMs),
      pauseAck: summarize(samples.pauseAckMs),
      pauseSettle: summarize(samples.pauseSettleMs),
      resumeAck: summarize(samples.resumeAckMs),
      cancelAck: summarize(samples.cancelAckMs),
      cancelSettle: summarize(samples.cancelSettleMs),
      samples,
    };
  }
  const cpu = cpus()[0];
  const report = {
    issue: '#10007',
    nfr: 'NFR-C1 (#9773): local acknowledgement p95 <= 100 ms; pending/progress display <= 250 ms',
    measuredAt: new Date().toISOString(),
    fixture: { id: FIXTURE_ID, ticks: TICKS, trace: 'hold move_right for 120 ticks' },
    machine: {
      platform: `${platform()} ${release()}`,
      cpu: cpu?.model ?? 'unknown',
      logicalCores: cpus().length,
      totalMemoryGiB: round(totalmem() / 1024 ** 3),
      node: process.version,
    },
    runsPerCadence: RUNS_PER_CADENCE,
    acknowledgementAllControls: summarize(allAcks),
    limits: { ackP95Ms: 100, pendingDisplayMs: 250 },
    cadences,
  };
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const out = join(EVIDENCE_DIR, 'replay-nfr.json');
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  const ack = report.acknowledgementAllControls;
  console.log(`machine: ${report.machine.cpu} / ${report.machine.platform} / node ${report.machine.node}`);
  console.log(`acknowledgement (pause+resume+cancel, n=${ack.n}): p50 ${ack.p50Ms} ms, p95 ${ack.p95Ms} ms, max ${ack.maxMs} ms`);
  for (const [name, data] of Object.entries(cadences) as Array<[string, Record<string, { p95Ms: number; maxMs: number }>]>) {
    console.log(
      `${name}: pending(pinning) p95 ${data.pendingPinning.p95Ms} ms; pending(running) p95 ${data.pendingRunning.p95Ms} ms; ` +
        `pause settle p95 ${data.pauseSettle.p95Ms} ms; cancel settle p95 ${data.cancelSettle.p95Ms} ms`,
    );
  }
  console.log(`wrote ${out}`);
  const pendingOk = Object.values(cadences).every(
    (c) => (c as { pendingPinning: { p95Ms: number } }).pendingPinning.p95Ms <= 250,
  );
  const verdict = ack.p95Ms <= 100 && pendingOk ? 'PASS' : 'FAIL';
  console.log(`verdict: ${verdict}`);
  process.exitCode = verdict === 'PASS' ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
