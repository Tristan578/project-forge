import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSetGet } from './eventTestUtils';

// Mock the editor store module
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

// Mock the script runner collision callback
vi.mock('@/lib/scripting/useScriptRunner', () => ({
  getScriptCollisionCallback: vi.fn(),
}));

import { useEditorStore } from '@/stores/editorStore';
import { getScriptCollisionCallback } from '@/lib/scripting/useScriptRunner';
import { handlePhysicsEvent } from '../physicsEvents';

describe('handlePhysicsEvent', () => {
  let mockSetGet: ReturnType<typeof createMockSetGet>;
  const mockActions = {
    setPrimaryPhysics: vi.fn(),
    setPrimaryJoint: vi.fn(),
    setDebugPhysics: vi.fn(),
    setPhysics2d: vi.fn(),
    setJoint2d: vi.fn(),
    removePhysics2d: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSetGet = createMockSetGet();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore.getState).mockReturnValue(mockActions as any);
  });

  it('returns false for unknown event types', () => {
    const result = handlePhysicsEvent('UNKNOWN_EVENT', {}, mockSetGet.set, mockSetGet.get);
    expect(result).toBe(false);
  });

  describe('PHYSICS_CHANGED', () => {
    it('should call setPrimaryPhysics with data and enabled flag', () => {
      const payload = {
        entityId: 'entity-1',
        enabled: true,
        bodyType: 'dynamic',
        mass: 2.0,
        restitution: 0.5,
      };

      const result = handlePhysicsEvent('PHYSICS_CHANGED', payload, mockSetGet.set, mockSetGet.get);

      expect(result).toBe(true);
      expect(mockActions.setPrimaryPhysics).toHaveBeenCalledWith(
        { bodyType: 'dynamic', mass: 2.0, restitution: 0.5 },
        true
      );
    });

    it('should strip entityId from physics data', () => {
      const payload = { entityId: 'entity-1', enabled: false, bodyType: 'static' };
      handlePhysicsEvent('PHYSICS_CHANGED', payload, mockSetGet.set, mockSetGet.get);

      const calledData = mockActions.setPrimaryPhysics.mock.calls[0][0];
      expect(calledData).not.toHaveProperty('entityId');
      expect(calledData).not.toHaveProperty('enabled');
    });
  });

  describe('JOINT_CHANGED', () => {
    it('should call setPrimaryJoint with joint data', () => {
      const payload = { jointType: 'fixed', connectedEntity: 'entity-2' };

      const result = handlePhysicsEvent('JOINT_CHANGED', payload, mockSetGet.set, mockSetGet.get);

      expect(result).toBe(true);
      expect(mockActions.setPrimaryJoint).toHaveBeenCalledWith(payload);
    });

    it('should handle null joint data', () => {
      handlePhysicsEvent('JOINT_CHANGED', null as unknown as Record<string, unknown>, mockSetGet.set, mockSetGet.get);

      expect(mockActions.setPrimaryJoint).toHaveBeenCalledWith(null);
    });
  });

  describe('DEBUG_PHYSICS_CHANGED', () => {
    it('should call setDebugPhysics with enabled flag', () => {
      const payload = { enabled: true };

      const result = handlePhysicsEvent('DEBUG_PHYSICS_CHANGED', payload, mockSetGet.set, mockSetGet.get);

      expect(result).toBe(true);
      expect(mockActions.setDebugPhysics).toHaveBeenCalledWith(true);
    });

    it('should handle disabled state', () => {
      handlePhysicsEvent('DEBUG_PHYSICS_CHANGED', { enabled: false }, mockSetGet.set, mockSetGet.get);

      expect(mockActions.setDebugPhysics).toHaveBeenCalledWith(false);
    });
  });

  describe('PHYSICS2D_UPDATED', () => {
    it('should call setPhysics2d with entityId, data, and enabled', () => {
      const payload = {
        entityId: 'sprite-1',
        enabled: true,
        bodyType: 'dynamic',
        mass: 1.0,
        gravityScale: 1.0,
      };

      const result = handlePhysicsEvent('PHYSICS2D_UPDATED', payload, mockSetGet.set, mockSetGet.get);

      expect(result).toBe(true);
      expect(mockActions.setPhysics2d).toHaveBeenCalledWith(
        'sprite-1',
        { bodyType: 'dynamic', mass: 1.0, gravityScale: 1.0 },
        true
      );
    });
  });

  describe('JOINT2D_UPDATED', () => {
    it('should call setJoint2d with entityId and joint data', () => {
      const payload = {
        entityId: 'entity-1',
        jointType: 'revolute',
        targetEntityId: 42,
      };

      const result = handlePhysicsEvent('JOINT2D_UPDATED', payload, mockSetGet.set, mockSetGet.get);

      expect(result).toBe(true);
      expect(mockActions.setJoint2d).toHaveBeenCalledWith(
        'entity-1',
        { jointType: 'revolute', targetEntityId: 42 }
      );
    });
  });

  describe('PHYSICS2D_REMOVED', () => {
    it('should call removePhysics2d with entityId', () => {
      const payload = { entityId: 'sprite-1' };

      const result = handlePhysicsEvent('PHYSICS2D_REMOVED', payload, mockSetGet.set, mockSetGet.get);

      expect(result).toBe(true);
      expect(mockActions.removePhysics2d).toHaveBeenCalledWith('sprite-1');
    });
  });

  describe('COLLISION_EVENT', () => {
    it('should invoke collision callback with payload', () => {
      const mockCallback = vi.fn();
      vi.mocked(getScriptCollisionCallback).mockReturnValue(mockCallback);

      const payload = { entityA: 'player', entityB: 'enemy', started: true };

      const result = handlePhysicsEvent('COLLISION_EVENT', payload, mockSetGet.set, mockSetGet.get);

      expect(result).toBe(true);
      expect(mockCallback).toHaveBeenCalledWith({
        entityA: 'player',
        entityB: 'enemy',
        started: true,
      });
    });

    it('should handle collision exit (started=false)', () => {
      const mockCallback = vi.fn();
      vi.mocked(getScriptCollisionCallback).mockReturnValue(mockCallback);

      const payload = { entityA: 'player', entityB: 'wall', started: false };
      handlePhysicsEvent('COLLISION_EVENT', payload, mockSetGet.set, mockSetGet.get);

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({ started: false })
      );
    });

    it('should gracefully handle null callback', () => {
      vi.mocked(getScriptCollisionCallback).mockReturnValue(null);

      const payload = { entityA: 'a', entityB: 'b', started: true };
      const result = handlePhysicsEvent('COLLISION_EVENT', payload, mockSetGet.set, mockSetGet.get);

      // Should still return true (event was handled), just no callback invoked
      expect(result).toBe(true);
    });
  });

  describe('RAYCAST_RESULT', () => {
    it('should invoke window raycast callback with result', () => {
      const mockCallback = vi.fn();
      vi.stubGlobal('window', { __scriptRaycastCallback: mockCallback });

      const payload = {
        requestId: 'ray-001',
        hitEntity: 'wall-entity',
        point: [5.0, 1.0, 3.0] as [number, number, number],
        distance: 7.5,
      };

      const result = handlePhysicsEvent('RAYCAST_RESULT', payload, mockSetGet.set, mockSetGet.get);

      expect(result).toBe(true);
      expect(mockCallback).toHaveBeenCalledWith({
        requestId: 'ray-001',
        hitEntity: 'wall-entity',
        point: [5.0, 1.0, 3.0],
        distance: 7.5,
      });

      vi.unstubAllGlobals();
    });

    it('should handle raycast miss (hitEntity=null)', () => {
      const mockCallback = vi.fn();
      vi.stubGlobal('window', { __scriptRaycastCallback: mockCallback });

      const payload = {
        requestId: 'ray-002',
        hitEntity: null,
        point: [0, 0, 0],
        distance: 0,
      };
      handlePhysicsEvent('RAYCAST_RESULT', payload, mockSetGet.set, mockSetGet.get);

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({ hitEntity: null })
      );

      vi.unstubAllGlobals();
    });

    it('should gracefully handle missing raycast callback', () => {
      vi.stubGlobal('window', {});

      const payload = { requestId: 'ray-003', hitEntity: null, point: [0, 0, 0], distance: 0 };
      const result = handlePhysicsEvent('RAYCAST_RESULT', payload, mockSetGet.set, mockSetGet.get);

      expect(result).toBe(true);
      // No error thrown

      vi.unstubAllGlobals();
    });
  });

  describe('RAYCAST2D_RESULT', () => {
    it('should return true (placeholder handled)', () => {
      const result = handlePhysicsEvent('RAYCAST2D_RESULT', {}, mockSetGet.set, mockSetGet.get);
      expect(result).toBe(true);
    });
  });
});
