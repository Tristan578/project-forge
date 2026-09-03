// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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
 * Cross-language pin for the events the undo/redo re-report drain emits
 * (#9290, #9291).
 *
 * Two halves. The first walks EVERY arm of `apply_component_resyncs` and pins
 * the exact set of event names that arm produces — scoped to the arm, so
 * routing `Physics2d`'s removal to `emit_joint2d_removed` fails here instead of
 * shipping. A whole-file `toContain` cannot see that: every emitter is present
 * somewhere in the file no matter which arm calls it.
 *
 * The second is the older removal-name check. Those names exist because a
 * flattened payload cannot say "gone":
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

  /** Every `emit_*` and inline `emit_event` name inside `arm`, deduped. */
  function namesEmittedBy(events: string, arm: string): string[] {
    const names = new Set<string>();
    for (const [, fn] of arm.matchAll(/events::(emit_[a-z0-9_]+)\(/g)) {
      // `emit_event` is the raw sink, not a named wrapper; the literal it is
      // called with is picked up below.
      if (fn === 'emit_event') continue;
      names.add(emittedName(events, fn));
    }
    // The Transform arm builds its payload inline rather than going through an
    // `emit_*` wrapper, so it names the event itself.
    for (const [, literal] of arm.matchAll(/emit_event\(\s*"([A-Z0-9_]+)"/g)) {
      names.add(literal);
    }
    return [...names].sort();
  }

  /**
   * `apply_component_resyncs`'s match arms, keyed by `ComponentResync` variant.
   *
   * Arms sit at twelve-space indent inside the `for … { match resync {`, which
   * is what makes the split unambiguous — the same shape
   * `component_resync_tests.rs` uses on the Rust side.
   */
  function drainArms(drain: string): Map<string, string> {
    const start = drain.indexOf('pub(super) fn apply_component_resyncs(');
    expect(start, 'apply_component_resyncs is missing from bridge/component_resync.rs').toBeGreaterThan(-1);
    const arms = new Map<string, string>();
    const pieces = drain.slice(start).split('\n            ComponentResync::');
    // Everything before the first arm is the signature, the drain and the `match`.
    pieces.shift();
    for (const piece of pieces) {
      const name = /^[A-Za-z0-9_]+/.exec(piece)?.[0];
      if (name) arms.set(name, piece);
    }
    return arms;
  }

  /** The `ComponentResyncKind` variants — the kinds the drain owes a route. */
  function resyncKinds(core: string): string[] {
    const start = core.indexOf('pub enum ComponentResyncKind {');
    expect(start, 'ComponentResyncKind is missing from core/component_resync.rs').toBeGreaterThan(-1);
    const body = core.slice(start, core.indexOf('\n}', start));
    return [...body.matchAll(/^ {4}([A-Z][A-Za-z0-9]*),$/gm)].map((m) => m[1]);
  }

  /**
   * The complete arm → event-name routing. Every entry is the contract a
   * browser handler is written against; a wrong one is a silent no-op, because
   * an event nobody listens for looks exactly like an entity that simply has no
   * joint / clip / body.
   */
  const DRAIN_ROUTING: Record<string, readonly string[]> = {
    Transform: ['TRANSFORM_CHANGED'],
    Material: ['MATERIAL_CHANGED'],
    Light: ['LIGHT_CHANGED'],
    Physics: ['PHYSICS_CHANGED'],
    Joint: ['JOINT_CHANGED', 'JOINT_REMOVED'],
    Audio: ['AUDIO_CHANGED'],
    Particle: ['PARTICLE_CHANGED'],
    Shader: ['SHADER_CHANGED'],
    Script: ['SCRIPT_CHANGED'],
    GameComponents: ['GAME_COMPONENT_CHANGED'],
    AnimationClip: ['ANIMATION_CLIP_CHANGED', 'ANIMATION_CLIP_REMOVED'],
    Sprite: ['SPRITE_CHANGED'],
    Physics2d: ['PHYSICS2D_CHANGED', 'PHYSICS2D_REMOVED'],
    Joint2d: ['JOINT2D_CHANGED', 'JOINT2D_REMOVED'],
    Tilemap: ['TILEMAP_CHANGED'],
  };

  describe('every drain arm routes to exactly the events it claims', () => {
    it('the routing table covers every ComponentResync kind, and no others', () => {
      const kinds = resyncKinds(read(join('core', 'component_resync.rs')));
      // A parser that finds nothing makes every case below vacuous.
      expect(kinds.length, 'ComponentResyncKind parsed as empty — the scan broke').toBeGreaterThan(10);
      expect([...kinds].sort()).toEqual(Object.keys(DRAIN_ROUTING).sort());
    });

    it('the drain has one arm per kind', () => {
      const arms = drainArms(read(join('bridge', 'component_resync.rs')));
      expect([...arms.keys()].sort()).toEqual(Object.keys(DRAIN_ROUTING).sort());
    });

    it.each(Object.keys(DRAIN_ROUTING))(
      'the %s arm emits exactly its own events',
      (kind) => {
        const events = read(join('bridge', 'events.rs'));
        const arm = drainArms(read(join('bridge', 'component_resync.rs'))).get(kind);
        expect(arm, `no ComponentResync::${kind} arm in the drain`).toBeDefined();
        expect(namesEmittedBy(events, arm!)).toEqual([...DRAIN_ROUTING[kind]].sort());
      },
    );

    /**
     * The inbound half. An event name the engine emits and no handler answers is
     * indistinguishable from an entity that never had the component —
     * `ANIMATION_CLIP_CHANGED` lived that way for its whole life (#9290).
     */
    it.each([...new Set(Object.values(DRAIN_ROUTING).flat())].sort())(
      '%s is handled by a browser event handler',
      (name) => {
        const handlers = readdirSync(join(__dirname, '..'))
          .filter((f) => f.endsWith('.ts'))
          .map((f) => readFileSync(join(__dirname, '..', f), 'utf8'))
          .join('\n');
        expect(handlers.length, 'no handler sources were read').toBeGreaterThan(0);
        expect(handlers).toContain(`case '${name}':`);
      },
    );
  });

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
