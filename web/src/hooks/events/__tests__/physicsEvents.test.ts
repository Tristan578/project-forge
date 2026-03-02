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
}));

// Mock the script collision callback
vi.mock('@/lib/scripting/useScriptRunner', () => ({
  getScriptCollisionCallback: vi.fn(),
}));

// Mock the audio manager
vi.mock('@/lib/audio/audioManager', () => ({
  audioManager: {
    updateOcclusionState: vi.fn(),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore.getState).mockReturnValue(actions as any);
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
    it('strips entityId and passes physics data with enabled flag', () => {
      const payload = {
        entityId: 'entity-1',
        enabled: true,
        bodyType: 'dynamic',
        mass: 1.5,
        friction: 0.3,
        restitution: 0.7,
        colliderType: 'box',
        colliderSize: [1, 1, 1],
        gravityScale: 1.0,
        linearDamping: 0.0,
        angularDamping: 0.05,
      };

      const result = handlePhysicsEvent(
        'PHYSICS_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setPrimaryPhysics).toHaveBeenCalledWith(
        {
          bodyType: 'dynamic',
          mass: 1.5,
          friction: 0.3,
          restitution: 0.7,
          colliderType: 'box',
          colliderSize: [1, 1, 1],
          gravityScale: 1.0,
          linearDamping: 0.0,
          angularDamping: 0.05,
        },
        true
      );
    });

    it('handles disabled physics', () => {
      const payload = {
        entityId: 'entity-2',
        enabled: false,
        bodyType: 'static',
        mass: 0,
        friction: 0.5,
        restitution: 0.0,
        colliderType: 'sphere',
        colliderSize: [1],
        gravityScale: 1.0,
        linearDamping: 0.0,
        angularDamping: 0.0,
      };

      const result = handlePhysicsEvent(
        'PHYSICS_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setPrimaryPhysics).toHaveBeenCalledWith(
        expect.objectContaining({ bodyType: 'static' }),
        false
      );
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
      // When the engine sends null joint data
      const result = handlePhysicsEvent(
        'JOINT_CHANGED',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        null as any,
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

  describe('PHYSICS2D_UPDATED', () => {
    it('calls setPhysics2d with entityId, physics data, and enabled flag', () => {
      const payload = {
        entityId: 'sprite-1',
        enabled: true,
        bodyType: 'dynamic',
        mass: 1.0,
        friction: 0.5,
        restitution: 0.3,
        colliderType: 'rectangle',
        gravityScale: 1.0,
      };

      const result = handlePhysicsEvent(
        'PHYSICS2D_UPDATED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setPhysics2d).toHaveBeenCalledWith(
        'sprite-1',
        {
          bodyType: 'dynamic',
          mass: 1.0,
          friction: 0.5,
          restitution: 0.3,
          colliderType: 'rectangle',
          gravityScale: 1.0,
        },
        true
      );
    });
  });

  describe('JOINT2D_UPDATED', () => {
    it('calls setJoint2d with entityId and joint data', () => {
      const payload = {
        entityId: 'sprite-2',
        jointType: 'revolute',
        targetEntity: 'sprite-1',
        anchor: [0, 0],
      };

      const result = handlePhysicsEvent(
        'JOINT2D_UPDATED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setJoint2d).toHaveBeenCalledWith(
        'sprite-2',
        {
          jointType: 'revolute',
          targetEntity: 'sprite-1',
          anchor: [0, 0],
        }
      );
    });
  });

  describe('PHYSICS2D_REMOVED', () => {
    it('calls removePhysics2d with entityId', () => {
      const payload = { entityId: 'sprite-3' };

      const result = handlePhysicsEvent(
        'PHYSICS2D_REMOVED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.removePhysics2d).toHaveBeenCalledWith('sprite-3');
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
  });

  describe('RAYCAST_RESULT', () => {
    it('forwards non-occlusion raycast to script callback', () => {
      const mockRaycastCb = vi.fn();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__scriptRaycastCallback = mockRaycastCb;

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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__scriptRaycastCallback;
    });

    it('handles audio occlusion raycast (occluded)', () => {
      const payload = {
        requestId: 'audio_occlusion:entity-audio-1',
        hitEntity: 'wall-entity',
        point: [0, 0, 0],
        distance: 2.0,
      };

      const result = handlePhysicsEvent(
        'RAYCAST_RESULT',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(audioManager.updateOcclusionState).toHaveBeenCalledWith(
        'entity-audio-1',
        true
      );
    });

    it('handles audio occlusion raycast (not occluded - hit self)', () => {
      const payload = {
        requestId: 'audio_occlusion:entity-audio-1',
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
      expect(audioManager.updateOcclusionState).toHaveBeenCalledWith(
        'entity-audio-1',
        false
      );
    });

    it('handles audio occlusion raycast (not occluded - no hit)', () => {
      const payload = {
        requestId: 'audio_occlusion:entity-audio-2',
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
      expect(audioManager.updateOcclusionState).toHaveBeenCalledWith(
        'entity-audio-2',
        false
      );
    });

    it('handles no script raycast callback gracefully', () => {
      // Ensure no callback is set on window
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).__scriptRaycastCallback;

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

  describe('RAYCAST2D_RESULT', () => {
    it('returns true (placeholder handler)', () => {
      const result = handlePhysicsEvent(
        'RAYCAST2D_RESULT',
        {},
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
    });
  });
});
