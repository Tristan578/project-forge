/**
 * Unit tests for hooks/events/particleEvents.ts
 *
 * Verifies that handleParticleEvent correctly dispatches PARTICLE_CHANGED
 * to the store's setEntityParticle action, and rejects unknown events.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSetGet, createMockActions, type StoreState } from './eventTestUtils';

// ---------------------------------------------------------------------------
// Mock the editor store — particleEvents uses useEditorStore.getState()
// ---------------------------------------------------------------------------
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

import { useEditorStore } from '@/stores/editorStore';
import { handleParticleEvent } from '../particleEvents';

describe('handleParticleEvent', () => {
  let actions: ReturnType<typeof createMockActions>;
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    vi.clearAllMocks();
    actions = createMockActions();
    mockSetGet = createMockSetGet();
    vi.mocked(useEditorStore.getState).mockReturnValue(
      actions as unknown as StoreState,
    );
  });

  // -------------------------------------------------------------------------
  // Unknown / unhandled events
  // -------------------------------------------------------------------------

  it('returns false for unknown event types', () => {
    const result = handleParticleEvent(
      'UNKNOWN_EVENT',
      {},
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(result).toBe(false);
  });

  it('returns false for empty string event type', () => {
    const result = handleParticleEvent('', {}, mockSetGet.set, mockSetGet.get);
    expect(result).toBe(false);
  });

  it('does not call setEntityParticle for unknown events', () => {
    handleParticleEvent('PHYSICS_CHANGED', {}, mockSetGet.set, mockSetGet.get);
    expect(actions.setEntityParticle).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // PARTICLE_CHANGED
  // -------------------------------------------------------------------------

  it('PARTICLE_CHANGED: returns true', () => {
    const result = handleParticleEvent(
      'PARTICLE_CHANGED',
      { entityId: 'ent-1', enabled: true, particle: null },
      mockSetGet.set,
      mockSetGet.get,
    );
    expect(result).toBe(true);
  });

  it('PARTICLE_CHANGED: calls setEntityParticle with entityId, particle, and enabled', () => {
    const particleData = {
      preset: 'fire',
      rate: 100,
      lifetime: 2.0,
    };

    handleParticleEvent(
      'PARTICLE_CHANGED',
      { entityId: 'ent-particle', enabled: true, particle: particleData },
      mockSetGet.set,
      mockSetGet.get,
    );

    expect(actions.setEntityParticle).toHaveBeenCalledWith(
      'ent-particle',
      particleData,
      true,
    );
  });

  it('PARTICLE_CHANGED: passes enabled=false correctly', () => {
    const particleData = { preset: 'smoke', rate: 20, lifetime: 3.0 };

    handleParticleEvent(
      'PARTICLE_CHANGED',
      { entityId: 'ent-2', enabled: false, particle: particleData },
      mockSetGet.set,
      mockSetGet.get,
    );

    expect(actions.setEntityParticle).toHaveBeenCalledWith(
      'ent-2',
      particleData,
      false,
    );
  });

  it('PARTICLE_CHANGED: passes null particle data correctly', () => {
    handleParticleEvent(
      'PARTICLE_CHANGED',
      { entityId: 'ent-3', enabled: false, particle: null },
      mockSetGet.set,
      mockSetGet.get,
    );

    expect(actions.setEntityParticle).toHaveBeenCalledWith('ent-3', null, false);
  });

  it('PARTICLE_CHANGED: calls setEntityParticle exactly once', () => {
    handleParticleEvent(
      'PARTICLE_CHANGED',
      { entityId: 'ent-1', enabled: true, particle: null },
      mockSetGet.set,
      mockSetGet.get,
    );

    expect(actions.setEntityParticle).toHaveBeenCalledTimes(1);
  });

  it('PARTICLE_CHANGED: does not call set (the set param is not used)', () => {
    handleParticleEvent(
      'PARTICLE_CHANGED',
      { entityId: 'ent-1', enabled: true, particle: null },
      mockSetGet.set,
      mockSetGet.get,
    );

    // particleEvents bypasses the set/get params and calls the store directly
    expect(mockSetGet.set).not.toHaveBeenCalled();
  });

  it('PARTICLE_CHANGED: uses entity ID from payload', () => {
    handleParticleEvent(
      'PARTICLE_CHANGED',
      { entityId: 'specific-entity-id', enabled: true, particle: null },
      mockSetGet.set,
      mockSetGet.get,
    );

    const call = vi.mocked(actions.setEntityParticle).mock.calls[0];
    expect(call[0]).toBe('specific-entity-id');
  });

  it('PARTICLE_CHANGED: handles complex particle data with all fields', () => {
    const fullParticleData = {
      preset: 'sparks',
      rate: 500,
      lifetime: 1.5,
      startSize: 0.1,
      endSize: 0.01,
      startColor: [1, 0.5, 0, 1],
      endColor: [1, 0, 0, 0],
      gravity: -9.8,
      speed: 3.0,
    };

    handleParticleEvent(
      'PARTICLE_CHANGED',
      { entityId: 'sparks-entity', enabled: true, particle: fullParticleData },
      mockSetGet.set,
      mockSetGet.get,
    );

    expect(actions.setEntityParticle).toHaveBeenCalledWith(
      'sparks-entity',
      fullParticleData,
      true,
    );
  });
});
