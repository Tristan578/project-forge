/**
 * @vitest-environment node
 *
 * Every name in `SCRIPT_ALLOWED_COMMANDS` must be a name that can actually DO
 * something — or sit on the waiver list below WITH a reason and a ticket.
 *
 * Why this pin exists. `SCRIPT_ALLOWED_COMMANDS` is the second, independent
 * list of command names this product ships, and until PF-1180 (#9284) nothing
 * had ever checked it against the engine. `stores/slices/__tests__/
 * commandArmParity.test.ts` covers the store's names; this covers the script
 * sandbox's. It is the more visible of the two, because the user WROTE the call:
 * `forgeTypes.ts` declares `forge.input.vibrate`, Monaco autocompletes it, the
 * worker pushes `{ cmd: 'vibrate' }`, `dispatchCommand` posts it,
 * `commands::dispatch` answers `Err("Unknown command: vibrate")`, and nobody
 * reads that. Sixteen names were in exactly that state.
 *
 * A name is reachable two ways, and this pin accepts both:
 *
 *  1. ENGINE — `route_domain` names it AND its domain module has a non-stub arm.
 *     Both halves are required; an arm the router does not name is dead however
 *     correct it is, and an arm that returns `Not yet implemented` is absent.
 *     Shared with the store pin via `lib/engine/__tests__/engineCommandArms.ts`,
 *     so the two cannot drift apart.
 *
 *  2. JS-SIDE — `localScriptCommands.ts` answers it before dispatch. That is
 *     read out of the source, NOT hardcoded here: a second hand-maintained list
 *     would be one more thing to keep in step, and the copy that fell behind
 *     would go on reporting green. The behaviour behind each of those cases is
 *     asserted separately, at runtime, in `localScriptCommands.test.ts`.
 *
 * Staleness runs in BOTH directions: a waiver that becomes reachable fails, and
 * a waiver naming something no longer in the allowlist fails. Every scan asserts
 * it matched something first — a walk over zero items reports zero problems and
 * reads exactly like coverage (lessons 9 and 11).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCRIPT_ALLOWED_COMMANDS } from '../scriptAllowlist';
import { blockAt, readEngineArms } from '@/lib/engine/__tests__/engineCommandArms';

const LOCAL_HANDLER_PATH = join(__dirname, '..', 'localScriptCommands.ts');
const LOCAL_HANDLER_FN = 'export function handleLocalScriptCommand(';

/**
 * Allowed names that reach neither an engine arm nor a JS-side case. Each entry
 * MUST carry a reason and a ticket; the staleness checks below fail if an entry
 * becomes reachable or stops being allowed, so this list cannot rot.
 */
const ALLOWED_UNREACHABLE: Record<string, string> = {
  // Empty, and that is the intended steady state. PF-1180 resolved all sixteen
  // phantoms by wiring nine JS-side and deleting seven along with the `forge.*`
  // methods and `forgeTypes.ts` declarations that reached them. An entry here is
  // a name a user can write and get silence from.
};

interface LocalArms {
  /** Command names `handleLocalScriptCommand` has a `case` for. */
  names: Set<string>;
  /** Cases whose body never reaches `return true` — i.e. they answer nothing. */
  inert: string[];
}

/**
 * Command names answered by `localScriptCommands.ts`.
 *
 * Deliberately NOT pointed at `useScriptRunner.ts`, which the handler used to
 * live in: that file's other `switch` runs over worker MESSAGE types
 * (`camera_set_mode`, `scene_load`, `dialogue_start`) which wear the same
 * `case '…':` clothes but are not command names at all, and a scanner there
 * would silently bless any allowlist entry that happened to share a message
 * name.
 *
 * Fails closed: a missing file, a missing function or unbalanced braces throw
 * rather than yielding an empty set that would read as "nothing is handled
 * JS-side" and turn every JS-side name into a reported phantom — loud, but for
 * the wrong reason — or, worse, be silently swallowed by a `catch`.
 */
function readLocalArms(): LocalArms {
  const source = readFileSync(LOCAL_HANDLER_PATH, 'utf8');
  const at = source.indexOf(LOCAL_HANDLER_FN);
  if (at === -1) {
    throw new Error(
      `localScriptCommands.ts has no \`${LOCAL_HANDLER_FN}\` — this scanner is broken, ` +
        'not the code it scans. Fix the anchor before trusting a green run.',
    );
  }
  const open = source.indexOf('{', source.indexOf(')', at));
  if (open === -1) throw new Error('handleLocalScriptCommand has no body');
  const body = blockAt(source, open);

  // Split on the case labels themselves so each name is paired with the text
  // that follows it, up to the next label. A `case` that never reaches
  // `return true` falls through to `default: return false` and the command goes
  // to the engine after all — present in the source, absent in effect.
  const labels = [...body.matchAll(/case '([a-z0-9_]+)':/g)];
  const names = new Set<string>();
  const inert: string[] = [];
  for (const [index, label] of labels.entries()) {
    names.add(label[1]);
    const from = (label.index ?? 0) + label[0].length;
    const to = labels[index + 1]?.index ?? body.length;
    const arm = body.slice(from, to);
    // A bare `case 'a':` immediately followed by `case 'b':` is a deliberate
    // fallthrough and shares the next arm's body, so an empty slice is fine.
    if (arm.trim().length > 0 && !arm.includes('return true')) inert.push(label[1]);
  }
  return { names, inert };
}

describe('SCRIPT_ALLOWED_COMMANDS names can actually run', () => {
  const arms = readEngineArms();
  const local = readLocalArms();
  const allowed = [...SCRIPT_ALLOWED_COMMANDS];

  const reach = (name: string): 'engine' | 'js' | null => {
    if (arms.implemented.has(name)) return 'engine';
    if (local.names.has(name)) return 'js';
    return null;
  };

  describe('the parsers actually parsed something', () => {
    it('read the engine command modules', () => {
      expect(arms.fileCount).toBeGreaterThan(5);
      expect(arms.implemented.size).toBeGreaterThan(200);
      // A collapsed stub scan would score every `Not yet implemented` arm as
      // working, which is the precise blind spot that let `set_velocity` look
      // one rename away from fixed when `set_linear_velocity` is a stub too.
      expect(arms.stubbed.size).toBeGreaterThan(20);
      expect(arms.routed.size).toBeGreaterThan(200);
    });

    it('read the allowlist', () => {
      expect(allowed.length).toBeGreaterThan(40);
    });

    it('read the JS-side handler', () => {
      // Ten `audio_*` names predate PF-1180, so anything at or below that count
      // means the scan is only partly working.
      expect(local.names.size).toBeGreaterThan(10);
    });

    it('every JS-side case actually answers the command', () => {
      expect(
        local.inert,
        'These `case` labels exist but never `return true`, so the command falls ' +
          'through to the engine anyway. A case that does not answer is not a ' +
          'JS-side arm, and must not be counted as one.',
      ).toEqual([]);
    });

    it.each(['audio_add_layer', 'audio_detect_loop_points', 'vibrate'])(
      'scores %s as answered JS-side',
      (name) => {
        expect(local.names.has(name)).toBe(true);
        // The engine has never known these; if the engine scan starts claiming
        // one, the two scans disagree and one of them is wrong.
        expect(arms.implemented.has(name)).toBe(false);
      },
    );

    it.each(['spawn_entity', 'apply_force2d', 'paint_tile', 'play_skeletal_animation2d'])(
      'scores %s as an engine command',
      (name) => {
        expect(arms.implemented.has(name)).toBe(true);
        expect(local.names.has(name)).toBe(false);
      },
    );

    it.each([
      // Near-miss spellings PF-1180 had to rule out by NAME, not by shape:
      // each is a real arm that only LOOKS like the phantom next to it.
      ['set_velocity', 'set_linear_velocity'],
      ['set_velocity2d', 'set_linear_velocity_2d'],
      ['set_angular_velocity2d', 'set_angular_velocity_2d'],
    ])('does not treat the stub %s#1 / %s#2 pair as a working arm', (phantom, nearMiss) => {
      // The phantom is gone from the allowlist entirely…
      expect(SCRIPT_ALLOWED_COMMANDS.has(phantom)).toBe(false);
      // …and renaming to the near miss would not have helped: the near miss is
      // routed but answers `Not yet implemented`, so it is not an escape hatch
      // for a future reviewer who spots the resemblance.
      expect(arms.stubbed.has(nearMiss)).toBe(true);
      expect(arms.implemented.has(nearMiss)).toBe(false);
    });
  });

  it('every allowed command reaches an engine arm or a JS-side case', () => {
    const unreachable = allowed
      .filter((name) => reach(name) === null)
      .filter((name) => !Object.hasOwn(ALLOWED_UNREACHABLE, name));
    expect(
      unreachable,
      'A user script may emit these and nothing will answer. Fix the spelling, ' +
        'add the engine arm, answer it in localScriptCommands.ts, or delete the ' +
        'name AND the forge.* method and forgeTypes.ts declaration that reach it. ' +
        'A waiver needs a reason and a ticket.',
    ).toEqual([]);
  });

  it('no name is answered in both places', () => {
    // Both would run: `useScriptRunner` answers JS-side and skips dispatch, so
    // an engine arm of the same name silently stops being reached.
    const both = allowed.filter((name) => arms.implemented.has(name) && local.names.has(name));
    expect(
      both,
      'These have an engine arm AND a JS-side case. The JS-side case wins and the ' +
        'engine arm goes dead — pick one.',
    ).toEqual([]);
  });

  it('every JS-side case is a name scripts may actually emit', () => {
    const orphaned = [...local.names].filter((name) => !SCRIPT_ALLOWED_COMMANDS.has(name));
    expect(
      orphaned,
      'localScriptCommands.ts answers these but the allowlist does not permit them, ' +
        'so `useScriptRunner` never reaches the case. Add them to the allowlist or ' +
        'delete the dead arm.',
    ).toEqual([]);
  });

  it('every waiver carries a reason', () => {
    const bare = Object.entries(ALLOWED_UNREACHABLE)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([name]) => name);
    expect(bare, 'A waiver without a real reason is not a waiver.').toEqual([]);
  });

  it('no waiver names a command that is now reachable', () => {
    const stale = Object.keys(ALLOWED_UNREACHABLE).filter((name) => reach(name) !== null);
    expect(
      stale,
      'These are implemented now — delete their ALLOWED_UNREACHABLE entries.',
    ).toEqual([]);
  });

  it('no waiver names a command that is no longer allowed', () => {
    const orphaned = Object.keys(ALLOWED_UNREACHABLE).filter(
      (name) => !SCRIPT_ALLOWED_COMMANDS.has(name),
    );
    expect(
      orphaned,
      'These are not in SCRIPT_ALLOWED_COMMANDS any more — delete their waivers.',
    ).toEqual([]);
  });
});
