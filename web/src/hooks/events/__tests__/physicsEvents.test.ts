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
    /**
     * The wire is a flattened `JointData` stamped with `entityId` — identical
     * to a `QUERY_JOINTS_LIST` entry, which is why both go through
     * `parseJointWire`. The previous fixtures here (`targetEntity`, `anchor`)
     * were a shape the engine has never emitted; the handler cast rather than
     * parsed, so they passed anyway (the PF-1141 class).
     */
    const wire = (entityId: string) => ({
      entityId,
      jointType: 'revolute',
      connectedEntityId: 'entity-2',
      anchorSelf: [0, 1, 0],
      anchorOther: [0, 0, 0],
      axis: [0, 1, 0],
    });

    const parsedData = {
      jointType: 'revolute',
      connectedEntityId: 'entity-2',
      anchorSelf: [0, 1, 0],
      anchorOther: [0, 0, 0],
      axis: [0, 1, 0],
      limits: null,
      motor: null,
    };

    it('calls setPrimaryJoint when the event describes the selected entity', () => {
      actions.primaryId = 'entity-1';

      const result = handlePhysicsEvent(
        'JOINT_CHANGED',
        wire('entity-1'),
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setPrimaryJoint).toHaveBeenCalledWith(parsedData);
    });

    /**
     * The bug this fixes (#9291): the undo/redo resync drain reports joints on
     * NON-selected entities, and the old handler wrote every one of them into
     * `primaryJoint`. The joint inspector then edits with the foreign body as
     * its base, so the next change writes another entity's joint onto the
     * selection.
     */
    it('does NOT write a foreign entity joint into the selected inspector', async () => {
      actions.primaryId = 'entity-1';

      const result = handlePhysicsEvent(
        'JOINT_CHANGED',
        wire('entity-9'),
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setPrimaryJoint).not.toHaveBeenCalled();

      await Promise.resolve();
      await Promise.resolve();
      expect(actions.setPrimaryJoint).not.toHaveBeenCalled();
    });

    it('applies a late-resolving selection change (viewport pick)', async () => {
      actions.primaryId = 'old-entity';

      handlePhysicsEvent('JOINT_CHANGED', wire('new-entity'), mockSetGet.set, mockSetGet.get);
      expect(actions.setPrimaryJoint).not.toHaveBeenCalled();

      actions.primaryId = 'new-entity';
      await Promise.resolve();
      await Promise.resolve();

      expect(actions.setPrimaryJoint).toHaveBeenCalledWith(parsedData);
    });

    /**
     * `JOINT_CHANGED` cannot express a removal — its payload IS the joint — so
     * a malformed or null body is dropped rather than written through as
     * "removed". `JOINT_REMOVED` is the removal channel.
     */
    it('drops a payload it cannot parse instead of clearing the inspector', () => {
      actions.primaryId = 'entity-1';

      for (const bad of [null, {}, { ...wire('entity-1'), entityId: '' }, { ...wire('entity-1'), jointType: 'nope' }]) {
        const result = handlePhysicsEvent(
          'JOINT_CHANGED',
          bad as unknown as Record<string, unknown>,
          mockSetGet.set,
          mockSetGet.get
        );
        expect(result).toBe(true);
      }

      expect(actions.setPrimaryJoint).not.toHaveBeenCalled();
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

  /**
   * The reply channel for `list_joints_2d`, which answered `Not yet implemented`
   * until PF-1194 while the 3D surface had two read commands. The 3D
   * `QUERY_JOINTS_LIST` had been emitted with no listener at all for its whole
   * life — the same dead-vocabulary shape in the inbound direction — and is
   * wired alongside it; see the `QUERY_JOINTS_LIST` block below.
   */
  describe('QUERY_JOINTS2D_LIST', () => {
    it('applies every joint in the list', () => {
      const result = handlePhysicsEvent(
        'QUERY_JOINTS2D_LIST',
        [
          {
            entityId: 'sprite-1',
            targetEntityId: 'sprite-2',
            jointType: 'revolute',
            localAnchor1: [0, 0],
            localAnchor2: [0, 0],
          },
          {
            entityId: 'sprite-3',
            targetEntityId: 'sprite-4',
            jointType: 'rope',
            localAnchor1: [1, 0],
            localAnchor2: [0, 1],
            maxDistance: 4,
          },
        ],
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.applyJoint2dFromEngine).toHaveBeenCalledTimes(2);
      // Whole-object assertions: the shape IS the behaviour.
      expect(actions.applyJoint2dFromEngine).toHaveBeenNthCalledWith(1, 'sprite-1', {
        targetEntityId: 'sprite-2',
        jointType: 'revolute',
        localAnchor1: [0, 0],
        localAnchor2: [0, 0],
      });
      expect(actions.applyJoint2dFromEngine).toHaveBeenNthCalledWith(2, 'sprite-3', {
        targetEntityId: 'sprite-4',
        jointType: 'rope',
        localAnchor1: [1, 0],
        localAnchor2: [0, 1],
        maxDistance: 4,
      });
    });

    it('routes to the state-only action, never the dispatching one', () => {
      // `setJoint2d` dispatches `set_joint_2d` — one per joint, echoed straight
      // back at the engine that was only asked to describe them.
      handlePhysicsEvent(
        'QUERY_JOINTS2D_LIST',
        [
          {
            entityId: 'sprite-1',
            targetEntityId: 'sprite-2',
            jointType: 'revolute',
            localAnchor1: [0, 0],
            localAnchor2: [0, 0],
          },
        ],
        mockSetGet.set,
        mockSetGet.get
      );

      // Both halves matter. Without the first, this passes against a handler that
      // does not exist at all — the assertion it is here to make is only
      // meaningful once something IS handling the event.
      expect(actions.applyJoint2dFromEngine).toHaveBeenCalledTimes(1);
      expect(actions.setJoint2d).not.toHaveBeenCalled();
    });

    it('skips the entries it cannot read and keeps the rest', () => {
      const good = {
        entityId: 'sprite-1',
        targetEntityId: 'sprite-2',
        jointType: 'revolute',
        localAnchor1: [0, 0],
        localAnchor2: [0, 0],
      };
      // A hole is the input under test. JSON.stringify writes a hole as null and
      // JSON.parse can produce null but never a hole, so both reach this handler
      // from a serialized wire — and `for...of` yields `undefined` for a hole
      // rather than skipping it, unlike every callback form.
      const list = [good, , null, 'not-an-object', { entityId: 'sprite-9' }];

      const result = handlePhysicsEvent(
        'QUERY_JOINTS2D_LIST',
        list,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.applyJoint2dFromEngine).toHaveBeenCalledTimes(1);
      expect(actions.applyJoint2dFromEngine).toHaveBeenCalledWith('sprite-1', {
        targetEntityId: 'sprite-2',
        jointType: 'revolute',
        localAnchor1: [0, 0],
        localAnchor2: [0, 0],
      });
    });

    it('swallows a payload that is not a list rather than throwing', () => {
      const result = handlePhysicsEvent(
        'QUERY_JOINTS2D_LIST',
        { entityId: 'sprite-1' },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.applyJoint2dFromEngine).not.toHaveBeenCalled();
    });
  });

  /**
   * The 3D counterpart, emitted by `process_joint_queries` and — until this
   * change — listened for by nothing at all, so `list_joints` answered into the
   * void and `useEngineEvents` logged it as an unknown engine event.
   *
   * `physicsSlice` holds `primaryJoint` and nothing else for 3D joints, so the
   * list is narrowed to the selection rather than mirrored into a record with
   * no reader.
   */
  describe('QUERY_JOINTS_LIST', () => {
    const REVOLUTE = {
      entityId: 'crate-1',
      jointType: 'revolute',
      connectedEntityId: 'anchor-1',
      anchorSelf: [0, 1, 0],
      anchorOther: [0, -1, 0],
      axis: [0, 0, 1],
      limits: { min: -1.5, max: 1.5 },
      motor: { targetVelocity: 2, maxForce: 40 },
    };

    it('writes the selected entity joint to primaryJoint', () => {
      actions.primaryId = 'crate-1';

      const result = handlePhysicsEvent(
        'QUERY_JOINTS_LIST',
        [{ ...REVOLUTE, entityId: 'crate-9', connectedEntityId: 'anchor-9' }, REVOLUTE],
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setPrimaryJoint).toHaveBeenCalledTimes(1);
      // Whole-object assertion: the shape IS the behaviour, and
      // `objectContaining` is blind to a field the parser invented alongside.
      expect(actions.setPrimaryJoint).toHaveBeenCalledWith({
        jointType: 'revolute',
        connectedEntityId: 'anchor-1',
        anchorSelf: [0, 1, 0],
        anchorOther: [0, -1, 0],
        axis: [0, 0, 1],
        limits: { min: -1.5, max: 1.5 },
        motor: { targetVelocity: 2, maxForce: 40 },
      });
      // `entityId` is the routing key, not joint state — it must not survive
      // into `JointData`, whose fields the inspector writes straight back.
      expect(actions.setPrimaryJoint.mock.calls[0][0]).not.toHaveProperty('entityId');
    });

    it('clears primaryJoint when the selection is absent from the list', () => {
      // The list is the scene's COMPLETE set of jointed entities, so a
      // selection missing from it has no joint — leaving the previous one in
      // place would show a joint the entity does not have.
      actions.primaryId = 'crate-2';

      expect(
        handlePhysicsEvent('QUERY_JOINTS_LIST', [REVOLUTE], mockSetGet.set, mockSetGet.get)
      ).toBe(true);
      expect(actions.setPrimaryJoint).toHaveBeenCalledTimes(1);
      expect(actions.setPrimaryJoint).toHaveBeenCalledWith(null);
    });

    it('drops the answer when nothing is selected', () => {
      // `primaryJoint` has no reader without a selection, and writing through
      // would hand the next entity the user picks a foreign joint as its
      // inspector state.
      actions.primaryId = null;

      expect(
        handlePhysicsEvent('QUERY_JOINTS_LIST', [REVOLUTE], mockSetGet.set, mockSetGet.get)
      ).toBe(true);
      expect(actions.setPrimaryJoint).not.toHaveBeenCalled();
    });

    it('reads Option fields that arrive absent or null as null', () => {
      actions.primaryId = 'crate-1';
      const { limits: _limits, motor: _motor, ...noOptions } = REVOLUTE;

      handlePhysicsEvent(
        'QUERY_JOINTS_LIST',
        [{ ...noOptions, motor: null }],
        mockSetGet.set,
        mockSetGet.get
      );

      expect(actions.setPrimaryJoint).toHaveBeenCalledWith({
        jointType: 'revolute',
        connectedEntityId: 'anchor-1',
        anchorSelf: [0, 1, 0],
        anchorOther: [0, -1, 0],
        axis: [0, 0, 1],
        limits: null,
        motor: null,
      });
    });

    it('skips entries it cannot read and still finds the selection', () => {
      actions.primaryId = 'crate-1';
      // A hole is the input under test: `JSON.stringify` writes one as `null`
      // and `for...of` yields `undefined` for one rather than skipping it, so
      // an indexed read has to tolerate both. An invented `jointType` and a
      // two-element `axis` are the two shapes a cast would wave through.
      const list = [
        ,
        null,
        'not-an-object',
        { ...REVOLUTE, entityId: 'crate-1', jointType: 'wobble' },
        { ...REVOLUTE, entityId: 'crate-1', axis: [0, 0] },
        { ...REVOLUTE, entityId: 'crate-1', anchorSelf: [0, , 1] },
        REVOLUTE,
      ];

      expect(
        handlePhysicsEvent('QUERY_JOINTS_LIST', list, mockSetGet.set, mockSetGet.get)
      ).toBe(true);
      expect(actions.setPrimaryJoint).toHaveBeenCalledTimes(1);
      expect(actions.setPrimaryJoint).toHaveBeenCalledWith(
        expect.objectContaining({ connectedEntityId: 'anchor-1', axis: [0, 0, 1] })
      );
    });

    it('swallows a payload that is not a list rather than throwing', () => {
      actions.primaryId = 'crate-1';

      const result = handlePhysicsEvent(
        'QUERY_JOINTS_LIST',
        { entityId: 'crate-1' },
        mockSetGet.set,
        mockSetGet.get
      );

      // Handled — the name is ours, so passing it on would make the hub log it
      // as an unknown engine event — but nothing is written.
      expect(result).toBe(true);
      expect(actions.setPrimaryJoint).not.toHaveBeenCalled();
    });

    it('routes to the state-only action, never a dispatching one', () => {
      actions.primaryId = 'crate-1';

      handlePhysicsEvent('QUERY_JOINTS_LIST', [REVOLUTE], mockSetGet.set, mockSetGet.get);

      expect(actions.setPrimaryJoint).toHaveBeenCalledTimes(1);
      expect(actions.setJoint).not.toHaveBeenCalled();
    });

    it('reports an array on an unrelated name as unhandled', () => {
      // The array branch runs before the switch, so a name it does not own must
      // fall through to `false` rather than being swallowed by the narrowing.
      expect(
        handlePhysicsEvent('SOME_OTHER_LIST', [REVOLUTE], mockSetGet.set, mockSetGet.get)
      ).toBe(false);
      expect(actions.setPrimaryJoint).not.toHaveBeenCalled();
    });
  });

  describe('2D event names nothing emits', () => {
    /**
     * These are phantom names this handler used to listen for. Pinning them as
     * UNHANDLED is the point: `handlePhysicsEvent` returning `false` is
     * what `useEngineEvents` reports as an unhandled event, so a future rename
     * back onto one of these names fails here instead of silently going dead
     * again. `RAYCAST2D_HIT`/`RAYCAST2D_MISS` are real engine names that are
     * still unhandled — deliberately, and tracked separately: 2D raycasts have
     * no consumer at all.
     */
    it.each([
      'PHYSICS2D_UPDATED',
      'JOINT2D_UPDATED',
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

    /**
   * The removal half of the undo/redo re-report path (#9290, #9291).
   *
   * `PHYSICS2D_REMOVED` was on the phantom list above until the engine started
   * emitting it: `PHYSICS2D_CHANGED` FLATTENS a `Physics2dData`, so it cannot
   * describe a body that is gone, and the undo arm papered over that by sending
   * `Physics2dData::default()` — which the store then merged, leaving a default
   * 2D body behind on the entity whose body had just been undone away.
   */
  describe('component removal events', () => {
    it('PHYSICS2D_REMOVED routes to the state-only removal action', () => {
      const result = handlePhysicsEvent(
        'PHYSICS2D_REMOVED',
        { entityId: 'sprite-9' },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.applyPhysics2dRemovalFromEngine).toHaveBeenCalledWith('sprite-9');
      // The dispatching sibling would send `remove_physics_2d` straight back at
      // the engine that just reported the removal.
      expect(actions.removePhysics2d).not.toHaveBeenCalled();
    });

    it('JOINT2D_REMOVED routes to the state-only removal action', () => {
      const result = handlePhysicsEvent(
        'JOINT2D_REMOVED',
        { entityId: 'sprite-9' },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.applyJoint2dRemovalFromEngine).toHaveBeenCalledWith('sprite-9');
      expect(actions.removeJoint2d).not.toHaveBeenCalled();
    });

    it('JOINT_REMOVED clears the inspector only for the primary entity', () => {
      actions.primaryId = 'entity-1';

      expect(
        handlePhysicsEvent('JOINT_REMOVED', { entityId: 'entity-1' }, mockSetGet.set, mockSetGet.get)
      ).toBe(true);
      expect(actions.setPrimaryJoint).toHaveBeenCalledWith(null);
    });

    it('JOINT_REMOVED for another entity leaves the inspector alone', () => {
      actions.primaryId = 'entity-1';

      expect(
        handlePhysicsEvent('JOINT_REMOVED', { entityId: 'other' }, mockSetGet.set, mockSetGet.get)
      ).toBe(true);
      expect(actions.setPrimaryJoint).not.toHaveBeenCalled();
    });

    it.each(['PHYSICS2D_REMOVED', 'JOINT2D_REMOVED', 'JOINT_REMOVED'])(
      '%s with no entityId writes nothing',
      (name) => {
        actions.primaryId = 'entity-1';

        expect(handlePhysicsEvent(name, {}, mockSetGet.set, mockSetGet.get)).toBe(true);
        expect(actions.applyPhysics2dRemovalFromEngine).not.toHaveBeenCalled();
        expect(actions.applyJoint2dRemovalFromEngine).not.toHaveBeenCalled();
        expect(actions.setPrimaryJoint).not.toHaveBeenCalled();
      }
    );
  });

// `RAYCAST2D_RESULT` used to have three "returns true (placeholder handler)"
  // cases here. It is covered by the "2D event names nothing emits" block above,
  // which asserts the opposite — and the opposite is correct: the engine emits
  // `RAYCAST2D_HIT`/`RAYCAST2D_MISS`, so a placeholder returning `true` claimed an
  // event was handled that could never arrive under that name (PF-1167).
});
