// @vitest-environment jsdom
/**
 * Edge case and supplementary tests for physicsEvents handler.
 *
 * Covers: collision event edge cases, raycast result edge cases,
 * rapid event sequences, idempotent state transitions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockSetGet, createMockActions, type StoreState } from './eventTestUtils';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

vi.mock('@/lib/scripting/useScriptRunner', () => ({
  getScriptCollisionCallback: vi.fn(),
}));

vi.mock('@/lib/audio/audioManager', () => ({
  audioManager: {
    updateOcclusionAmount: vi.fn(),
  },
}));

import { useEditorStore } from '@/stores/editorStore';
import { getScriptCollisionCallback } from '@/lib/scripting/useScriptRunner';
import { audioManager } from '@/lib/audio/audioManager';
import { handlePhysicsEvent } from '../physicsEvents';

describe('handlePhysicsEvent — edge cases', () => {
  let actions: ReturnType<typeof createMockActions>;
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    vi.clearAllMocks();
    actions = createMockActions();
    mockSetGet = createMockSetGet();
    vi.mocked(useEditorStore.getState).mockReturnValue(actions as unknown as StoreState);
  });

  afterEach(() => {
    // Clean up any window callbacks left by tests
    delete (window as unknown as Record<string, unknown>).__scriptRaycastCallback;
  });

  // =========================================================================
  // COLLISION_EVENT — edge cases
  // =========================================================================

  describe('COLLISION_EVENT — edge cases', () => {
    it('passes entityA and entityB exactly as received', () => {
      const mockCallback = vi.fn();
      vi.mocked(getScriptCollisionCallback).mockReturnValue(mockCallback);

      const payload = { entityA: 'player-001', entityB: 'enemy-002', started: true };
      handlePhysicsEvent('COLLISION_EVENT', payload, mockSetGet.set, mockSetGet.get);

      expect(mockCallback).toHaveBeenCalledWith(
        expect.objectContaining({ entityA: 'player-001', entityB: 'enemy-002' })
      );
    });

    it('does not mutate the payload before passing to callback', () => {
      const mockCallback = vi.fn();
      vi.mocked(getScriptCollisionCallback).mockReturnValue(mockCallback);

      const payload = { entityA: 'a', entityB: 'b', started: false };
      handlePhysicsEvent('COLLISION_EVENT', payload, mockSetGet.set, mockSetGet.get);

      const received = mockCallback.mock.calls[0][0];
      expect(received).toBe(payload);
    });

    it('handles self-collision (same entity on both sides)', () => {
      const mockCallback = vi.fn();
      vi.mocked(getScriptCollisionCallback).mockReturnValue(mockCallback);

      const payload = { entityA: 'entity-x', entityB: 'entity-x', started: true };
      const result = handlePhysicsEvent('COLLISION_EVENT', payload, mockSetGet.set, mockSetGet.get);

      expect(result).toBe(true);
      expect(mockCallback).toHaveBeenCalledWith(payload);
    });

    it('handles rapid sequential collision events without interference', () => {
      const mockCallback = vi.fn();
      vi.mocked(getScriptCollisionCallback).mockReturnValue(mockCallback);

      const events = [
        { entityA: 'a', entityB: 'b', started: true },
        { entityA: 'a', entityB: 'b', started: false },
        { entityA: 'a', entityB: 'c', started: true },
        { entityA: 'd', entityB: 'e', started: true },
      ];

      for (const payload of events) {
        handlePhysicsEvent('COLLISION_EVENT', payload, mockSetGet.set, mockSetGet.get);
      }

      expect(mockCallback).toHaveBeenCalledTimes(4);
      expect(mockCallback.mock.calls[0][0]).toEqual({ entityA: 'a', entityB: 'b', started: true });
      expect(mockCallback.mock.calls[1][0]).toEqual({ entityA: 'a', entityB: 'b', started: false });
      expect(mockCallback.mock.calls[2][0]).toEqual({ entityA: 'a', entityB: 'c', started: true });
      expect(mockCallback.mock.calls[3][0]).toEqual({ entityA: 'd', entityB: 'e', started: true });
    });

    it('does NOT update store for collision events (store is script-only)', () => {
      const mockCallback = vi.fn();
      vi.mocked(getScriptCollisionCallback).mockReturnValue(mockCallback);

      handlePhysicsEvent(
        'COLLISION_EVENT',
        { entityA: 'a', entityB: 'b', started: true },
        mockSetGet.set,
        mockSetGet.get
      );

      // Store should not be called for collision events — they go to scripts only
      expect(mockSetGet.set).not.toHaveBeenCalled();
    });

    it('returns true even when callback is undefined (not null)', () => {
      vi.mocked(getScriptCollisionCallback).mockReturnValue(undefined as unknown as ReturnType<typeof getScriptCollisionCallback>);

      const result = handlePhysicsEvent(
        'COLLISION_EVENT',
        { entityA: 'a', entityB: 'b', started: true },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
    });

    it('handles collision end event (started=false) with callback', () => {
      const mockCallback = vi.fn();
      vi.mocked(getScriptCollisionCallback).mockReturnValue(mockCallback);

      const payload = { entityA: 'wall', entityB: 'ball', started: false };
      handlePhysicsEvent('COLLISION_EVENT', payload, mockSetGet.set, mockSetGet.get);

      expect(mockCallback.mock.calls[0][0].started).toBe(false);
    });

    it('fetches callback fresh on each event (allows dynamic callback swapping)', () => {
      const firstCallback = vi.fn();
      const secondCallback = vi.fn();

      vi.mocked(getScriptCollisionCallback)
        .mockReturnValueOnce(firstCallback)
        .mockReturnValueOnce(secondCallback);

      handlePhysicsEvent('COLLISION_EVENT', { entityA: 'a', entityB: 'b', started: true }, mockSetGet.set, mockSetGet.get);
      handlePhysicsEvent('COLLISION_EVENT', { entityA: 'a', entityB: 'b', started: false }, mockSetGet.set, mockSetGet.get);

      expect(firstCallback).toHaveBeenCalledTimes(1);
      expect(secondCallback).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // RAYCAST_RESULT — edge cases
  // =========================================================================

  describe('RAYCAST_RESULT — edge cases', () => {
    it('does not call audioManager for non-occlusion requestId', () => {
      (window as unknown as Record<string, unknown>).__scriptRaycastCallback = vi.fn();

      handlePhysicsEvent(
        'RAYCAST_RESULT',
        { requestId: 'gameplay-ray-1', hitEntity: 'enemy', point: [1, 2, 3], distance: 5.0 },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(audioManager.updateOcclusionAmount).not.toHaveBeenCalled();
    });

    it('does not call script callback for occlusion requestId', () => {
      const mockRaycastCb = vi.fn();
      (window as unknown as Record<string, unknown>).__scriptRaycastCallback = mockRaycastCb;

      handlePhysicsEvent(
        'RAYCAST_RESULT',
        { requestId: 'audio_occlusion:some-entity:10', hitEntity: 'wall', point: [0, 0, 0], distance: 1.0 },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(mockRaycastCb).not.toHaveBeenCalled();
    });

    it('extracts entityId and computes graduated amount from occlusion prefix', () => {
      // totalDistance=10, hitDistance=3 → amount = 1 - 3/10 = 0.7
      handlePhysicsEvent(
        'RAYCAST_RESULT',
        { requestId: 'audio_occlusion:sound-source-42:10', hitEntity: 'obstacle', point: [0, 0, 0], distance: 3.0 },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(audioManager.updateOcclusionAmount).toHaveBeenCalledWith('sound-source-42', 0.7);
    });

    it('returns amount 0 when hitEntity is null (open air)', () => {
      handlePhysicsEvent(
        'RAYCAST_RESULT',
        { requestId: 'audio_occlusion:speaker-1:5', hitEntity: null, point: [0, 0, 0], distance: 0 },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(audioManager.updateOcclusionAmount).toHaveBeenCalledWith('speaker-1', 0);
    });

    it('returns amount 0 when hitEntity matches the audio source entity', () => {
      handlePhysicsEvent(
        'RAYCAST_RESULT',
        { requestId: 'audio_occlusion:audio-entity-7:5', hitEntity: 'audio-entity-7', point: [0, 0, 0], distance: 0.1 },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(audioManager.updateOcclusionAmount).toHaveBeenCalledWith('audio-entity-7', 0);
    });

    it('computes graduated amount when hitEntity is a different entity', () => {
      // totalDistance=10, hitDistance=7.07 → amount = 1 - 7.07/10 = 0.293
      handlePhysicsEvent(
        'RAYCAST_RESULT',
        { requestId: 'audio_occlusion:ambient-sound:10', hitEntity: 'concrete-wall', point: [5, 0, 5], distance: 7.07 },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(audioManager.updateOcclusionAmount).toHaveBeenCalledWith('ambient-sound', expect.closeTo(0.293, 2));
    });

    it('passes full payload to script callback for script raycast', () => {
      const mockRaycastCb = vi.fn();
      (window as unknown as Record<string, unknown>).__scriptRaycastCallback = mockRaycastCb;

      const payload = { requestId: 'script-ray-99', hitEntity: 'floor', point: [10, 0, -5], distance: 12.3 };
      handlePhysicsEvent('RAYCAST_RESULT', payload, mockSetGet.set, mockSetGet.get);

      expect(mockRaycastCb).toHaveBeenCalledWith(payload);
    });

    it('handles raycast miss (hitEntity=null) forwarded to script callback', () => {
      const mockRaycastCb = vi.fn();
      (window as unknown as Record<string, unknown>).__scriptRaycastCallback = mockRaycastCb;

      const payload = { requestId: 'miss-ray', hitEntity: null, point: [0, 0, 0], distance: 0 };
      handlePhysicsEvent('RAYCAST_RESULT', payload, mockSetGet.set, mockSetGet.get);

      expect(mockRaycastCb).toHaveBeenCalledWith(payload);
      expect(mockRaycastCb.mock.calls[0][0].hitEntity).toBeNull();
    });

    it('handles multiple concurrent raycast requests independently', () => {
      const mockRaycastCb = vi.fn();
      (window as unknown as Record<string, unknown>).__scriptRaycastCallback = mockRaycastCb;

      const ray1 = { requestId: 'ray-a', hitEntity: 'ground', point: [0, -1, 0], distance: 1.0 };
      // totalDistance=10, hitDistance=4.24 → amount = 1 - 4.24/10 = 0.576
      const ray2 = { requestId: 'audio_occlusion:ent-1:10', hitEntity: 'wall', point: [3, 0, 3], distance: 4.24 };
      const ray3 = { requestId: 'ray-b', hitEntity: null, point: [0, 0, 0], distance: 0 };

      handlePhysicsEvent('RAYCAST_RESULT', ray1, mockSetGet.set, mockSetGet.get);
      handlePhysicsEvent('RAYCAST_RESULT', ray2, mockSetGet.set, mockSetGet.get);
      handlePhysicsEvent('RAYCAST_RESULT', ray3, mockSetGet.set, mockSetGet.get);

      // Script callback called for ray-a and ray-b only (not occlusion)
      expect(mockRaycastCb).toHaveBeenCalledTimes(2);
      expect(mockRaycastCb.mock.calls[0][0]).toEqual(ray1);
      expect(mockRaycastCb.mock.calls[1][0]).toEqual(ray3);

      // Occlusion updated only for the occlusion ray with graduated amount
      expect(audioManager.updateOcclusionAmount).toHaveBeenCalledTimes(1);
      expect(audioManager.updateOcclusionAmount).toHaveBeenCalledWith('ent-1', expect.closeTo(0.576, 2));
    });

    it('returns true for RAYCAST_RESULT even without script callback', () => {
      delete (window as unknown as Record<string, unknown>).__scriptRaycastCallback;

      const result = handlePhysicsEvent(
        'RAYCAST_RESULT',
        { requestId: 'orphan-ray', hitEntity: 'something', point: [1, 1, 1], distance: 1.73 },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
    });

    it('handles zero-length requestId after occlusion prefix gracefully', () => {
      // Edge case: 'audio_occlusion:' with empty entity id and no totalDistance
      handlePhysicsEvent(
        'RAYCAST_RESULT',
        { requestId: 'audio_occlusion:', hitEntity: 'something', point: [0, 0, 0], distance: 1.0 },
        mockSetGet.set,
        mockSetGet.get
      );

      // totalDistance=0 so amount stays 0 even though hitEntity differs
      expect(audioManager.updateOcclusionAmount).toHaveBeenCalledWith('', 0);
    });
  });

  // =========================================================================
  // RAYCAST2D_RESULT — edge cases
  // =========================================================================

  describe('RAYCAST2D_RESULT — edge cases', () => {
    it('always returns true regardless of payload', () => {
      const payloads = [
        {},
        { requestId: 'r1', hitEntity: null, point: [0, 0], distance: 0 },
        { requestId: 'r2', hitEntity: 'sprite-5', point: [10, 20], distance: 22.4 },
      ];

      for (const payload of payloads) {
        const result = handlePhysicsEvent('RAYCAST2D_RESULT', payload, mockSetGet.set, mockSetGet.get);
        expect(result).toBe(true);
      }
    });

    it('does not call any store action for RAYCAST2D_RESULT', () => {
      handlePhysicsEvent(
        'RAYCAST2D_RESULT',
        { requestId: 'r2d', hitEntity: 'tile-42', point: [5, 3], distance: 5.83 },
        mockSetGet.set,
        mockSetGet.get
      );

      expect(mockSetGet.set).not.toHaveBeenCalled();
      expect(actions.setPrimaryPhysics).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // PHYSICS_CHANGED — additional edge cases
  // =========================================================================

  describe('PHYSICS_CHANGED — additional edge cases', () => {
    it('handles minimal payload (only entityId and enabled)', () => {
      const payload = { entityId: 'ent-min', enabled: true };

      const result = handlePhysicsEvent('PHYSICS_CHANGED', payload, mockSetGet.set, mockSetGet.get);

      expect(result).toBe(true);
      const [data, enabled] = actions.setPrimaryPhysics.mock.calls[0];
      expect(enabled).toBe(true);
      expect(data).not.toHaveProperty('entityId');
      expect(data).not.toHaveProperty('enabled');
    });

    it('preserves all physics properties (full PhysicsData shape)', () => {
      const payload = {
        entityId: 'ent-full',
        enabled: true,
        bodyType: 'kinematic_velocity',
        colliderShape: 'capsule',
        restitution: 0.8,
        friction: 0.2,
        density: 3.0,
        gravityScale: 0.5,
        lockTranslationX: true,
        lockTranslationY: false,
        lockTranslationZ: true,
        lockRotationX: false,
        lockRotationY: true,
        lockRotationZ: false,
        isSensor: true,
      };

      handlePhysicsEvent('PHYSICS_CHANGED', payload, mockSetGet.set, mockSetGet.get);

      const [data] = actions.setPrimaryPhysics.mock.calls[0];
      expect(data.bodyType).toBe('kinematic_velocity');
      expect(data.colliderShape).toBe('capsule');
      expect(data.restitution).toBe(0.8);
      expect(data.friction).toBe(0.2);
      expect(data.density).toBe(3.0);
      expect(data.gravityScale).toBe(0.5);
      expect(data.lockTranslationX).toBe(true);
      expect(data.lockRotationY).toBe(true);
      expect(data.isSensor).toBe(true);
    });

    it('handles sensor body type (isSensor=true)', () => {
      const payload = { entityId: 'trigger-zone', enabled: true, bodyType: 'fixed', isSensor: true };

      handlePhysicsEvent('PHYSICS_CHANGED', payload, mockSetGet.set, mockSetGet.get);

      const [data] = actions.setPrimaryPhysics.mock.calls[0];
      expect(data.isSensor).toBe(true);
    });
  });

  // =========================================================================
  // DEBUG_PHYSICS_CHANGED — toggle sequence
  // =========================================================================

  describe('DEBUG_PHYSICS_CHANGED — toggle sequence', () => {
    it('handles rapid enable/disable sequence', () => {
      handlePhysicsEvent('DEBUG_PHYSICS_CHANGED', { enabled: true }, mockSetGet.set, mockSetGet.get);
      handlePhysicsEvent('DEBUG_PHYSICS_CHANGED', { enabled: false }, mockSetGet.set, mockSetGet.get);
      handlePhysicsEvent('DEBUG_PHYSICS_CHANGED', { enabled: true }, mockSetGet.set, mockSetGet.get);

      expect(actions.setDebugPhysics).toHaveBeenCalledTimes(3);
      expect(actions.setDebugPhysics.mock.calls[0][0]).toBe(true);
      expect(actions.setDebugPhysics.mock.calls[1][0]).toBe(false);
      expect(actions.setDebugPhysics.mock.calls[2][0]).toBe(true);
    });
  });

  // =========================================================================
  // PHYSICS2D_REMOVED — edge cases
  // =========================================================================

  describe('PHYSICS2D_REMOVED — edge cases', () => {
    it('calls removePhysics2d for each entity independently', () => {
      handlePhysicsEvent('PHYSICS2D_REMOVED', { entityId: 'sprite-a' }, mockSetGet.set, mockSetGet.get);
      handlePhysicsEvent('PHYSICS2D_REMOVED', { entityId: 'sprite-b' }, mockSetGet.set, mockSetGet.get);

      expect(actions.removePhysics2d).toHaveBeenCalledTimes(2);
      expect(actions.removePhysics2d.mock.calls[0][0]).toBe('sprite-a');
      expect(actions.removePhysics2d.mock.calls[1][0]).toBe('sprite-b');
    });
  });

  // =========================================================================
  // Unknown event types
  // =========================================================================

  describe('unrecognised event types', () => {
    it('returns false for empty string event type', () => {
      const result = handlePhysicsEvent('', {}, mockSetGet.set, mockSetGet.get);
      expect(result).toBe(false);
    });

    it('returns false for physics-adjacent but incorrect event types', () => {
      const unknown = [
        'PHYSICS_UPDATED',
        'COLLISION_START',
        'COLLISION_END',
        'RAYCAST',
        'JOINT_UPDATED',
      ];
      for (const type of unknown) {
        const result = handlePhysicsEvent(type, {}, mockSetGet.set, mockSetGet.get);
        expect(result).toBe(false);
      }
    });

    it('does not call any store actions for unknown event types', () => {
      handlePhysicsEvent('COMPLETELY_UNKNOWN', { entityId: 'x' }, mockSetGet.set, mockSetGet.get);

      expect(actions.setPrimaryPhysics).not.toHaveBeenCalled();
      expect(actions.setDebugPhysics).not.toHaveBeenCalled();
      expect(actions.setPhysics2d).not.toHaveBeenCalled();
      expect(actions.setPrimaryJoint).not.toHaveBeenCalled();
    });
  });
});
