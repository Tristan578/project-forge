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
  firePlayTick: vi.fn(),
}));

// Mock the script-runner bridge so we can assert game events are forwarded to
// the worker (forge.game.onWin) without importing the React-hook module.
const mockScriptGameEventCallback = vi.fn();
vi.mock('@/lib/scripting/useScriptRunner', () => ({
  getScriptGameEventCallback: () => mockScriptGameEventCallback,
}));

import { useEditorStore, firePlayTick } from '@/stores/editorStore';
import { handleGameEvent } from '../gameEvents';
import { isCharacterGrounded, getGroundedStates, clearGroundedStates } from '@/lib/scripting/groundedRegistry';

describe('handleGameEvent', () => {
  let actions: ReturnType<typeof createMockActions>;
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    vi.clearAllMocks();
    actions = createMockActions();
    mockSetGet = createMockSetGet();
    vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, primaryId: null, primaryGameComponents: [], allGameComponents: {} } as unknown as StoreState);
  });

  it('returns false for unknown event types', () => {
    const result = handleGameEvent(
      'UNKNOWN_EVENT',
      {},
      mockSetGet.set,
      mockSetGet.get
    );
    expect(result).toBe(false);
  });

  describe('GAME_COMPONENT_CHANGED', () => {
    it('updates allGameComponents for non-selected entity', () => {
      // Entity is not the primary selected entity
      vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, primaryId: 'other-entity', primaryGameComponents: [], allGameComponents: {} } as unknown as StoreState);

      // The engine's `GameComponentData` is `#[serde(tag = "type", rename_all =
      // "camelCase")]`, so what arrives is FLAT — engine field names sitting beside
      // the discriminant, not nested under a key. Every fixture here is written in
      // that shape, because that is the only shape the editor ever receives.
      const payload = {
        entityId: 'entity-1',
        components: [
          { type: 'health', maxHp: 100, currentHp: 100, invincibilitySecs: 0.5, respawnOnDeath: true, respawnPoint: [0, 1, 0], despawnOnDeath: true },
          { type: 'collectible', value: 10, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 90 },
        ],
      };

      const result = handleGameEvent(
        'GAME_COMPONENT_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(useEditorStore.setState).toHaveBeenCalledWith({
        allGameComponents: {
          'entity-1': [
            { type: 'health', health: { maxHp: 100, currentHp: 100, invincibilitySecs: 0.5, respawnOnDeath: true, respawnPoint: [0, 1, 0], despawnOnDeath: true } },
            { type: 'collectible', collectible: { value: 10, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 90 } },
          ],
        },
        primaryGameComponents: [], // stays unchanged since entity-1 is not primary
      });
    });

    it('updates both allGameComponents and primaryGameComponents for selected entity', () => {
      // Entity IS the primary selected entity
      vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, primaryId: 'entity-1', primaryGameComponents: [], allGameComponents: {} } as unknown as StoreState);

      const payload = {
        entityId: 'entity-1',
        components: [
          { type: 'characterController', speed: 7, jumpHeight: 12, gravityScale: 2, canDoubleJump: true },
        ],
      };

      const result = handleGameEvent(
        'GAME_COMPONENT_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      const expected = [
        { type: 'characterController', characterController: { speed: 7, jumpHeight: 12, gravityScale: 2, canDoubleJump: true } },
      ];

      expect(result).toBe(true);
      expect(useEditorStore.setState).toHaveBeenCalledWith({
        allGameComponents: {
          'entity-1': expected,
        },
        primaryGameComponents: expected, // updated since entity-1 IS primary
      });
    });

    it('drops components the store cannot represent instead of storing them raw', () => {
      // A component type this build has no store shape for, a non-object element,
      // and a prototype-chain name must all vanish rather than reach the inspector
      // as a component with an `undefined` data bag.
      const payload = {
        entityId: 'entity-1',
        components: [
          { type: 'grappleHook', range: 20 },
          'not-an-object',
          { type: 'toString' },
          { speed: 5 },
          { type: 'collectible', value: 3, destroyOnCollect: false, pickupSoundAsset: 'coin.ogg', rotateSpeed: 45 },
        ],
      };

      const result = handleGameEvent(
        'GAME_COMPONENT_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(useEditorStore.setState).toHaveBeenCalledWith({
        allGameComponents: {
          'entity-1': [
            { type: 'collectible', collectible: { value: 3, destroyOnCollect: false, pickupSoundAsset: 'coin.ogg', rotateSpeed: 45 } },
          ],
        },
        primaryGameComponents: [],
      });
    });

    it('warns once per unrepresentable type so a dropped component leaves a trace', () => {
      // Dropping is right — a half-parsed component crashes the inspector section
      // that renders it — but the entity still HAS the component in the engine, and
      // `attachedTypes` is derived from the same store slice, so the type also
      // reappears in the "Add" menu. Silence there is what makes it unfindable.
      // Distinct type names per case: the reporter dedupes on the raw discriminant
      // for the life of the module, which is the point of the second dispatch below.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const payload = {
          entityId: 'entity-1',
          components: [{ type: 'wallRun', clingSecs: 2 }, { type: 'wallRun', clingSecs: 3 }],
        };

        handleGameEvent('GAME_COMPONENT_CHANGED', payload, mockSetGet.set, mockSetGet.get);
        // Twice in one payload, then again in a later event: still one warning.
        handleGameEvent('GAME_COMPONENT_CHANGED', payload, mockSetGet.set, mockSetGet.get);

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0]![0]).toContain('"wallRun"');

        // A different type is a different mismatch and gets its own line.
        handleGameEvent(
          'GAME_COMPONENT_CHANGED',
          { entityId: 'entity-1', components: [{ type: 'grindRail' }] },
          mockSetGet.set,
          mockSetGet.get
        );
        expect(warn).toHaveBeenCalledTimes(2);
        expect(warn.mock.calls[1]![0]).toContain('"grindRail"');
      } finally {
        warn.mockRestore();
      }
    });

    it('clamps an out-of-range emitted value to the bound the engine enforces', () => {
      // `prop_f32(&props, "rotateSpeed", -100.0, 100.0)` — the engine cannot be
      // simulating 500, so the store must not claim it is.
      const payload = {
        entityId: 'entity-1',
        components: [
          { type: 'collectible', value: 1, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 500 },
        ],
      };

      handleGameEvent('GAME_COMPONENT_CHANGED', payload, mockSetGet.set, mockSetGet.get);

      expect(useEditorStore.setState).toHaveBeenCalledWith({
        allGameComponents: {
          'entity-1': [
            { type: 'collectible', collectible: { value: 1, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 100 } },
          ],
        },
        primaryGameComponents: [],
      });
    });

    it('treats a missing components key as an empty list', () => {
      const result = handleGameEvent(
        'GAME_COMPONENT_CHANGED',
        { entityId: 'entity-1' },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(useEditorStore.setState).toHaveBeenCalledWith({
        allGameComponents: { 'entity-1': [] },
        primaryGameComponents: [],
      });
    });

    it('merges with existing allGameComponents entries', () => {
      const existingComponents = {
        'entity-0': [{ type: 'health', health: { maxHp: 50, currentHp: 50, invincibilitySecs: 0, respawnOnDeath: false, respawnPoint: [0, 0, 0], despawnOnDeath: false } }],
      };
      vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, primaryId: null, primaryGameComponents: [], allGameComponents: existingComponents } as unknown as StoreState);

      const payload = {
        entityId: 'entity-1',
        components: [{ type: 'collectible', value: 25, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 0 }],
      };

      const result = handleGameEvent(
        'GAME_COMPONENT_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(useEditorStore.setState).toHaveBeenCalledWith({
        allGameComponents: {
          'entity-0': existingComponents['entity-0'],
          'entity-1': [
            { type: 'collectible', collectible: { value: 25, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 0 } },
          ],
        },
        primaryGameComponents: [],
      });
    });

    it('handles empty components array', () => {
      const stale = [{ type: 'health', health: { maxHp: 100, currentHp: 100, invincibilitySecs: 0, respawnOnDeath: false, respawnPoint: [0, 0, 0], despawnOnDeath: false } }];
      vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, primaryId: 'entity-1', primaryGameComponents: stale, allGameComponents: {} } as unknown as StoreState);

      const payload = {
        entityId: 'entity-1',
        components: [],
      };

      const result = handleGameEvent(
        'GAME_COMPONENT_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(useEditorStore.setState).toHaveBeenCalledWith({
        allGameComponents: { 'entity-1': [] },
        primaryGameComponents: [],
      });
    });
  });

  describe('GAME_CAMERA_CHANGED', () => {
    // The engine answers in the same flat wire vocabulary `set_game_camera`
    // accepts (`offset`, `damping`, `eyeHeight`, `zOffset`, `height`, `radius`),
    // with camelCase mode names. These assertions used to pass the raw payload
    // straight through and asserted PascalCase modes like `ThirdPerson` — a
    // spelling no engine variant has ever had — because the handler cast the
    // string into the union instead of parsing it.
    it('translates a thirdPersonFollow payload into the authoring vocabulary', () => {
      const result = handleGameEvent(
        'GAME_CAMERA_CHANGED',
        { entityId: 'cam-1', mode: 'thirdPersonFollow', targetEntity: 'player-entity', offset: [1.5, 3, -8], damping: 0.9 },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setEntityGameCamera).toHaveBeenCalledWith('cam-1', {
        mode: 'thirdPersonFollow',
        targetEntity: 'player-entity',
        followHeight: 3,
        followDistance: 8,
        // All three components of `offset`, including the sideways one no control
        // edits: what the engine reports has to come back in full, or the next
        // command the user sends rebuilds the vector without it (PF-1125).
        followOffsetX: 1.5,
        followSmoothing: 0.9,
      });
    });

    it('handles firstPerson with a null target', () => {
      const result = handleGameEvent(
        'GAME_CAMERA_CHANGED',
        { entityId: 'cam-2', mode: 'firstPerson', targetEntity: null, eyeHeight: 1.7, mouseSensitivity: 0.2 },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setEntityGameCamera).toHaveBeenCalledWith('cam-2', {
        mode: 'firstPerson',
        targetEntity: null,
        firstPersonHeight: 1.7,
        firstPersonMouseSensitivity: 0.2,
      });
    });

    it.each([
      ['a missing entityId', { mode: 'fixed', targetEntity: null }],
      ['an empty entityId', { entityId: '', mode: 'fixed', targetEntity: null }],
      ['a non-string entityId', { entityId: 7, mode: 'fixed', targetEntity: null }],
    ])('ignores a camera event with %s', (_label, payload) => {
      // The id becomes a KEY in `allGameCameras`. Storing under "undefined"
      // (or "") would put the camera where no `primaryId` can ever match it:
      // the inspector reads null while the store holds a camera for a phantom
      // entity. `castPayload` asserts without checking, so this is the check.
      const result = handleGameEvent('GAME_CAMERA_CHANGED', payload, mockSetGet.set, mockSetGet.get);

      expect(result).toBe(true);
      expect(actions.setEntityGameCamera).not.toHaveBeenCalled();
    });

    it('converts empty string targetEntity to null', () => {
      const result = handleGameEvent(
        'GAME_CAMERA_CHANGED',
        { entityId: 'cam-3', mode: 'fixed', targetEntity: '' },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setEntityGameCamera).toHaveBeenCalledWith('cam-3', {
        mode: 'fixed',
        targetEntity: null,
      });
    });

    it('handles all six camera modes', () => {
      const modes = ['thirdPersonFollow', 'firstPerson', 'sideScroller', 'topDown', 'fixed', 'orbital'];

      for (const mode of modes) {
        vi.clearAllMocks();
        vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, primaryId: null, primaryGameComponents: [], allGameComponents: {} } as unknown as StoreState);

        const result = handleGameEvent(
          'GAME_CAMERA_CHANGED',
          { entityId: 'cam-mode-test', mode, targetEntity: null },
          mockSetGet.set,
          mockSetGet.get
        );

        expect(result).toBe(true);
        expect(actions.setEntityGameCamera).toHaveBeenCalledWith('cam-mode-test', { mode, targetEntity: null });
      }
    });

    it('ignores an unrecognized mode rather than clearing the camera', () => {
      const result = handleGameEvent(
        'GAME_CAMERA_CHANGED',
        { entityId: 'cam-4', mode: 'ThirdPerson', targetEntity: null },
        mockSetGet.set,
        mockSetGet.get
      );

      // Handled (the event is ours) but not applied — a mode the store cannot
      // represent must not be cast into the union, and must not be read as a
      // request to delete the entity's camera.
      expect(result).toBe(true);
      expect(actions.setEntityGameCamera).not.toHaveBeenCalled();
    });
  });

  describe('ACTIVE_GAME_CAMERA_CHANGED', () => {
    it('calls setActiveGameCameraId with entity ID', () => {
      const payload = { entityId: 'cam-active-1' };

      const result = handleGameEvent(
        'ACTIVE_GAME_CAMERA_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setActiveGameCameraId).toHaveBeenCalledWith('cam-active-1');
    });

    it('handles null entityId (no active camera)', () => {
      const payload = { entityId: null };

      const result = handleGameEvent(
        'ACTIVE_GAME_CAMERA_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setActiveGameCameraId).toHaveBeenCalledWith(null);
    });
  });

  describe('PLAY_TICK', () => {
    it('forwards payload to firePlayTick', () => {
      const payload = {
        entities: {
          'entity-1': {
            position: [1, 2, 3] as [number, number, number],
            rotation: [0, 45, 0] as [number, number, number],
            scale: [1, 1, 1] as [number, number, number],
          },
          'entity-2': {
            position: [4, 5, 6] as [number, number, number],
            rotation: [0, 0, 90] as [number, number, number],
            scale: [2, 2, 2] as [number, number, number],
          },
        },
        entityInfos: {
          'entity-1': { name: 'Player', type: 'cube', colliderRadius: 0.5 },
          'entity-2': { name: 'Enemy', type: 'sphere', colliderRadius: 1.0 },
        },
        inputState: {
          pressed: { move_forward: true, jump: false },
          justPressed: { jump: true },
          justReleased: {},
          axes: { move_horizontal: 0.5 },
        },
      };

      const result = handleGameEvent(
        'PLAY_TICK',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(firePlayTick).toHaveBeenCalledWith(payload);
    });

    it('handles empty entities in play tick', () => {
      const payload = {
        entities: {},
        entityInfos: {},
        inputState: {
          pressed: {},
          justPressed: {},
          justReleased: {},
          axes: {},
        },
      };

      const result = handleGameEvent(
        'PLAY_TICK',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(firePlayTick).toHaveBeenCalledWith(payload);
    });
  });

  describe('GAME_EVENT', () => {
    it('flips the win flag and forwards game_win to the script worker', () => {
      const setGameWon = vi.fn();
      vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, setGameWon } as unknown as StoreState);

      const payload = { eventName: 'game_win', sourceEntityId: 'goal-1', targetEntityId: 'player-1' };

      const result = handleGameEvent('GAME_EVENT', payload, mockSetGet.set, mockSetGet.get);

      expect(result).toBe(true);
      expect(setGameWon).toHaveBeenCalledWith(true);
      // Win event must reach the script worker so forge.game.onWin handlers fire.
      expect(mockScriptGameEventCallback).toHaveBeenCalledWith(payload);
    });

    it('forwards non-win game events without flipping the win flag', () => {
      const setGameWon = vi.fn();
      vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, setGameWon } as unknown as StoreState);

      const payload = { eventName: 'collectible_collected', sourceEntityId: 'coin-1', targetEntityId: 'player-1' };

      const result = handleGameEvent('GAME_EVENT', payload, mockSetGet.set, mockSetGet.get);

      expect(result).toBe(true);
      expect(setGameWon).not.toHaveBeenCalled();
      expect(mockScriptGameEventCallback).toHaveBeenCalledWith(payload);
    });
  });

  /**
   * PF-1214. Rapier decides `grounded` inside the character sweep and nothing
   * on this side can see it, so the bridge emits the changes and this handler
   * is the only thing that writes them into the script-visible mirror.
   */
  describe('CHARACTER_GROUNDED_CHANGED', () => {
    beforeEach(() => {
      clearGroundedStates();
    });

    it('records a ground contact for the script sandbox', () => {
      const result = handleGameEvent(
        'CHARACTER_GROUNDED_CHANGED',
        { entityId: 'player-1', grounded: true },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(isCharacterGrounded('player-1')).toBe(true);
    });

    it('records leaving the ground', () => {
      handleGameEvent('CHARACTER_GROUNDED_CHANGED', { entityId: 'player-1', grounded: true }, mockSetGet.set, mockSetGet.get);
      handleGameEvent('CHARACTER_GROUNDED_CHANGED', { entityId: 'player-1', grounded: false }, mockSetGet.set, mockSetGet.get);

      expect(isCharacterGrounded('player-1')).toBe(false);
    });

    /**
     * The id is a KEY in the mirror. `castPayload` is an unchecked assertion,
     * so an absent id would file the contact under the string "undefined" and
     * a script asking about the real player would never see it.
     */
    it('ignores a payload with no usable entity id', () => {
      const result = handleGameEvent(
        'CHARACTER_GROUNDED_CHANGED',
        { grounded: true },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(isCharacterGrounded('undefined')).toBe(false);
      expect(getGroundedStates()).toEqual({});
    });

    it('ignores an empty entity id', () => {
      handleGameEvent('CHARACTER_GROUNDED_CHANGED', { entityId: '', grounded: true }, mockSetGet.set, mockSetGet.get);
      expect(getGroundedStates()).toEqual({});
    });

    /**
     * Anything that is not literally `true` means "not standing on something".
     * A truthy-but-not-boolean value from a mismatched engine build must not
     * read as ground.
     */
    it('treats a non-boolean grounded field as airborne', () => {
      handleGameEvent(
        'CHARACTER_GROUNDED_CHANGED',
        { entityId: 'player-1', grounded: 'yes' },
        mockSetGet.set,
        mockSetGet.get
      );
      expect(isCharacterGrounded('player-1')).toBe(false);
    });
  });
});
