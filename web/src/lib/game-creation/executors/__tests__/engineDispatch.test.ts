/**
 * The shared engine dispatch helpers (PF-1213).
 *
 * All three were private copies inside individual executors until this branch
 * pulled them out, and they arrived with no test of their own — exercised only
 * incidentally through executor suites, which drive them in one configuration
 * each and never near a boundary.
 *
 * Each helper carries an engine invariant that fails silently when it is wrong:
 * an id the engine refuses is swapped for a random UUID rather than reported, a
 * missing frame wait loses a physics patch with nothing JS-side to see it, and
 * `sendCommands` is the only place a rejection can be observed at all.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ExecutorContext } from '../../types';
import { engineEntityId, waitForEngineFrame, sendCommands } from '../engineDispatch';

/** Two bytes in UTF-8, one character in JS — the whole point of the byte check. */
const ACCENT = String.fromCharCode(0xe9);

function makeCtx(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    dispatchCommand: vi.fn(),
    signal: new AbortController().signal,
    ...overrides,
  } as unknown as ExecutorContext;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('engineEntityId', () => {
  it('accepts an id at the engine exact 64-byte ceiling', () => {
    // `is_valid_override_id` (core/entity_factory.rs) allows 64. A schema that
    // stopped one short would push every id at the limit onto the random-UUID
    // path, which is the failure this validator exists to prevent — and the
    // suite only ever probed 65, so an off-by-one in the safe-looking direction
    // would have shipped.
    expect(engineEntityId.safeParse('a'.repeat(64)).success).toBe(true);
    expect(engineEntityId.safeParse(crypto.randomUUID()).success).toBe(true);
  });

  it('refuses an id one byte over', () => {
    expect(engineEntityId.safeParse('a'.repeat(65)).success).toBe(false);
  });

  it('counts BYTES, not characters', () => {
    // The limit is on the UTF-8 encoding, so 33 two-byte characters is 66 bytes
    // and over the line despite being well under 64 characters. A `.length`
    // check here would call it valid and let the engine mint a different id.
    expect(engineEntityId.safeParse(ACCENT.repeat(32)).success).toBe(true);
    expect(engineEntityId.safeParse(ACCENT.repeat(33)).success).toBe(false);
  });

  it('refuses an id that is empty or only whitespace', () => {
    // Deliberately STRICTER than the engine, which would accept `'   '` (a
    // space is not a control character, and Rust does not trim). Refusing it
    // here is a loud INVALID_INPUT rather than a silent divergence, and a
    // whitespace id is a planning bug either way. The control-character
    // members of this list are refused by the engine too.
    for (const raw of ['', '   ', '\t', '\n', ' \t\n ']) {
      expect(
        engineEntityId.safeParse(raw).success,
        JSON.stringify(raw) + ' was accepted',
      ).toBe(false);
    }
  });

  it('refuses control characters anywhere in the id, including at the edges', () => {
    // NUL, tab, vertical tab, unit separator, DEL. Built from codes rather than
    // typed as literals so the fixtures survive a copy through a terminal.
    //
    // THE EDGE POSITIONS ARE THE POINT. This validator used to scan a trimmed
    // copy, so a leading tab was stripped before the scan and `'\tentity'`
    // passed — while Rust's `is_control` sees the tab in the raw string and
    // refuses the id, minting a random UUID that no later command in the plan
    // knows about. That is the exact divergence the whole helper exists to
    // close, in the one direction that fails silently.
    for (const code of [0x00, 0x09, 0x0b, 0x1f, 0x7f]) {
      const inner = 'ent' + String.fromCharCode(code) + 'ity';
      const leading = String.fromCharCode(code) + 'entity';
      const trailing = 'entity' + String.fromCharCode(code);
      for (const raw of [inner, leading, trailing]) {
        expect(
          engineEntityId.safeParse(raw).success,
          'code ' + code + ' accepted in ' + JSON.stringify(raw),
        ).toBe(false);
      }
    }
  });
});

describe('waitForEngineFrame', () => {
  it('waits two animation frames when the browser drives the loop', async () => {
    // Two, not one: the engine runs its own loop, so a single tick can land
    // inside the very engine frame that queued the command being waited on.
    const callbacks: FrameRequestCallback[] = [];
    const raf = vi.fn((cb: FrameRequestCallback) => {
      callbacks.push(cb);
      return callbacks.length;
    });
    vi.stubGlobal('requestAnimationFrame', raf);

    let settled = false;
    const pending = waitForEngineFrame().then(() => { settled = true; });

    expect(raf).toHaveBeenCalledTimes(1);
    callbacks[0](0);
    await Promise.resolve();
    expect(settled, 'resolved after a single frame').toBe(false);
    expect(raf).toHaveBeenCalledTimes(2);

    callbacks[1](0);
    await pending;
    expect(settled).toBe(true);
  });

  it('falls back to a macrotask hop where there is no rAF', async () => {
    // Node — unit tests, and any server-side caller. Nothing is racing there,
    // so a macrotask is the honest equivalent; what matters is that the promise
    // still resolves rather than hanging the executor forever.
    //
    // Real timers, not fake ones: `vi.useFakeTimers()` installs its OWN
    // `requestAnimationFrame`, so faking time after stubbing rAF away puts the
    // function back on the rAF branch and this test would hang for its full
    // timeout while appearing to exercise the fallback.
    vi.stubGlobal('requestAnimationFrame', undefined);
    const timeout = vi.spyOn(globalThis, 'setTimeout');

    let settled = false;
    const pending = waitForEngineFrame().then(() => { settled = true; });

    // A microtask flush must not be enough — the hop has to be a real
    // macrotask, or it lands in the same frame it is meant to escape.
    await Promise.resolve();
    expect(settled, 'resolved within a microtask').toBe(false);

    await pending;
    expect(settled).toBe(true);
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout.mock.calls[0][1]).toBe(0);
  });
});

describe('sendCommands', () => {
  it('dispatches nothing at all for an empty list', () => {
    // An executor with nothing to send must not be reported as an engine
    // rejection, and must not send an empty batch the engine has to answer for.
    const batch = vi.fn();
    const single = vi.fn();
    const ctx = makeCtx({ dispatchCommandBatch: batch, dispatchCommand: single });

    expect(sendCommands(ctx, [])).toBe(true);
    expect(batch).not.toHaveBeenCalled();
    expect(single).not.toHaveBeenCalled();
  });

  it('passes the batch dispatcher verdict straight through', () => {
    const commands = [
      { command: 'toggle_physics', payload: { entityId: 'a', enabled: true } },
      { command: 'update_physics', payload: { entityId: 'a', bodyType: 'fixed' } },
    ];

    const accepted = vi.fn().mockReturnValue({ success: true });
    expect(sendCommands(makeCtx({ dispatchCommandBatch: accepted }), commands)).toBe(true);
    // One call carrying both commands — batching is what makes the pair land in
    // the same engine frame.
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(accepted).toHaveBeenCalledWith(commands);

    const refused = vi.fn().mockReturnValue({ success: false });
    expect(sendCommands(makeCtx({ dispatchCommandBatch: refused }), commands)).toBe(false);
  });

  it('reports success on the single-dispatch path because nothing there can report failure', () => {
    // `dispatchCommand` returns void. `true` is not optimism, it is the only
    // answer available — and it is why every executor that needs to KNOW an
    // outcome is given a batch dispatcher. Each command still goes out
    // individually, in order.
    const single = vi.fn();
    const ctx = makeCtx({ dispatchCommand: single, dispatchCommandBatch: undefined });

    const result = sendCommands(ctx, [
      { command: 'spawn_entity', payload: { id: 'a' } },
      { command: 'update_transform', payload: { entityId: 'a', scale: [1, 1, 1] } },
    ]);

    expect(result).toBe(true);
    expect(single).toHaveBeenCalledTimes(2);
    expect(single).toHaveBeenNthCalledWith(1, 'spawn_entity', { id: 'a' });
    expect(single).toHaveBeenNthCalledWith(
      2,
      'update_transform',
      { entityId: 'a', scale: [1, 1, 1] },
    );
  });
});
