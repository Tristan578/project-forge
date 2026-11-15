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
import type { ExecutorContext, ObservedEntity } from '../../types';
import {
  engineEntityId,
  waitForEngineFrame,
  sendCommands,
  observeEngineEffect,
  observeTransformEffect,
  observedVec3Matches,
  OBSERVED_VEC3_TOLERANCE,
  rejectedEffect,
  SPAWN_TRANSFORM_OPERATION,
} from '../engineDispatch';

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

// ---------------------------------------------------------------------------
// observeEngineEffect (#9899, operation family ai.FR-1.OP-01)
// ---------------------------------------------------------------------------
//
// The heart of the slice: an accepted dispatch is NOT an applied effect. This
// adapter queries the real engine after the deferred command runs and reports
// applied / timed-out / cancelled, correlated by operationId + entityId. The
// clock and sleep are injected so the 5-second deadline is exercised in
// microseconds and deterministically — a real `setTimeout` loop would make the
// timed-out case a five-second test.

/**
 * A deterministic clock whose `sleep` advances time by exactly the slept
 * interval. `now()` reads it, so the deadline is reached in a bounded, exact
 * number of polls with no wall-clock wait and no ordering nondeterminism.
 */
function fakeClock(startAborted = false) {
  let t = 0;
  const controller = new AbortController();
  if (startAborted) controller.abort();
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

const CRATE: ObservedEntity = {
  entityId: 'crate-1',
  transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
};

describe('rejectedEffect', () => {
  it('builds a correlated rejected result', () => {
    expect(rejectedEffect('ai.FR-1.OP-01', 'crate-1')).toEqual({
      status: 'rejected',
      operationId: 'ai.FR-1.OP-01',
      entityId: 'crate-1',
    });
  });
});

describe('observeEngineEffect', () => {
  it('reports applied once the engine query shows the entity, echoing the operation id', async () => {
    const clock = fakeClock();
    const observe = vi.fn().mockReturnValue(CRATE);

    const result = await observeEngineEffect({
      operationId: 'ai.FR-1.OP-01',
      entityId: 'crate-1',
      observe,
      signal: clock.signal,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result).toEqual({
      status: 'applied',
      operationId: 'ai.FR-1.OP-01',
      entityId: 'crate-1',
      observed: CRATE,
    });
  });

  it('defaults the operation id to the ai.FR-1.OP-01 family', async () => {
    const clock = fakeClock();
    const result = await observeEngineEffect({
      entityId: 'crate-1',
      observe: () => CRATE,
      signal: clock.signal,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(result.operationId).toBe(SPAWN_TRANSFORM_OPERATION);
    expect(SPAWN_TRANSFORM_OPERATION).toBe('ai.FR-1.OP-01');
  });

  it('keeps polling until the effect appears, then reports applied', async () => {
    const clock = fakeClock();
    // Undefined (not observable yet) for the first two polls, then the entity.
    const observe = vi.fn<(id: string) => ObservedEntity | undefined>()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValue(CRATE);

    const result = await observeEngineEffect({
      entityId: 'crate-1',
      observe,
      signal: clock.signal,
      now: clock.now,
      sleep: clock.sleep,
      pollIntervalMs: 10,
      deadlineMs: 5000,
    });

    expect(result.status).toBe('applied');
    // Two misses that had to sleep, then the hit on the third read.
    expect(observe).toHaveBeenCalledTimes(3);
  });

  it('applies a position predicate: an entity at the wrong place is not confirmed until it moves', async () => {
    // The transform half of the contract — "set its position to (1,2,3)" is not
    // applied while the engine still reports the spawn-time origin.
    const clock = fakeClock();
    const atOrigin: ObservedEntity = {
      entityId: 'crate-1',
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    };
    const observe = vi.fn<(id: string) => ObservedEntity | undefined>()
      .mockReturnValueOnce(atOrigin)
      .mockReturnValue(CRATE);

    const result = await observeEngineEffect({
      entityId: 'crate-1',
      observe,
      satisfied: (o) => {
        const p = o.transform?.position;
        return !!p && p[0] === 1 && p[1] === 2 && p[2] === 3;
      },
      signal: clock.signal,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.status).toBe('applied');
    expect(result.observed).toEqual(CRATE);
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it('reports timed-out at the deadline with the operation id and never applied', async () => {
    // The negative case: a command accepted but its deferred effect deliberately
    // never applied. The engine query returns nothing for the whole window.
    const clock = fakeClock();
    const observe = vi.fn().mockReturnValue(undefined);

    const result = await observeEngineEffect({
      operationId: 'ai.FR-1.OP-01',
      entityId: 'crate-1',
      observe,
      signal: clock.signal,
      now: clock.now,
      sleep: clock.sleep,
      deadlineMs: 100,
      pollIntervalMs: 30,
    });

    expect(result).toEqual({
      status: 'timed-out',
      operationId: 'ai.FR-1.OP-01',
      entityId: 'crate-1',
    });
    expect(result.observed).toBeUndefined();
  });

  it('reports cancelled when the signal is already aborted, never observing', async () => {
    const clock = fakeClock(true); // aborted before the first poll
    const observe = vi.fn().mockReturnValue(CRATE);

    const result = await observeEngineEffect({
      operationId: 'ai.FR-1.OP-01',
      entityId: 'crate-1',
      observe,
      signal: clock.signal,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result).toEqual({
      status: 'cancelled',
      operationId: 'ai.FR-1.OP-01',
      entityId: 'crate-1',
    });
    // The abort check is FIRST — a cancelled observation must not read the
    // engine and cannot be laundered into an applied result.
    expect(observe).not.toHaveBeenCalled();
  });

  it('a cancellation mid-observation yields cancelled, not applied', async () => {
    // Aborts DURING the sleep between polls, while the entity is still not
    // observable. The next loop iteration must see the abort and stop.
    const clock = fakeClock();
    const observe = vi.fn().mockReturnValue(undefined);

    const result = await observeEngineEffect({
      operationId: 'ai.FR-1.OP-01',
      entityId: 'crate-1',
      observe,
      signal: clock.signal,
      now: clock.now,
      sleep: (ms: number) => {
        clock.abort();
        return clock.sleep(ms);
      },
      deadlineMs: 5000,
    });

    expect(result.status).toBe('cancelled');
    expect(result.observed).toBeUndefined();
  });

  it('a replayed operation id reads state idempotently — no double application', async () => {
    // The "boundary and recovery" scenario: the same operation id is retried
    // after the spawn already applied. Observation is a pure READ, so a second
    // call returns the same applied result and never mutates engine state.
    const clock1 = fakeClock();
    const clock2 = fakeClock();
    const observe = vi.fn().mockReturnValue(CRATE);

    const first = await observeEngineEffect({
      operationId: 'ai.FR-1.OP-01',
      entityId: 'crate-1',
      observe,
      signal: clock1.signal,
      now: clock1.now,
      sleep: clock1.sleep,
    });
    const second = await observeEngineEffect({
      operationId: 'ai.FR-1.OP-01',
      entityId: 'crate-1',
      observe,
      signal: clock2.signal,
      now: clock2.now,
      sleep: clock2.sleep,
    });

    expect(first).toEqual(second);
    expect(first.status).toBe('applied');
    // observe is the only engine interaction and it is a query — replaying the
    // operation cannot produce a second crate.
    expect(observe).toHaveBeenCalledTimes(2);
  });
});

describe('observedVec3Matches', () => {
  it('matches an exactly-equal vector', () => {
    expect(observedVec3Matches([40, 1, 40], [40, 1, 40])).toBe(true);
  });

  it('tolerates an f32 round-trip within the relative tolerance', () => {
    // 1000 * 1e-3 = 1.0 of relative slop; a value 0.5 off on the largest axis
    // is a correctly-applied scale that came back rounded, not a wrong one.
    expect(observedVec3Matches([1000.4, 1, 6], [1000, 1, 6])).toBe(true);
  });

  it('rejects a vector off by more than the tolerance on any axis', () => {
    // Still the spawn-time origin on the axis that was supposed to change — the
    // transform has NOT applied, so this is not a match and the caller polls on.
    expect(observedVec3Matches([40, 1, 1], [40, 1, 40])).toBe(false);
  });

  it('treats a missing or malformed vector as not-yet-applied', () => {
    expect(observedVec3Matches(undefined, [1, 1, 1])).toBe(false);
    expect(observedVec3Matches([1, 1], [1, 1, 1])).toBe(false);
    expect(observedVec3Matches([Number.NaN, 1, 1], [1, 1, 1])).toBe(false);
  });

  it('applies an absolute floor for a near-zero expected axis', () => {
    // Relative slop around 0 is 0; the absolute floor is what lets a
    // correctly-applied zero-ish axis confirm.
    expect(observedVec3Matches([OBSERVED_VEC3_TOLERANCE / 2, 1, 1], [0, 1, 1])).toBe(true);
    expect(observedVec3Matches([OBSERVED_VEC3_TOLERANCE * 2, 1, 1], [0, 1, 1])).toBe(false);
  });
});

describe('observeTransformEffect', () => {
  const AT_ORIGIN: ObservedEntity = {
    entityId: 'ground-1',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  };
  const SIZED: ObservedEntity = {
    entityId: 'ground-1',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [40, 1, 40] },
  };

  it('confirms a scale only once the engine reports the requested value, not on acceptance', async () => {
    // The unsized cube is observable immediately (the spawn applied) but its
    // scale is still 1x1x1 — an accepted `update_transform` is not an applied
    // one. `applied` must wait for the real scale to land.
    const clock = fakeClock();
    const observe = vi.fn<(id: string) => ObservedEntity | undefined>()
      .mockReturnValueOnce(AT_ORIGIN)
      .mockReturnValue(SIZED);

    const result = await observeTransformEffect({
      entityId: 'ground-1',
      field: 'scale',
      expected: [40, 1, 40],
      observe,
      signal: clock.signal,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.status).toBe('applied');
    expect(result.observed).toEqual(SIZED);
    expect(result.operationId).toBe(SPAWN_TRANSFORM_OPERATION);
    // The origin observation did not satisfy it — the executor kept polling.
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it('times out when the scale never reaches its requested value', async () => {
    const clock = fakeClock();
    // The engine keeps reporting the unsized cube — the resize was dropped.
    const observe = vi.fn().mockReturnValue(AT_ORIGIN);

    const result = await observeTransformEffect({
      entityId: 'ground-1',
      field: 'scale',
      expected: [40, 1, 40],
      observe,
      signal: clock.signal,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.status).toBe('timed-out');
    expect(result.observed).toBeUndefined();
  });

  it('confirms a position field the same way scale is confirmed', async () => {
    const clock = fakeClock();
    const moved: ObservedEntity = {
      entityId: 'crate-1',
      transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
    };
    const observe = vi.fn<(id: string) => ObservedEntity | undefined>()
      .mockReturnValueOnce({
        entityId: 'crate-1',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      })
      .mockReturnValue(moved);

    const result = await observeTransformEffect({
      entityId: 'crate-1',
      field: 'position',
      expected: [1, 2, 3],
      observe,
      signal: clock.signal,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.status).toBe('applied');
    expect(result.observed).toEqual(moved);
  });
});
