// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSetGet, createMockActions } from './eventTestUtils';

// Mock the editor store module
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
  firePlayTick: vi.fn(),
}));

import { useEditorStore, firePlayTick } from '@/stores/editorStore';
import { handleGameEvent } from '../gameEvents';

describe('handleGameEvent', () => {
  let actions: ReturnType<typeof createMockActions>;
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    vi.clearAllMocks();
    actions = createMockActions();
    mockSetGet = createMockSetGet();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, primaryId: null, primaryGameComponents: [], allGameComponents: {} } as any);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, primaryId: 'other-entity', primaryGameComponents: [], allGameComponents: {} } as any);

      const payload = {
        entityId: 'entity-1',
        components: [
          { type: 'Health', config: { maxHealth: 100, currentHealth: 100 } },
          { type: 'Collectible', config: { value: 10, type: 'coin' } },
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
          'entity-1': payload.components,
        },
        primaryGameComponents: [], // stays unchanged since entity-1 is not primary
      });
    });

    it('updates both allGameComponents and primaryGameComponents for selected entity', () => {
      // Entity IS the primary selected entity
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, primaryId: 'entity-1', primaryGameComponents: [], allGameComponents: {} } as any);

      const components = [
        { type: 'CharacterController', config: { speed: 5, jumpForce: 10 } },
      ];

      const payload = {
        entityId: 'entity-1',
        components,
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
          'entity-1': components,
        },
        primaryGameComponents: components, // updated since entity-1 IS primary
      });
    });

    it('merges with existing allGameComponents entries', () => {
      const existingComponents = {
        'entity-0': [{ type: 'Health', config: { maxHealth: 50, currentHealth: 50 } }],
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, primaryId: null, primaryGameComponents: [], allGameComponents: existingComponents } as any);

      const payload = {
        entityId: 'entity-1',
        components: [{ type: 'Collectible', config: { value: 25 } }],
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
          'entity-1': payload.components,
        },
        primaryGameComponents: [],
      });
    });

    it('handles empty components array', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, primaryId: 'entity-1', primaryGameComponents: [{ type: 'Health', config: {} }], allGameComponents: {} } as any);

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
    it('calls setEntityGameCamera with ThirdPerson mode and target', () => {
      const payload = {
        entityId: 'cam-1',
        mode: 'ThirdPerson',
        targetEntity: 'player-entity',
      };

      const result = handleGameEvent(
        'GAME_CAMERA_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setEntityGameCamera).toHaveBeenCalledWith('cam-1', {
        mode: 'ThirdPerson',
        targetEntity: 'player-entity',
      });
    });

    it('handles FirstPerson mode with null target', () => {
      const payload = {
        entityId: 'cam-2',
        mode: 'FirstPerson',
        targetEntity: null,
      };

      const result = handleGameEvent(
        'GAME_CAMERA_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setEntityGameCamera).toHaveBeenCalledWith('cam-2', {
        mode: 'FirstPerson',
        targetEntity: null,
      });
    });

    it('converts empty string targetEntity to null', () => {
      const payload = {
        entityId: 'cam-3',
        mode: 'Fixed',
        targetEntity: '',
      };

      const result = handleGameEvent(
        'GAME_CAMERA_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setEntityGameCamera).toHaveBeenCalledWith('cam-3', {
        mode: 'Fixed',
        targetEntity: null,
      });
    });

    it('handles all camera modes', () => {
      const modes = ['ThirdPerson', 'FirstPerson', 'SideScroller', 'TopDown', 'Fixed', 'Orbital'];

      for (const mode of modes) {
        vi.clearAllMocks();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, primaryId: null, primaryGameComponents: [], allGameComponents: {} } as any);

        const payload = {
          entityId: 'cam-mode-test',
          mode,
          targetEntity: null,
        };

        const result = handleGameEvent(
          'GAME_CAMERA_CHANGED',
          payload,
          mockSetGet.set,
          mockSetGet.get
        );

        expect(result).toBe(true);
        expect(actions.setEntityGameCamera).toHaveBeenCalledWith('cam-mode-test', {
          mode,
          targetEntity: null,
        });
      }
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
});
