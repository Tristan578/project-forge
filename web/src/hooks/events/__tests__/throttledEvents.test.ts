/**
 * Pins every name in `THROTTLED_EVENTS` against the engine's actual emit sites.
 *
 * A name in that set is not routed by a switch, so nothing reports it when the
 * engine has never emitted it: the entry is silently inert and it fails in BOTH
 * directions — the shared 10fps throttle budget is spent on a phantom while the
 * real high-frequency event goes unthrottled and drives 60fps React re-renders.
 * `PHYSICS2D_UPDATED` sat in the set doing exactly that until PF-1167; the emitted
 * name is `PHYSICS2D_CHANGED`.
 *
 * The engine source is therefore read textually — `cargo test` cannot see a TS
 * constant and vitest cannot call Rust, so there is no compiler holding the two
 * sides together. Every parse failure is a test failure, never a skip: a suite that
 * quietly stops checking when its input moves is worse than no suite, because it
 * still reports green.
 *
 * The scan itself is `@/test/utils/engineEmittedEvents`, shared with
 * `gameEvents.test.ts`; its scope and limits are documented there.
 */

import { describe, it, expect } from 'vitest';

import { THROTTLED_EVENTS } from '../throttledEvents';
import { emittedEventNames } from '@/test/utils/engineEmittedEvents';

describe('THROTTLED_EVENTS', () => {
  const emitted = emittedEventNames();

  it('is non-empty, so the assertions below are not vacuous', () => {
    expect(THROTTLED_EVENTS.size).toBeGreaterThan(0);
  });

  it.each([...THROTTLED_EVENTS])('%s is an event the engine actually emits', (name) => {
    expect(emitted.has(name)).toBe(true);
  });

  it('does not carry the PF-1167 phantom name', () => {
    // Named explicitly rather than left to the generic check above: the generic
    // check would also catch it, but this states the regression so a future reader
    // knows the entry was wrong once and why.
    expect(THROTTLED_EVENTS.has('PHYSICS2D_UPDATED')).toBe(false);
    expect(THROTTLED_EVENTS.has('PHYSICS2D_CHANGED')).toBe(true);
  });

  it('does not throttle CHARACTER_GROUNDED_CHANGED', () => {
    // THROTTLED_EVENTS DROPS, it does not delay: a name in the set has every
    // occurrence past the 10fps budget discarded. That is right for a per-frame
    // flood like TRANSFORM_CHANGED, where the next frame carries the same truth,
    // and wrong for a CHANGES-ONLY event — the engine emits ground contact only
    // when it flips, so a dropped landing is not resent and
    // forge.physics.isGrounded answers false until the character next leaves the
    // ground and comes back. An ungated jump then reads as a broken jump
    // (PF-1214, review finding #17).
    expect(emitted.has('CHARACTER_GROUNDED_CHANGED')).toBe(true);
    expect(THROTTLED_EVENTS.has('CHARACTER_GROUNDED_CHANGED')).toBe(false);
  });

  it('finds the emit sites this scan depends on, in the files they live in', () => {
    // Guards the scan itself. `TRANSFORM_CHANGED` is emitted from neither
    // `bridge/events.rs` nor a `physics`/`animation` module, so a scan narrowed to
    // one file would silently stop proving anything about most of the set.
    expect(emitted.has('TRANSFORM_CHANGED')).toBe(true);
    expect(emitted.has('PHYSICS_CHANGED')).toBe(true);
    expect(emitted.has('ANIMATION_STATE_CHANGED')).toBe(true);
  });
});
