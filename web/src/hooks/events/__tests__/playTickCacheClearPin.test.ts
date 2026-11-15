// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Source pin for the engine-side play-tick cache clear (#10375).
 *
 * `engine/src/bridge/core_systems.rs` is wasm32-only: nothing native ever runs
 * `apply_mode_change_requests`, so deleting either `on_leaving_play()` call
 * fails no test before the engine-smoke E2E (`engine-smoke.spec.ts`, Step 3c),
 * which is the last gate on a PR and needs a WASM build. The rule the calls
 * implement is tested natively in `core/play_tick_delta.rs`; this pins that
 * the bridge invokes it in exactly the two arms that leave Play — Stop and
 * Pause — and nowhere else. Without the clear on those transitions, a pause
 * and a resume applied in one engine update leave the engine's cache full
 * while the editor's hub has already dropped its snapshot, and the next delta
 * omits every entity that did not move.
 *
 * Every count is of EXECUTABLE lines: anchored at line start, `//` lines
 * excluded, so commenting a call out turns this red (lessons #16). An
 * unreadable file or an arm that cannot be found fails; nothing here skips.
 */
const CORE_SYSTEMS = join(
  __dirname, '..', '..', '..', '..', '..', 'engine', 'src', 'bridge', 'core_systems.rs',
);

const ARMS = ['Play', 'Stop', 'Pause', 'Resume'] as const;
type Arm = (typeof ARMS)[number];

/** The one call shape the bridge uses; a line is counted only when it is exactly this. */
const CLEAR_CALL = /^\s*play_tick_cache\.on_leaving_play\(\);\s*$/;

/** Lines that are code, not `//` comments. */
function codeLines(source: string): string[] {
  return source.split(/\r?\n/).filter((line) => !/^\s*\/\//.test(line));
}

function readCoreSystems(): string {
  const source = readFileSync(CORE_SYSTEMS, 'utf8');
  expect(source.length, `${CORE_SYSTEMS} is empty`).toBeGreaterThan(0);
  return source;
}

/** The body of `apply_mode_change_requests`, bounded by the next system in the file. */
function modeChangeBody(source: string): string {
  const start = source.indexOf('fn apply_mode_change_requests(');
  expect(start, 'apply_mode_change_requests not found in core_systems.rs').toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\npub(super) fn ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

/**
 * The code lines of each `ModeChangeRequest::<Arm> =>` arm of the body's
 * `match request`, from the arm's own marker to the next arm's marker.
 */
function modeChangeArms(body: string): Record<Arm, string[]> {
  const starts = ARMS.map((arm) => ({ arm, at: body.indexOf(`ModeChangeRequest::${arm} =>`) }));
  for (const { arm, at } of starts) {
    expect(at, `ModeChangeRequest::${arm} arm not found in apply_mode_change_requests`).toBeGreaterThanOrEqual(0);
  }
  const ordered = [...starts].sort((a, b) => a.at - b.at);
  const arms = {} as Record<Arm, string[]>;
  ordered.forEach(({ arm, at }, i) => {
    const end = i + 1 < ordered.length ? ordered[i + 1].at : body.length;
    arms[arm] = codeLines(body.slice(at, end));
  });
  return arms;
}

describe('engine play-tick cache is cleared on every transition out of Play', () => {
  const source = readCoreSystems();
  const body = modeChangeBody(source);
  const arms = modeChangeArms(body);

  it('apply_mode_change_requests takes the cache as a system param', () => {
    const param = /^\s*mut play_tick_cache: ResMut<super::scripts::PlayTickCache>,\s*$/;
    expect(codeLines(body).filter((line) => param.test(line))).toHaveLength(1);
  });

  it.each<[Arm, number]>([
    ['Stop', 1],
    ['Pause', 1],
    ['Play', 0],
    ['Resume', 0],
  ])('the %s arm has %i executable on_leaving_play() call', (arm, count) => {
    // Non-vacuous: every arm has at least its guard and its mode write.
    expect(arms[arm].length, `${arm} arm parsed as empty`).toBeGreaterThan(1);
    expect(arms[arm].filter((line) => CLEAR_CALL.test(line))).toHaveLength(count);
  });

  it('has exactly two executable call sites in the whole file', () => {
    // The per-arm counts above cannot see a call that lands outside the
    // match (or in a different system); the file-wide count can.
    expect(codeLines(source).filter((line) => CLEAR_CALL.test(line))).toHaveLength(2);
  });
});
