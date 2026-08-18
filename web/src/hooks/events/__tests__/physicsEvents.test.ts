// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSetGet, createMockActions, type StoreState } from './eventTestUtils';

// Mock the editor store module
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

// Mock the script collision callback
vi.mock('@/lib/scripting/useScriptRunner', () => ({
  getScriptCollisionCallback: vi.fn(),
}));

// Mock the audio manager
vi.mock('@/lib/audio/audioManager', () => ({
  audioManager: {
    updateOcclusionAmount: vi.fn(),
  },
}));

import { useEditorStore } from '@/stores/editorStore';
import { getScriptCollisionCallback } from '@/lib/scripting/useScriptRunner';
import { audioManager } from '@/lib/audio/audioManager';
import { handlePhysicsEvent } from '../physicsEvents';

describe('handlePhysicsEvent', () => {
  let actions: ReturnType<typeof createMockActions>;
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    vi.clearAllMocks();
    actions = createMockActions();
    mockSetGet = createMockSetGet();
    vi.mocked(useEditorStore.getState).mockReturnValue(actions as unknown as StoreState);
  });

  it('returns false for unknown event types', () => {
    const result = handlePhysicsEvent(
      'UNKNOWN_EVENT',
      {},
      mockSetGet.set,
      mockSetGet.get
    );
    expect(result).toBe(false);
  });

  describe('PHYSICS_CHANGED', () => {
    /**
     * The engine emits every field of `PhysicsData` — the 13 in
     * `stores/slices/types.ts`, mirroring the Rust struct of the same name.
     * Earlier fixtures here asserted `mass`, `colliderType`, `colliderSize`,
     * `linearDamping` and `angularDamping`, none of which exist on either side
     * of the wire; the handler passes its payload through untouched, so those
     * assertions passed while describing an event the engine cannot send
     * (PF-1118 review F19).
     */
    const fullPhysics = () => ({
      bodyType: 'dynamic' as const,
      colliderShape: 'cuboid' as const,
      restitution: 0.7,
      friction: 0.3,
      density: 1.5,
      gravityScale: 1.0,
      lockTranslationX: false,
      lockTranslationY: false,
      lockTranslationZ: false,
      lockRotationX: false,
      lockRotationY: true,
      lockRotationZ: false,
      isSensor: false,
    });

    it('strips entityId and passes physics data with enabled flag', () => {
      actions.primaryId = 'entity-1';
      const physics = fullPhysics();

      const result = handlePhysicsEvent(
        'PHYSICS_CHANGED',
        { entityId: 'entity-1', enabled: true, ...physics },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setPrimaryPhysics).toHaveBeenCalledWith(physics, true);
    });

    it('handles disabled physics', () => {
      actions.primaryId = 'entity-2';
      const physics = { ...fullPhysics(), bodyType: 'fixed' as const, density: 0 };

      const result = handlePhysicsEvent(
        'PHYSICS_CHANGED',
        { entityId: 'entity-2', enabled: false, ...physics },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      // Full-shape, not `objectContaining`: a containing matcher cannot catch a
      // field the handler drops, which is the whole defect class this PR closes.
      expect(actions.setPrimaryPhysics).toHaveBeenCalledWith(physics, false);
    });

    it('should strip entityId from physics data', () => {
      actions.primaryId = 'entity-1';
      handlePhysicsEvent(
        'PHYSICS_CHANGED',
        { entityId: 'entity-1', enabled: false, bodyType: 'fixed' },
        mockSetGet.set,
        mockSetGet.get
      );

      const calledData = actions.setPrimaryPhysics.mock.calls[0][0];
      expect(calledData).not.toHaveProperty('entityId');
      expect(calledData).not.toHaveProperty('enabled');
    });

    // PF-1118 review F2: a bulk update_physics (Physics Feel "Apply") makes the
    // engine emit PHYSICS_CHANGED for EVERY touched entity, not just the
    // selected one. Letting a foreign payload into primaryPhysics means the
    // next slider nudge writes that entity's 13 fields onto the selected one.
    describe('primary-selection guard', () => {
      it('ignores an event for an entity that is not the primary selection', async () => {
        actions.primaryId = 'ground-platform';

        const result = handlePhysicsEvent(
          'PHYSICS_CHANGED',
          { entityId: 'enemy-7', enabled: true, bodyType: 'dynamic', friction: 0.9 },
          mockSetGet.set,
          mockSetGet.get
        );

        // Still "handled" — no other domain handler should try to claim it.
        expect(result).toBe(true);
        expect(actions.setPrimaryPhysics).not.toHaveBeenCalled();

        // The deferred re-check must not resurrect it either.
        await Promise.resolve();
        await Promise.resolve();
        expect(actions.setPrimaryPhysics).not.toHaveBeenCalled();
      });

      it('applies an event for the entity that IS the primary selection', () => {
        actions.primaryId = 'ground-platform';

        const result = handlePhysicsEvent(
          'PHYSICS_CHANGED',
          { entityId: 'ground-platform', enabled: true, bodyType: 'fixed', friction: 0.4 },
          mockSetGet.set,
          mockSetGet.get
        );

        expect(result).toBe(true);
        expect(actions.setPrimaryPhysics).toHaveBeenCalledWith(
          { bodyType: 'fixed', friction: 0.4 },
          true
        );
      });

      it('keeps the selected entity intact across a whole-scene bulk apply', async () => {
        actions.primaryId = 'ground-platform';

        for (const entityId of ['enemy-1', 'ground-platform', 'enemy-2', 'crate-3']) {
          handlePhysicsEvent(
            'PHYSICS_CHANGED',
            {
              entityId,
              enabled: true,
              bodyType: entityId === 'ground-platform' ? 'fixed' : 'dynamic',
              friction: 0.5,
            },
            mockSetGet.set,
            mockSetGet.get
          );
        }

        await Promise.resolve();
        await Promise.resolve();

        expect(actions.setPrimaryPhysics).toHaveBeenCalledTimes(1);
        expect(actions.setPrimaryPhysics).toHaveBeenCalledWith(
          { bodyType: 'fixed', friction: 0.5 },
          true
        );
      });

      it('applies a late-resolving selection change (viewport pick)', async () => {
        // useEngineEvents batches SELECTION_CHANGED through a queueMicrotask,
        // so PHYSICS_CHANGED for the newly picked entity is handled while the
        // store still reports the PREVIOUS primary.
        actions.primaryId = 'old-entity';

        const result = handlePhysicsEvent(
          'PHYSICS_CHANGED',
          { entityId: 'new-entity', enabled: true, bodyType: 'dynamic', friction: 0.2 },
          mockSetGet.set,
          mockSetGet.get
        );

        expect(result).toBe(true);
        expect(actions.setPrimaryPhysics).not.toHaveBeenCalled();

        // Selection batcher flush lands.
        actions.primaryId = 'new-entity';
        await Promise.resolve();
        await Promise.resolve();

        expect(actions.setPrimaryPhysics).toHaveBeenCalledWith(
          { bodyType: 'dynamic', friction: 0.2 },
          true
        );
      });

      it('does NOT write through when nothing is selected', async () => {
        actions.primaryId = null;

        handlePhysicsEvent(
          'PHYSICS_CHANGED',
          { entityId: 'anything', enabled: false, bodyType: 'fixed' },
          mockSetGet.set,
          mockSetGet.get
        );

        // "Nothing selected" is not a safe case. The payload would survive in
        // the store and become the inspector state of whichever entity the user
        // selects next, so the first slider nudge would write a foreign body
        // onto it — the same corruption the mismatch branch prevents, deferred.
        expect(actions.setPrimaryPhysics).not.toHaveBeenCalled();

        await Promise.resolve();
        await Promise.resolve();
        expect(actions.setPrimaryPhysics).not.toHaveBeenCalled();
      });

      it('applies once the user selects the entity the event described', async () => {
        actions.primaryId = null;

        handlePhysicsEvent(
          'PHYSICS_CHANGED',
          { entityId: 'crate-3', enabled: true, bodyType: 'dynamic', friction: 0.6 },
          mockSetGet.set,
          mockSetGet.get
        );

        actions.primaryId = 'crate-3';
        await Promise.resolve();
        await Promise.resolve();

        expect(actions.setPrimaryPhysics).toHaveBeenCalledWith(
          { bodyType: 'dynamic', friction: 0.6 },
          true
        );
      });
    });
  });

  describe('JOINT_CHANGED', () => {
    it('calls setPrimaryJoint with joint data', () => {
      const jointData = {
        jointType: 'revolute',
        targetEntity: 'entity-2',
        anchor: [0, 1, 0],
        axis: [0, 1, 0],
      };

      const result = handlePhysicsEvent(
        'JOINT_CHANGED',
        jointData,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setPrimaryJoint).toHaveBeenCalledWith(jointData);
    });

    it('handles null joint data (joint removed)', () => {
      const result = handlePhysicsEvent(
        'JOINT_CHANGED',
        null as unknown as Record<string, unknown>,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setPrimaryJoint).toHaveBeenCalledWith(null);
    });
  });

  describe('DEBUG_PHYSICS_CHANGED', () => {
    it('calls setDebugPhysics with enabled=true', () => {
      const payload = { enabled: true };

      const result = handlePhysicsEvent(
        'DEBUG_PHYSICS_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setDebugPhysics).toHaveBeenCalledWith(true);
    });

    it('calls setDebugPhysics with enabled=false', () => {
      const payload = { enabled: false };

      const result = handlePhysicsEvent(
        'DEBUG_PHYSICS_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setDebugPhysics).toHaveBeenCalledWith(false);
    });
  });

  /**
   * `PHYSICS2D_CHANGED` is the name the engine actually emits. The three blocks
   * that used to sit here asserted `PHYSICS2D_UPDATED`, `JOINT2D_UPDATED` and
   * `PHYSICS2D_REMOVED` — names nothing has ever emitted — against flat camelCase
   * payloads the engine has never sent. They passed for their whole life because
   * the handler had a matching (equally phantom) `case` for each, so the suite
   * described a wire format that existed only in the suite (PF-1167).
   */
  describe('PHYSICS2D_CHANGED', () => {
    it('translates the flattened snake_case wire into store vocabulary', () => {
      const result = handlePhysicsEvent(
        'PHYSICS2D_CHANGED',
        {
          entityId: 'sprite-1',
          enabled: true,
          body_type: 'Static',
          collider_shape: 'ConvexPolygon',
          mass: 1,
          friction: 0.5,
          gravity_scale: 0,
          one_way_platform: true,
          surface_velocity: [3, 0],
        },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      // toEqual on the whole patch, not objectContaining: the translation IS the
      // behaviour, and objectContaining cannot see an untranslated key alongside a
      // translated one.
      expect(actions.applyPhysics2dFromEngine).toHaveBeenCalledWith(
        'sprite-1',
        {
          bodyType: 'static',
          colliderShape: 'convex_polygon',
          mass: 1,
          friction: 0.5,
          gravityScale: 0,
          oneWayPlatform: true,
          surfaceVelocity: [3, 0],
        },
        true
      );
    });

    it('routes to the state-only action, never the dispatching one', () => {
      // `setPhysics2d` dispatches `set_physics_2d` — a FULL REPLACE — so calling it
      // from an inbound handler both echoes a command back at the engine and resets
      // every field this event did not carry.
      handlePhysicsEvent(
        'PHYSICS2D_CHANGED',
        { entityId: 'sprite-2', enabled: true, mass: 4 },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(actions.setPhysics2d).not.toHaveBeenCalled();
      expect(actions.applyPhysics2dFromEngine).toHaveBeenCalledTimes(1);
    });

    it('reports a disabled entity as disabled', () => {
      handlePhysicsEvent(
        'PHYSICS2D_CHANGED',
        { entityId: 'sprite-3', enabled: false, body_type: 'Kinematic' },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(actions.applyPhysics2dFromEngine).toHaveBeenCalledWith(
        'sprite-3',
        { bodyType: 'kinematic' },
        false
      );
    });

    it('swallows a payload with no usable entityId rather than writing state', () => {
      const result = handlePhysicsEvent(
        'PHYSICS2D_CHANGED',
        { enabled: true, mass: 2 },
        mockSetGet.set,
        mockSetGet.get
      );

      // Handled — the event was ours — but nothing is written, because there is no
      // entity to write it to.
      expect(result).toBe(true);
      expect(actions.applyPhysics2dFromEngine).not.toHaveBeenCalled();
    });
  });

  /**
   * `JOINT2D_CHANGED` had no handler at all for its whole life, so every joint
   * the engine reported was dropped on the floor. The emitter also FLATTENED
   * `PhysicsJoint2d` into a camelCase wrapper — and `rename_all` does not
   * propagate through `#[serde(flatten)]` — so the wire carried snake_case keys
   * wrapped around a nested, externally-tagged PascalCase `JointType2d`, a shape
   * the store's flat `Joint2dData` could not have been built from even if a
   * handler had existed. Both halves are fixed together (PF-1167).
   */
  describe('JOINT2D_CHANGED', () => {
    it('translates the flat wire into store vocabulary', () => {
      const result = handlePhysicsEvent(
        'JOINT2D_CHANGED',
        {
          entityId: 'sprite-1',
          targetEntityId: 'sprite-2',
          jointType: 'spring',
          localAnchor1: [0, 1],
          localAnchor2: [0, -1],
          restLength: 2,
          stiffness: 30,
          damping: 0.25,
        },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      // Whole-object assertion, not objectContaining: the shape IS the behaviour.
      expect(actions.applyJoint2dFromEngine).toHaveBeenCalledWith('sprite-1', {
        targetEntityId: 'sprite-2',
        jointType: 'spring',
        localAnchor1: [0, 1],
        localAnchor2: [0, -1],
        restLength: 2,
        stiffness: 30,
        damping: 0.25,
      });
    });

    it('routes to the state-only action, never the dispatching one', () => {
      // `setJoint2d` dispatches `set_joint_2d` — calling it from an inbound
      // handler echoes a command straight back at the engine that just described
      // the joint.
      handlePhysicsEvent(
        'JOINT2D_CHANGED',
        {
          entityId: 'sprite-1',
          targetEntityId: 'sprite-2',
          jointType: 'revolute',
          localAnchor1: [0, 0],
          localAnchor2: [0, 0],
        },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(actions.setJoint2d).not.toHaveBeenCalled();
      expect(actions.applyJoint2dFromEngine).toHaveBeenCalledTimes(1);
    });

    it('swallows an unreadable payload rather than writing state', () => {
      const result = handlePhysicsEvent(
        'JOINT2D_CHANGED',
        // No `jointType` — there is no joint to write.
        { entityId: 'sprite-1', targetEntityId: 'sprite-2' },
        mockSetGet.set,
        mockSetGet.get
      );

      // Handled — the event was ours — but nothing is written.
      expect(result).toBe(true);
      expect(actions.applyJoint2dFromEngine).not.toHaveBeenCalled();
    });
  });

  describe('2D event names nothing emits', () => {
    /**
     * These four are the phantom names this handler used to listen for. Pinning
     * them as UNHANDLED is the point: `handlePhysicsEvent` returning `false` is
     * what `useEngineEvents` reports as an unhandled event, so a future rename
     * back onto one of these names fails here instead of silently going dead
     * again. `RAYCAST2D_HIT`/`RAYCAST2D_MISS` are real engine names that are
     * still unhandled — deliberately, and tracked separately: 2D raycasts have
     * no consumer at all.
     */
    it.each([
      'PHYSICS2D_UPDATED',
      'JOINT2D_UPDATED',
      'PHYSICS2D_REMOVED',
      'RAYCAST2D_RESULT',
      'RAYCAST2D_HIT',
      'RAYCAST2D_MISS',
    ])('%s is reported unhandled and touches no store action', (eventName) => {
      const result = handlePhysicsEvent(
        eventName,
        { entityId: 'sprite-9', enabled: true, mass: 1 },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(false);
      expect(actions.applyPhysics2dFromEngine).not.toHaveBeenCalled();
      expect(actions.setPhysics2d).not.toHaveBeenCalled();
      expect(actions.setJoint2d).not.toHaveBeenCalled();
      expect(actions.applyJoint2dFromEngine).not.toHaveBeenCalled();
      expect(actions.removePhysics2d).not.toHaveBeenCalled();
    });
  });

  describe('COLLISION_EVENT', () => {
    it('invokes script collision callback when set', () => {
      const mockCallback = vi.fn();
      vi.mocked(getScriptCollisionCallback).mockReturnValue(mockCallback);

      const payload = {
        entityA: 'entity-1',
        entityB: 'entity-2',
        started: true,
      };

      const result = handlePhysicsEvent(
        'COLLISION_EVENT',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(mockCallback).toHaveBeenCalledWith(payload);
    });

    it('handles missing collision callback gracefully', () => {
      vi.mocked(getScriptCollisionCallback).mockReturnValue(null);

      const payload = {
        entityA: 'entity-1',
        entityB: 'entity-2',
        started: false,
      };

      const result = handlePhysicsEvent(
        'COLLISION_EVENT',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
    });

    it('invokes callback for collision end events', () => {
      const mockCallback = vi.fn();
      vi.mocked(getScriptCollisionCallback).mockReturnValue(mockCallback);

      const payload = {
        entityA: 'entity-3',
        entityB: 'entity-4',
        started: false,
      };

      const result = handlePhysicsEvent(
        'COLLISION_EVENT',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(mockCallback).toHaveBeenCalledWith(payload);
      expect(mockCallback.mock.calls[0][0].started).toBe(false);
    });
  });

  describe('RAYCAST_RESULT', () => {
    it('forwards non-occlusion raycast to script callback', () => {
      const mockRaycastCb = vi.fn();
      (window as unknown as Record<string, unknown>).__scriptRaycastCallback = mockRaycastCb;

      const payload = {
        requestId: 'my-raycast-1',
        hitEntity: 'entity-5',
        point: [1, 2, 3],
        distance: 4.5,
      };

      const result = handlePhysicsEvent(
        'RAYCAST_RESULT',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(mockRaycastCb).toHaveBeenCalledWith(payload);

      delete (window as unknown as Record<string, unknown>).__scriptRaycastCallback;
    });

    it('calculates graduated amount: hit at 25% distance → amount ~0.75', () => {
      // totalDistance = 4.0, hitDistance = 1.0 → amount = 1 - (1/4) = 0.75
      const payload = {
        requestId: 'audio_occlusion:entity-audio-1:4',
        hitEntity: 'wall-entity',
        point: [0, 0, 0],
        distance: 1.0,
      };

      const result = handlePhysicsEvent(
        'RAYCAST_RESULT',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(audioManager.updateOcclusionAmount).toHaveBeenCalledWith(
        'entity-audio-1',
        0.75
      );
    });

    it('calculates graduated amount: hit at 75% distance → amount ~0.25', () => {
      // totalDistance = 4.0, hitDistance = 3.0 → amount = 1 - (3/4) = 0.25
      const payload = {
        requestId: 'audio_occlusion:entity-audio-1:4',
        hitEntity: 'wall-entity',
        point: [0, 0, 0],
        distance: 3.0,
      };

      const result = handlePhysicsEvent(
        'RAYCAST_RESULT',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(audioManager.updateOcclusionAmount).toHaveBeenCalledWith(
        'entity-audio-1',
        0.25
      );
    });

    it('handles audio occlusion raycast (no hit → amount 0)', () => {
      const payload = {
        requestId: 'audio_occlusion:entity-audio-2:10',
        hitEntity: null,
        point: [0, 0, 0],
        distance: 0,
      };

      const result = handlePhysicsEvent(
        'RAYCAST_RESULT',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(audioManager.updateOcclusionAmount).toHaveBeenCalledWith(
        'entity-audio-2',
        0
      );
    });

    it('handles audio occlusion raycast (hit self → amount 0)', () => {
      const payload = {
        requestId: 'audio_occlusion:entity-audio-1:5',
        hitEntity: 'entity-audio-1',
        point: [0, 0, 0],
        distance: 5.0,
      };

      const result = handlePhysicsEvent(
        'RAYCAST_RESULT',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(audioManager.updateOcclusionAmount).toHaveBeenCalledWith(
        'entity-audio-1',
        0
      );
    });

    it('clamps amount to 0 when hitDistance >= totalDistance', () => {
      // hitDistance (5.0) >= totalDistance (4.0) → clamped to 0
      const payload = {
        requestId: 'audio_occlusion:entity-audio-1:4',
        hitEntity: 'wall-entity',
        point: [0, 0, 0],
        distance: 5.0,
      };

      const result = handlePhysicsEvent(
        'RAYCAST_RESULT',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(audioManager.updateOcclusionAmount).toHaveBeenCalledWith(
        'entity-audio-1',
        0
      );
    });

    it('handles no script raycast callback gracefully', () => {
      // Ensure no callback is set on window
      delete (window as unknown as Record<string, unknown>).__scriptRaycastCallback;

      const payload = {
        requestId: 'my-raycast-2',
        hitEntity: null,
        point: [0, 0, 0],
        distance: 0,
      };

      const result = handlePhysicsEvent(
        'RAYCAST_RESULT',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
    });
  });

  // `RAYCAST2D_RESULT` used to have three "returns true (placeholder handler)"
  // cases here. It is covered by the "2D event names nothing emits" block above,
  // which asserts the opposite — and the opposite is correct: the engine emits
  // `RAYCAST2D_HIT`/`RAYCAST2D_MISS`, so a placeholder returning `true` claimed an
  // event was handled that could never arrive under that name (PF-1167).
});
