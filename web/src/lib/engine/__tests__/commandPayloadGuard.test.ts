import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  checkCommandBatch,
  checkCommandPayload,
  MAX_BATCH_CONTAINERS,
  MAX_COMMAND_PAYLOAD_CONTAINERS,
  MAX_COMMAND_PAYLOAD_DEPTH,
} from '../commandPayloadGuard';

/**
 * Build `{a:{a:{…}}}` nested `levels` deep, iteratively.
 *
 * Built by hand for the same reason the Rust suite builds its fixture by hand:
 * a recursive helper overflows while constructing the input, which reads
 * exactly like the guard failing.
 */
function nestedObject(levels: number): unknown {
  let value: unknown = 1;
  for (let i = 0; i < levels; i += 1) {
    value = { a: value };
  }
  return value;
}

function nestedArray(levels: number): unknown {
  let value: unknown = 1;
  for (let i = 0; i < levels; i += 1) {
    value = [value];
  }
  return value;
}

describe('checkCommandPayload', () => {
  it('accepts a realistic payload', () => {
    expect(
      checkCommandPayload('update_game_component', {
        entityId: 'e1',
        componentType: 'moving_platform',
        properties: {
          waypoints: [
            [0, 0, 0],
            [0, 3, 0],
          ],
          loopMode: 'pingPong',
        },
      }),
    ).toBeNull();
  });

  it('accepts the payloads that carry nothing', () => {
    // Plenty of commands dispatch `undefined` or `{}`, and the engine is handed
    // `Value::Null` for them. Neither may be refused.
    expect(checkCommandPayload('play', undefined)).toBeNull();
    expect(checkCommandPayload('play', null)).toBeNull();
    expect(checkCommandPayload('play', {})).toBeNull();
  });

  it('accepts nesting exactly at the limit and rejects one level past it', () => {
    // A scalar is depth 1, so `MAX - 1` wrappers puts the innermost value at
    // exactly `MAX`. Pinning the boundary from both sides is what stops an
    // off-by-one from either refusing legal payloads or leaving a level open.
    expect(checkCommandPayload('cmd', nestedObject(MAX_COMMAND_PAYLOAD_DEPTH - 1))).toBeNull();
    expect(checkCommandPayload('cmd', nestedObject(MAX_COMMAND_PAYLOAD_DEPTH))).toContain(
      'nested too deeply',
    );
  });

  it('rejects the deep payload that would trap the engine', () => {
    // The condition this module exists for, at a depth the recursive walk
    // inside `serde_wasm_bindgen` does not survive.
    expect(checkCommandPayload('cmd', nestedObject(100_000))).toContain('nested too deeply');
  });

  it('rejects deep nesting reached through arrays', () => {
    expect(checkCommandPayload('cmd', nestedArray(1_000))).toContain('nested too deeply');
  });

  it('rejects deep nesting hidden inside a Map or a Set', () => {
    // `serde_wasm_bindgen` converts both, so structure nested through them
    // reaches the same recursive build — but neither exposes its contents as
    // own enumerable properties, so a walk over `Object.values` alone reports a
    // depth of 1 no matter how deep the input really is.
    const throughMap = new Map([['k', nestedObject(1_000)]]);
    expect(checkCommandPayload('cmd', throughMap)).toContain('nested too deeply');

    const throughSet = new Set([nestedObject(1_000)]);
    expect(checkCommandPayload('cmd', throughSet)).toContain('nested too deeply');
  });

  it('names the command in the reason', () => {
    // `reportCommandRejected` records this text and nothing else identifies the
    // payload, so a generic message would leave a rejection untraceable.
    expect(checkCommandPayload('update_physics', nestedObject(100))).toContain('update_physics');
  });

  it('accepts a full-size tilemap', () => {
    // The bound this pins is the one the first version of this guard got wrong.
    // `TilemapLayer.tiles` is a flat array of `width * height` scalars and
    // `TilemapInspector` permits 1000×1000, so one ordinary tilemap edit
    // carries a million values beneath two containers. Counting every value
    // against 50,000 refused every tilemap past roughly 223×223.
    const tiles = new Array(1_000_000).fill(0);
    expect(checkCommandPayload('set_tilemap_data', { entityId: 'e1', tiles })).toBeNull();
  });

  it('accepts a wide shallow payload under the container bound', () => {
    const waypoints = Array.from({ length: 1_000 }, (_, i) => ({ x: i }));
    expect(checkCommandPayload('cmd', { waypoints })).toBeNull();
  });

  it('accepts a payload exactly at the container limit', () => {
    // The wrapper object and its array are containers themselves, so the run
    // beneath them is two short of the bound.
    const items = Array.from({ length: MAX_COMMAND_PAYLOAD_CONTAINERS - 2 }, () => ({}));
    expect(checkCommandPayload('cmd', { items })).toBeNull();
  });

  it('rejects a payload one container past the limit', () => {
    // Shallow enough to clear the depth bound, so only counting catches it —
    // and exactly one over, so the boundary is pinned from both sides rather
    // than by a number that is merely large.
    const items = Array.from({ length: MAX_COMMAND_PAYLOAD_CONTAINERS - 1 }, () => ({}));
    const reason = checkCommandPayload('cmd', { items });
    expect(reason).toContain('too much structure');
    expect(reason).toContain('cmd');
  });

  it('terminates on a cyclic payload instead of spinning', () => {
    // No cycle can stay shallow: every lap around one re-enters a container, so
    // the depth bound is always reached — including through a branching cycle,
    // which a depth-first walk descends rather than widens. What matters is that
    // it terminates with a reason. Sent onward, a cycle hangs the recursive
    // conversion inside WASM with nothing to observe.
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(checkCommandPayload('cmd', cyclic)).toContain('nested too deeply');

    const cyclicArray: unknown[] = [];
    cyclicArray.push(cyclicArray);
    expect(checkCommandPayload('cmd', cyclicArray)).toContain('nested too deeply');

    const branchingCycle: Record<string, unknown> = {};
    branchingCycle.children = Array.from({ length: 64 }, () => branchingCycle);
    expect(checkCommandPayload('cmd', branchingCycle)).toContain('nested too deeply');
  });
});

describe('checkCommandBatch', () => {
  it('accepts a realistic batch', () => {
    expect(
      checkCommandBatch([
        { command: 'update_transform', payload: { entityId: 'e1', position: [0, 1, 0] } },
        { command: 'play' },
      ]),
    ).toBeNull();
  });

  it('does not refuse a payload merely for being batched', () => {
    // The envelope costs two levels — the array, then the item object — so
    // without the extra headroom a payload the single-command path accepts
    // would be rejected the moment it was batched.
    const payload = nestedObject(MAX_COMMAND_PAYLOAD_DEPTH - 1);
    expect(checkCommandPayload('cmd', payload)).toBeNull();
    expect(checkCommandBatch([{ command: 'cmd', payload }])).toBeNull();
  });

  it('still refuses a batched payload past the envelope headroom', () => {
    // Pins the +2 from above. It is headroom for the envelope's own two levels,
    // not a way to smuggle a deeper payload through by batching it.
    const payload = nestedObject(MAX_COMMAND_PAYLOAD_DEPTH);
    expect(checkCommandBatch([{ command: 'cmd', payload }])).toContain('nested too deeply');
  });

  it('rejects a batch whose item is nested too deeply', () => {
    expect(
      checkCommandBatch([{ command: 'cmd', payload: nestedObject(100_000) }]),
    ).toContain('nested too deeply');
  });

  it('accepts a batch at exactly the container limit', () => {
    // Pins the bound from the accepting side. Without it, tightening
    // MAX_BATCH_CONTAINERS by an order of magnitude leaves the rejection case
    // below green and nothing notices that legitimate batches started failing.
    const items = Array.from({ length: MAX_BATCH_CONTAINERS - 1 }, () => ({}));
    expect(checkCommandBatch(items)).toBeNull();
  });

  it('rejects a batch with too much structure', () => {
    const items = Array.from({ length: MAX_BATCH_CONTAINERS }, () => ({}));
    expect(checkCommandBatch(items)).toContain('too much structure');
  });
});

// ---------------------------------------------------------------------------
// Cross-language pin.
//
// These constants are a hand-mirrored copy of numbers that live in Rust, and
// the two copies have to agree: if the TypeScript bound is the looser one, a
// band of payloads passes this guard and is refused by the engine — with
// `dispatchCommand` returning nothing useful, that is a silent no-op. If it is
// the tighter one, the editor refuses payloads the engine would have accepted.
// Neither shows up as a failure anywhere else.
//
// Reading the Rust source is the only check available: a native `cargo test`
// cannot see the TypeScript constant, and this suite cannot call the Rust
// guard. Deliberately textual, and it fails closed — an unreadable file, a
// missing constant, or a value it cannot parse is a failure, never a skip.
// ---------------------------------------------------------------------------

describe('the bounds match engine/src/core/json_guard.rs', () => {
  const RUST = join(__dirname, '..', '..', '..', '..', '..', 'engine', 'src', 'core', 'json_guard.rs');

  /**
   * Every `const NAME: <type> = <value>;` declared at the top level of the Rust
   * module, whatever its visibility.
   *
   * Every part of this is captured loosely on purpose, because the completeness
   * check below is only worth anything if a declaration the pattern cannot read
   * *raises* rather than disappears. Three specific ways an earlier version
   * failed open:
   *
   * - `pub const` was required literally, so narrowing a bound to `pub(crate)`
   *   removed it from the check rather than failing it.
   * - the type was matched as `[\w:<>]+`, so a bound typed `[usize; 2]` — or
   *   anything else with a bracket or a space in it — was skipped entirely.
   * - only `usize` and a decimal literal would have been read, so a bound
   *   written in hex, or as `u32`, or computed, was silently invisible.
   *
   * So: match the declaration on `const NAME`, take the type as everything up
   * to the first `=` (Rust type syntax here contains none), and require the
   * value to be a plain integer literal. Anything else — including a value
   * whose own syntax contains a `;`, such as `[0; 4]` — is raised.
   *
   * Scope is stated rather than implied: this reads declarations at column 0,
   * which is where a module-level bound lives. A const nested inside a `fn`,
   * `impl` or `mod` is indented and is deliberately not a bound of this module.
   */
  function rustConstants(): Record<string, number> {
    let source: string;
    try {
      source = readFileSync(RUST, 'utf8');
    } catch (err) {
      throw new Error(`could not read ${RUST}: ${String(err)}`);
    }

    const found: Record<string, number> = {};
    const pattern = /^(?:pub(?:\s*\([^)]*\))?\s+)?const\s+(\w+)\s*:[^=]+=\s*([^;]+);/gm;
    for (const match of source.matchAll(pattern)) {
      const [, name, rawValue] = match;
      const literal = rawValue.trim();
      // `1_000` is idiomatic in Rust and not a number in JS, so the separators
      // have to come out before parsing rather than after.
      const cleaned = literal.replace(/_/g, '');
      const parsed = /^[0-9]+$/.test(cleaned) ? Number(cleaned) : Number.NaN;
      if (!Number.isFinite(parsed)) {
        throw new Error(`unparseable value for ${name} in ${RUST}: ${literal}`);
      }
      found[name] = parsed;
    }
    if (Object.keys(found).length === 0) {
      throw new Error(`no pub consts found in ${RUST} — the pattern or the file moved`);
    }
    return found;
  }

  const EXPECTED: Record<string, number> = {
    MAX_COMMAND_PAYLOAD_DEPTH,
    MAX_COMMAND_PAYLOAD_CONTAINERS,
    MAX_BATCH_CONTAINERS,
  };

  /**
   * Rust-only bounds, excluded by name rather than by omission.
   *
   * Both bound something that never travels through this module: a JSON *text*
   * parsed inside the engine, and an identifier length checked there. Naming
   * them is what lets the completeness check below stay strict.
   */
  const RUST_ONLY = ['MAX_JSON_TEXT_BYTES', 'MAX_IDENTIFIER_BYTES'];

  it.each(Object.keys(EXPECTED))('%s agrees with the Rust constant', (name) => {
    const rust = rustConstants();
    expect(rust, `no ${name} in ${RUST}`).toHaveProperty(name);
    expect(rust[name]).toBe(EXPECTED[name]);
  });

  it('pins every numeric bound the Rust module declares', () => {
    // Completeness, so a bound added on the Rust side cannot sit unmirrored:
    // the guard's whole value is that both halves enforce the same numbers.
    const rustNames = Object.keys(rustConstants()).filter((n) => !RUST_ONLY.includes(n));
    expect(rustNames.sort()).toEqual(Object.keys(EXPECTED).sort());
  });
});
