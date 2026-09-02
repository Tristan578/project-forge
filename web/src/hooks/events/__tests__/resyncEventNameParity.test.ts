// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

import { useEditorStore } from '@/stores/editorStore';
import { handlePhysicsEvent } from '../physicsEvents';
import { handleAnimationEvent } from '../animationEvents';
import { createMockSetGet, createMockActions, type StoreState } from './eventTestUtils';

/**
 * Cross-language pin for the removal events the undo/redo re-report drain emits
 * (#9290, #9291).
 *
 * These five names exist because a flattened payload cannot say "gone":
 * `JOINT_CHANGED` IS the joint, `PHYSICS2D_CHANGED` IS the body,
 * `ANIMATION_CLIP_CHANGED` IS the clip. Nothing else can see both sides of the
 * name at once — `cargo test` cannot read `physicsEvents.ts`, and the TS suite
 * cannot call the bridge, which is wasm32-only. Rename either half and the
 * removal goes silently unhandled, which looks exactly like an entity that
 * simply has no joint.
 *
 * Deliberately textual, and it fails closed: an unreadable file, a missing
 * function, or a body it cannot parse is a failure, never a skip.
 */
describe('component re-report event names match the engine', () => {
  const ENGINE = join(__dirname, '..', '..', '..', '..', '..', 'engine', 'src');

  function read(relative: string): string {
    const path = join(ENGINE, relative);
    const source = readFileSync(path, 'utf8');
    expect(source.length, `${path} is empty`).toBeGreaterThan(0);
    return source;
  }

  /** The event literal `fnName` emits, read out of `bridge/events.rs`. */
  function emittedName(source: string, fnName: string): string {
    const start = source.indexOf(`pub fn ${fnName}(`);
    expect(start, `${fnName} is missing from bridge/events.rs`).toBeGreaterThan(-1);
    const body = source.slice(start);
    const emit = /emit_event\("([A-Z0-9_]+)"/.exec(body);
    expect(emit, `${fnName} does not emit`).not.toBeNull();
    return emit![1];
  }

  const EMITTERS = [
    'emit_joint_removed',
    'emit_physics2d_removed',
    'emit_joint2d_removed',
    'emit_animation_clip_changed',
    'emit_animation_clip_removed',
  ] as const;

  const EXPECTED_NAMES: Record<(typeof EMITTERS)[number], string> = {
    emit_joint_removed: 'JOINT_REMOVED',
    emit_physics2d_removed: 'PHYSICS2D_REMOVED',
    emit_joint2d_removed: 'JOINT2D_REMOVED',
    emit_animation_clip_changed: 'ANIMATION_CLIP_CHANGED',
    emit_animation_clip_removed: 'ANIMATION_CLIP_REMOVED',
  };

  it.each(EMITTERS)('%s emits the name the browser listens for', (fnName) => {
    const events = read(join('bridge', 'events.rs'));
    expect(emittedName(events, fnName)).toBe(EXPECTED_NAMES[fnName]);
  });

  /**
   * An emitter nothing calls is the outbound half of the dead-vocabulary class:
   * it type-checks, it is covered by the name test above, and it never fires.
   * The drain is the only caller of all five.
   */
  it.each(EMITTERS)('%s is actually called by the resync drain', (fnName) => {
    const drain = read(join('bridge', 'component_resync.rs'));
    expect(drain).toContain(`events::${fnName}(`);
  });

  describe('every emitted removal name reaches a state-only store action', () => {
    let actions: ReturnType<typeof createMockActions>;

    beforeEach(() => {
      vi.clearAllMocks();
      actions = createMockActions();
      actions.primaryId = 'e1';
      vi.mocked(useEditorStore.getState).mockReturnValue(actions as unknown as StoreState);
    });

    it('PHYSICS2D_REMOVED clears the entity without dispatching', () => {
      const events = read(join('bridge', 'events.rs'));
      const mock = createMockSetGet();

      expect(
        handlePhysicsEvent(
          emittedName(events, 'emit_physics2d_removed'),
          { entityId: 'e1' },
          mock.set,
          mock.get,
        ),
      ).toBe(true);
      expect(actions.applyPhysics2dRemovalFromEngine).toHaveBeenCalledWith('e1');
      expect(actions.removePhysics2d).not.toHaveBeenCalled();
    });

    it('JOINT2D_REMOVED clears the entity without dispatching', () => {
      const events = read(join('bridge', 'events.rs'));
      const mock = createMockSetGet();

      expect(
        handlePhysicsEvent(
          emittedName(events, 'emit_joint2d_removed'),
          { entityId: 'e1' },
          mock.set,
          mock.get,
        ),
      ).toBe(true);
      expect(actions.applyJoint2dRemovalFromEngine).toHaveBeenCalledWith('e1');
      expect(actions.removeJoint2d).not.toHaveBeenCalled();
    });

    it('JOINT_REMOVED clears the inspector joint', () => {
      const events = read(join('bridge', 'events.rs'));
      const mock = createMockSetGet();

      expect(
        handlePhysicsEvent(
          emittedName(events, 'emit_joint_removed'),
          { entityId: 'e1' },
          mock.set,
          mock.get,
        ),
      ).toBe(true);
      expect(actions.setPrimaryJoint).toHaveBeenCalledWith(null);
      expect(actions.removeJoint).not.toHaveBeenCalled();
    });

    it('ANIMATION_CLIP_REMOVED clears the inspector clip', () => {
      const events = read(join('bridge', 'events.rs'));
      const mock = createMockSetGet();

      expect(
        handleAnimationEvent(
          emittedName(events, 'emit_animation_clip_removed'),
          { entityId: 'e1' },
          mock.set,
          mock.get,
        ),
      ).toBe(true);
      expect(useEditorStore.setState).toHaveBeenCalledWith({ primaryAnimationClip: null });
    });

    /**
     * `ANIMATION_CLIP_CHANGED` had a handler and no emitter for its whole life —
     * indistinguishable from an entity with no clip. This asserts the handler
     * answers on the name the engine now actually sends.
     */
    it('ANIMATION_CLIP_CHANGED writes the clip for the primary entity', () => {
      const events = read(join('bridge', 'events.rs'));
      const mock = createMockSetGet();

      expect(
        handleAnimationEvent(
          emittedName(events, 'emit_animation_clip_changed'),
          { entityId: 'e1', duration: 2, speed: 1 },
          mock.set,
          mock.get,
        ),
      ).toBe(true);
      expect(useEditorStore.setState).toHaveBeenCalledWith({
        primaryAnimationClip: { duration: 2, speed: 1 },
      });
    });
  });
});
