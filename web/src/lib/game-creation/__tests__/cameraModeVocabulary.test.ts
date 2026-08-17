/**
 * The camera mode vocabulary two modules must agree on.
 *
 * `systemDecomposer.ts` PRODUCES camera mode strings and `cameraResolution.ts`
 * CONSUMES them, and nothing connected the two: three of the decomposer's own
 * spellings (`side-scroll`, `orbit`, `follow`) had no alias entry, so they fell
 * through to the unknown-mode fallback. Every 2D side-scroller the decomposer
 * produced was therefore configured as a third-person follow camera — the exact
 * "looks applied, does nothing" symptom PF-1125 was filed to fix, surviving
 * inside the fix, because an unmapped mode does not throw. It silently becomes
 * the default.
 *
 * A unit test of `normalizeCameraMode` against a hand-written list could not
 * catch this: the list would have been written from the same guesses that
 * produced the alias table. So this reads the PRODUCER'S OWN source text and
 * fails when it emits a spelling the consumer cannot resolve.
 *
 * Fails closed — an unreadable file, a block it cannot find, or an empty
 * extraction is a failure, never a vacuous pass.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeCameraMode } from '../cameraResolution';

// `__dirname`-relative, not cwd-relative: vitest's working directory depends on
// where the runner was invoked from, and a path that resolves only from `web/`
// turns into an unreadable-file failure the moment the suite is run elsewhere.
const DECOMPOSER_PATH = join(__dirname, '..', '..', 'ai', 'systemDecomposer.ts');

function readDecomposer(): string {
  try {
    return readFileSync(DECOMPOSER_PATH, 'utf8');
  } catch (err) {
    throw new Error(
      `Could not read the camera mode producer at ${DECOMPOSER_PATH}: ${String(err)}. ` +
        'If it moved, repoint this test — do not delete it.',
    );
  }
}

/**
 * Every camera mode string `systemDecomposer.ts` can emit.
 *
 * Two sources, because the file has two: the keyword table's `defaultType`
 * values, and the hardcoded push that guarantees every game gets a camera even
 * when no keyword matched. The second one is where `follow` comes from — the
 * single most common mode in practice, and one of the three that was unmapped.
 */
function producedCameraModes(src: string): string[] {
  const block = /camera:\s*\[([\s\S]*?)\n\s*\],/.exec(src);
  if (!block) {
    throw new Error(
      'Could not locate the `camera:` keyword block in systemDecomposer.ts. ' +
        'The shape changed — update this parser rather than dropping the check.',
    );
  }
  const fromTable = [...block[1].matchAll(/defaultType:\s*'([^']+)'/g)].map((m) => m[1]);

  const fromDefault = [
    ...src.matchAll(/category:\s*'camera',\s*type:\s*'([^']+)'/g),
  ].map((m) => m[1]);

  return [...new Set([...fromTable, ...fromDefault])];
}

describe('camera mode vocabulary', () => {
  const modes = producedCameraModes(readDecomposer());

  it('extracts the producer vocabulary rather than passing vacuously', () => {
    // A parser that silently matched nothing would make every case below pass.
    expect(modes.length).toBeGreaterThanOrEqual(6);
    expect(modes).toContain('side-scroll');
    expect(modes).toContain('follow');
  });

  it.each(modes.map((m) => [m]))(
    'resolves the decomposer spelling %s to a real engine mode',
    (raw) => {
      // The probe: normalize the SAME string under both project types. A mode the
      // table actually recognizes resolves identically either way, because the
      // project type only ever chooses the FALLBACK. A mode that falls through
      // gets `sideScroller` for 2D and `thirdPersonFollow` for 3D, so the two
      // disagreeing is exactly "this spelling reached the engine as a guess".
      //
      // This matters because the fallback is a legitimate mode: `follow` used to
      // resolve "correctly" only because the mode it means happens to be the
      // default, and comparing against an expected value could never see that.
      const as2d = normalizeCameraMode(raw, '2d');
      const as3d = normalizeCameraMode(raw, '3d');
      expect(
        as2d,
        `"${raw}" is emitted by systemDecomposer.ts but has no entry in ` +
          'CAMERA_MODE_ALIASES, so it silently becomes the fallback camera. ' +
          'Add it to the alias table in cameraResolution.ts.',
      ).toBe(as3d);
    },
  );
});
