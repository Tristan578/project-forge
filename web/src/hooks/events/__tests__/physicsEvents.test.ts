import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSetGet, createMockActions } from './eventTestUtils';

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

import { useEditorStore } from '@/stores/editorStore';
import { getScriptCollisionCallback } from '@/lib/scripting/useScriptRunner';
import { handlePhysicsEvent } from '../physicsEvents';

describe('handlePhysicsEvent', () => {
  let actions: ReturnType<typeof createMockActions>;
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    actions = createMockActions();
    mockSetGet = createMockSetGet();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore.getState).mockReturnValue(actions as any);
    vi.mocked(getScriptCollisionCallback).mockReturnValue(null);
  });

  it('returns false for unknown event types', () => {
    expect(handlePhysicsEvent('UNKNOWN', {}, mockSetGet.set, mockSetGet.get)).toBe(false);
  });

  it('PHYSICS_CHANGED: calls setPrimaryPhysics', () => {
    const payload = { entityId: 'ent-1', enabled: true, bodyType: 'dynamic', mass: 10 };
    const result = handlePhysicsEvent('PHYSICS_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setPrimaryPhysics).toHaveBeenCalledWith(
      { bodyType: 'dynamic', mass: 10 },
      true
    );
  });

  it('JOINT_CHANGED: calls setPrimaryJoint', () => {
    const jointData = { type: 'revolute', connectedEntity: 'ent-2' };
    const result = handlePhysicsEvent('JOINT_CHANGED', jointData as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setPrimaryJoint).toHaveBeenCalledWith(jointData);
  });

  it('JOINT_CHANGED with null: calls setPrimaryJoint(null)', () => {
    handlePhysicsEvent('JOINT_CHANGED', null as never, mockSetGet.set, mockSetGet.get);
    expect(actions.setPrimaryJoint).toHaveBeenCalledWith(null);
  });

  it('DEBUG_PHYSICS_CHANGED: calls setDebugPhysics', () => {
    const payload = { enabled: true };
    const result = handlePhysicsEvent('DEBUG_PHYSICS_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setDebugPhysics).toHaveBeenCalledWith(true);
  });

  it('PHYSICS2D_UPDATED: calls setPhysics2d', () => {
    const payload = { entityId: 'ent-1', enabled: true, bodyType: 'kinematic', friction: 0.5 };
    const result = handlePhysicsEvent('PHYSICS2D_UPDATED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setPhysics2d).toHaveBeenCalledWith('ent-1', { bodyType: 'kinematic', friction: 0.5 }, true);
  });

  it('JOINT2D_UPDATED: calls setJoint2d', () => {
    const payload = { entityId: 'ent-1', jointType: 'distance', target: 'ent-2' };
    const result = handlePhysicsEvent('JOINT2D_UPDATED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setJoint2d).toHaveBeenCalledWith('ent-1', { jointType: 'distance', target: 'ent-2' });
  });

  it('PHYSICS2D_REMOVED: calls removePhysics2d', () => {
    const payload = { entityId: 'ent-1' };
    const result = handlePhysicsEvent('PHYSICS2D_REMOVED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.removePhysics2d).toHaveBeenCalledWith('ent-1');
  });

  it('COLLISION_EVENT: invokes script collision callback', () => {
    const mockCb = vi.fn();
    vi.mocked(getScriptCollisionCallback).mockReturnValue(mockCb);

    const payload = { entityA: 'a', entityB: 'b', started: true };
    const result = handlePhysicsEvent('COLLISION_EVENT', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(mockCb).toHaveBeenCalledWith(payload);
  });

  it('COLLISION_EVENT: no-op without callback', () => {
    vi.mocked(getScriptCollisionCallback).mockReturnValue(null);
    const payload = { entityA: 'a', entityB: 'b', started: false };
    const result = handlePhysicsEvent('COLLISION_EVENT', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    // No error thrown
  });

  it('RAYCAST_RESULT: invokes window callback', () => {
    const mockCb = vi.fn();
    // Provide a minimal window mock with the raycast callback
    vi.stubGlobal('window', { __scriptRaycastCallback: mockCb });

    const payload = { requestId: 'r1', hitEntity: 'ent-1', point: [1, 2, 3], distance: 5 };
    const result = handlePhysicsEvent('RAYCAST_RESULT', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(mockCb).toHaveBeenCalledWith(payload);

    vi.unstubAllGlobals();
  });

  it('RAYCAST2D_RESULT: returns true (placeholder)', () => {
    const result = handlePhysicsEvent('RAYCAST2D_RESULT', {}, mockSetGet.set, mockSetGet.get);
    expect(result).toBe(true);
  });
});
