/**
 * @vitest-environment node
 *
 * A COST CEILING FOR THE FAST PATH, as a gate rather than a number in prose.
 *
 * `scripts/bench-egress-guard.ts` exists because the previous PR quoted timings
 * with no harness anywhere in the diff — no method, no environment, no way to
 * re-check them after a change (lessons-learned #8 and #10). But a harness run
 * only by hand has the same defect one level up: it is the comparison half of a
 * gate whose other half never runs, which is lessons-learned #13 exactly. The
 * regression it documents having measured and avoided — a per-character index
 * map, +23.8 ms against +5.0 ms on a 350 KB scene — could be reintroduced with
 * nothing failing. The harness stays, for diagnosis; this is the gate.
 *
 * IT IS A RATIO, NOT A DURATION. Absolute milliseconds do not survive a shared
 * CI runner, and a flaky gate gets deleted rather than fixed. The baseline is
 * `JSON.parse` + `JSON.stringify` of the SAME body, measured in the SAME
 * process moments earlier, so machine speed, thermal state and neighbour load
 * cancel out of the quotient. The guard's fast path does strictly less work
 * than that baseline in principle — it scans linearly and never parses — so a
 * generous multiple still catches a change of the shape that regressed.
 *
 * The statistic is the MINIMUM over the samples, not the mean. A scheduler
 * preemption can only ever make a sample slower, so the minimum is the least
 * noisy estimate of the work actually being done, and the one that makes a
 * false failure hardest to produce.
 */
import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import { withEgressGuard } from '@/lib/security/egressGuard';
import { buildDeepSceneBody } from './deepSceneBody';

/**
 * How many times the guard's fast path may cost what a parse + re-serialise of
 * the same bytes costs.
 *
 * THE NUMBER IS DERIVED, not picked. Measured on this tree across four runs the
 * ratio sits at 0.75-0.79 — the scan is cheaper than the parse it replaces. The
 * regression this gate exists to catch was ~4.8x, which would put the ratio near
 * 3.6, so a useful ceiling has to sit between about 0.8 and 3.6. Two is near the
 * midpoint on a log scale: 2.5x headroom over the measured value for CI noise,
 * and a 4.8x regression still misses it by nearly a factor of two.
 *
 * A first cut used 4, and that would have been worse than no gate at all: the
 * regression would have scraped under it and the check would have reported the
 * change as fine. A ceiling nobody derived is a ceiling nobody can trust.
 */
const MAX_RATIO = 2;
const SAMPLES = 12;
const WARMUP = 4;

function minMs(run: () => void | Promise<void>): Promise<number> {
  return (async () => {
    for (let i = 0; i < WARMUP; i += 1) await run();
    let best = Infinity;
    for (let i = 0; i < SAMPLES; i += 1) {
      const t0 = performance.now();
      await run();
      const dt = performance.now() - t0;
      if (dt < best) best = dt;
    }
    return best;
  })();
}

describe('withEgressGuard — the fast path has a cost ceiling that can fail', () => {
  it('scans a large scene body for no more than a parse and re-serialise of it', async () => {
    const body = JSON.stringify(buildDeepSceneBody());
    // The body has to be big enough that the measurement is about the work and
    // not about timer resolution. This asserts the fixture, so the gate cannot
    // quietly start grading a trivial payload.
    expect(body.length).toBeGreaterThan(100_000);

    const baseline = await minMs(() => {
      JSON.stringify(JSON.parse(body));
    });

    const handler = withEgressGuard(async () =>
      new NextResponse(body, { headers: { 'content-type': 'application/json' } }));

    const guarded = await minMs(async () => {
      await (await handler()).text();
    });

    // A baseline of zero would make the ratio meaningless and the assertion
    // unfailable, so it is checked rather than assumed (lessons-learned #11).
    expect(baseline).toBeGreaterThan(0);
    expect(guarded / baseline).toBeLessThan(MAX_RATIO);
  });
});
