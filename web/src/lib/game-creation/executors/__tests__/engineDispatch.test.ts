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
    // 0x80/0x85/0x9f are the C1 range. Rust's `char::is_control` is Unicode
    // Cc, which is C0 *and* C1 — a validator narrowed back to the ASCII half
    // would accept U+0085 here and be silently overruled by the engine. The
    // upper bound is probed from the other side below.
    for (const code of [0x00, 0x09, 0x0b, 0x1f, 0x7f, 0x80, 0x85, 0x9f]) {
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

  it('accepts the first code point above the C1 range', () => {
    // U+00A0 is the byte after the C1 block and is NOT a control character to
    // Rust. Without this, widening the refused range (0x9f -> 0xbf, say) would
    // pass every test above while refusing ids the engine accepts — the
    // opposite failure, and one that turns a valid plan into INVALID_INPUT.
    expect(engineEntityId.safeParse('ent' + String.fromCharCode(0xa0) + 'ity').success).toBe(true);
    expect(engineEntityId.safeParse('ent' + ACCENT + 'ity').success).toBe(true);
  });

  it('counts the RAW string, not a trimmed copy', () => {
    // The contract the docstring names, with nothing pinning it until now: a
    // trim-then-count regression passes every other case in this file.
    //
    // 64 characters plus a trailing space is 65 bytes to the engine and 64 to a
    // trimmed count, so the refusal below is the only thing separating the two
    // implementations at the ceiling.
    expect(engineEntityId.safeParse('a'.repeat(64) + ' ').success).toBe(false);
    expect(engineEntityId.safeParse(' ' + 'a'.repeat(64)).success).toBe(false);
    // ...and a short id padded with spaces stays acceptable: the raw check is
    // about the BYTE COUNT and the control scan, not about rejecting spaces.
    expect(engineEntityId.safeParse(' entity ').success).toBe(true);
  });

  it('states the non-blank requirement in its own message', () => {
    // A whitespace-only id is refused by `raw.trim().length > 0`, a rule the
    // message did not mention — so the user was told the id must be "1-64 bytes
    // with no control characters", which `'   '` satisfies by its own wording.
    const result = engineEntityId.safeParse('   ');
    expect(result.success).toBe(false);
    const message = result.success ? '' : result.error.issues[0].message;
    expect(message).toBe(
      'entityId must be 1-64 bytes as the engine counts them, with no control '
      + 'characters and at least one non-whitespace character',
    );
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

  it('sends each command in order on the single-dispatch path', () => {
    // No batch dispatcher is not a rare configuration: `orchestratorSlice` fills
    // the field from `getCommandBatchDispatcher() ?? undefined`, so a WASM build
    // without `handle_command_batch` runs the entire pipeline down this branch.
    const single = vi.fn().mockReturnValue({ success: true });
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

  // -------------------------------------------------------------------------
  // Single-path rejection reporting (PF-1231)
  // -------------------------------------------------------------------------
  //
  // This path used to return `true` unconditionally, on the premise that
  // `dispatchCommand` returned void. It never did — `useEngineEvents` has always
  // answered with a `CommandResponse`; it was `ExecutorContext` that typed the
  // answer away. Every executor running without a batch dispatcher therefore
  // reported success for commands the engine had refused.

  it('reports failure when the single dispatcher refuses a command', () => {
    const single = vi.fn().mockReturnValue({ success: false, error: 'unknown command' });
    const ctx = makeCtx({ dispatchCommand: single, dispatchCommandBatch: undefined });

    expect(sendCommands(ctx, [{ command: 'nope', payload: {} }])).toBe(false);
  });

  it('sends the WHOLE list even after a refusal, and still reports failure', () => {
    // No early exit, deliberately. These commands are one step's worth of work,
    // the batch path runs the whole envelope too, and a caller that saw half a
    // step applied on one path and a different half on the other would have to
    // know which dispatcher it was handed.
    const single = vi.fn((command: string) =>
      (command === 'b' ? { success: false, error: 'refused' } : { success: true }));
    const ctx = makeCtx({ dispatchCommand: single, dispatchCommandBatch: undefined });

    const result = sendCommands(ctx, [
      { command: 'a', payload: {} },
      { command: 'b', payload: {} },
      { command: 'c', payload: {} },
    ]);

    expect(result).toBe(false);
    expect(single).toHaveBeenCalledTimes(3);
    // A refusal in the middle must not be laundered by the commands after it
    // answering `success` — the verdict latches.
    expect(single).toHaveBeenNthCalledWith(3, 'c', {});
  });

  it('treats a dispatcher that answers nothing as acceptance', () => {
    // The store-level `CommandDispatcher` is typed `CommandResponse | void`, and
    // test doubles overwhelmingly return nothing. Reading `undefined` as a
    // rejection would fail every one of them for a defect that is not there.
    const ctx = makeCtx({
      dispatchCommand: vi.fn(() => undefined),
      dispatchCommandBatch: undefined,
    });

    expect(sendCommands(ctx, [{ command: 'spawn_entity', payload: {} }])).toBe(true);
  });

  it('does not read a truthy non-response as a rejection', () => {
    // `success` absent is not `success: false`. Only an explicit `false` refuses.
    const ctx = makeCtx({
      dispatchCommand: vi.fn(() => ({}) as never),
      dispatchCommandBatch: undefined,
    });

    expect(sendCommands(ctx, [{ command: 'spawn_entity', payload: {} }])).toBe(true);
  });
});
