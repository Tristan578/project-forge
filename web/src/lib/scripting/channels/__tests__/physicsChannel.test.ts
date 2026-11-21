/**
 * Unit tests for the physics channel handler (physicsChannel.ts).
 *
 * Tests cover: raycast, raycast2d, isGrounded, overlapSphere, unknown method,
 * null/undefined return handling, and argument forwarding.
 */

import { describe, it, expect, vi } from 'vitest';
import { createPhysicsHandler } from '../physicsChannel';

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

const noProgress = vi.fn();

describe('createPhysicsHandler', () => {
  describe('raycast', () => {
    it('dispatches raycast_query with origin/direction/maxDistance', async () => {
      const dispatchCommand = vi.fn(() => ({ entityId: 'e1', distance: 5 }));
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'raycast',
        { origin: [0, 1, 0], direction: [0, -1, 0], maxDistance: 20 },
        noProgress,
        makeSignal(),
      );

      expect(dispatchCommand).toHaveBeenCalledWith('raycast_query', {
        origin: [0, 1, 0],
        direction: [0, -1, 0],
        maxDistance: 20,
      });
      expect(result).toEqual({ entityId: 'e1', distance: 5 });
    });

    it('uses default maxDistance of 100 when not provided', async () => {
      const dispatchCommand = vi.fn(() => null);
      const handler = createPhysicsHandler({ dispatchCommand });

      await handler('raycast', { origin: [0, 0, 0], direction: [1, 0, 0] }, noProgress, makeSignal());

      expect(dispatchCommand).toHaveBeenCalledWith(
        'raycast_query',
        expect.objectContaining({ maxDistance: 100 }),
      );
    });

    it('returns null when dispatchCommand returns null', async () => {
      const dispatchCommand = vi.fn(() => null);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'raycast',
        { origin: [0, 0, 0], direction: [0, 1, 0] },
        noProgress,
        makeSignal(),
      );

      expect(result).toBeNull();
    });

    it('returns null when dispatchCommand returns undefined', async () => {
      const dispatchCommand = vi.fn(() => undefined);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'raycast',
        { origin: [0, 0, 0], direction: [0, 1, 0] },
        noProgress,
        makeSignal(),
      );

      expect(result).toBeNull();
    });
  });

  describe('raycast2d', () => {
    it('dispatches raycast2d_query with all 2D args', async () => {
      const dispatchCommand = vi.fn(() => ({ entityId: 'e2', distance: 2 }));
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'raycast2d',
        { originX: 1, originY: 2, dirX: 0, dirY: -1, maxDistance: 5 },
        noProgress,
        makeSignal(),
      );

      expect(dispatchCommand).toHaveBeenCalledWith('raycast2d_query', {
        originX: 1,
        originY: 2,
        dirX: 0,
        dirY: -1,
        maxDistance: 5,
      });
      expect(result).toEqual({ entityId: 'e2', distance: 2 });
    });

    it('uses default maxDistance of 100 for raycast2d', async () => {
      const dispatchCommand = vi.fn(() => null);
      const handler = createPhysicsHandler({ dispatchCommand });

      await handler(
        'raycast2d',
        { originX: 0, originY: 0, dirX: 1, dirY: 0 },
        noProgress,
        makeSignal(),
      );

      expect(dispatchCommand).toHaveBeenCalledWith(
        'raycast2d_query',
        expect.objectContaining({ maxDistance: 100 }),
      );
    });

    it('returns null when no hit detected', async () => {
      const dispatchCommand = vi.fn(() => undefined);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'raycast2d',
        { originX: 0, originY: 0, dirX: 0, dirY: -1 },
        noProgress,
        makeSignal(),
      );

      expect(result).toBeNull();
    });
  });

  describe('isGrounded', () => {
    it('dispatches raycast2d_query downward to check grounding', async () => {
      const dispatchCommand = vi.fn(() => ({ entityId: 'ground', distance: 0.05 }));
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'isGrounded',
        { entityId: 'player', distance: 0.15 },
        noProgress,
        makeSignal(),
      );

      expect(dispatchCommand).toHaveBeenCalledWith('raycast2d_query', {
        entityId: 'player',
        originX: 0,
        originY: 0,
        dirX: 0,
        dirY: -1,
        maxDistance: 0.15,
        fromEntity: true,
      });
      expect(result).toBe(true);
    });

    it('returns false when raycast hits nothing', async () => {
      const dispatchCommand = vi.fn(() => null);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'isGrounded',
        { entityId: 'player' },
        noProgress,
        makeSignal(),
      );

      expect(result).toBe(false);
    });

    it('uses default distance of 0.1 when not provided', async () => {
      const dispatchCommand = vi.fn(() => null);
      const handler = createPhysicsHandler({ dispatchCommand });

      await handler('isGrounded', { entityId: 'e1' }, noProgress, makeSignal());

      expect(dispatchCommand).toHaveBeenCalledWith(
        'raycast2d_query',
        expect.objectContaining({ maxDistance: 0.1 }),
      );
    });

    it('returns true when any hit result is returned', async () => {
      const dispatchCommand = vi.fn(() => 0); // falsy number but not null/undefined
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'isGrounded',
        { entityId: 'e1' },
        noProgress,
        makeSignal(),
      );

      // 0 != null so result should be true
      expect(result).toBe(true);
    });
  });

  describe('overlapSphere', () => {
    it('dispatches overlap_sphere_query with center and radius', async () => {
      const dispatchCommand = vi.fn(() => ['e1', 'e2', 'e3']);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'overlapSphere',
        { center: [0, 1, 0], radius: 2.5 },
        noProgress,
        makeSignal(),
      );

      expect(dispatchCommand).toHaveBeenCalledWith('overlap_sphere_query', {
        center: [0, 1, 0],
        radius: 2.5,
      });
      expect(result).toEqual(['e1', 'e2', 'e3']);
    });

    it('uses default radius of 1.0 when not provided', async () => {
      const dispatchCommand = vi.fn(() => []);
      const handler = createPhysicsHandler({ dispatchCommand });

      await handler('overlapSphere', { center: [0, 0, 0] }, noProgress, makeSignal());

      expect(dispatchCommand).toHaveBeenCalledWith(
        'overlap_sphere_query',
        expect.objectContaining({ radius: 1.0 }),
      );
    });

    it('returns empty array when no entities overlap', async () => {
      const dispatchCommand = vi.fn(() => null);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'overlapSphere',
        { center: [0, 0, 0] },
        noProgress,
        makeSignal(),
      );

      expect(result).toEqual([]);
    });

    it('returns empty array when dispatchCommand returns undefined', async () => {
      const dispatchCommand = vi.fn(() => undefined);
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler(
        'overlapSphere',
        { center: [0, 0, 0] },
        noProgress,
        makeSignal(),
      );

      expect(result).toEqual([]);
    });
  });

  describe('unknown method', () => {
    it('throws for unknown physics method', async () => {
      const dispatchCommand = vi.fn();
      const handler = createPhysicsHandler({ dispatchCommand });

      await expect(
        handler('teleport', {}, noProgress, makeSignal()),
      ).rejects.toThrow('Unknown physics method: teleport');
    });

    it('does not call dispatchCommand for unknown methods', async () => {
      const dispatchCommand = vi.fn();
      const handler = createPhysicsHandler({ dispatchCommand });

      await handler('badMethod', {}, noProgress, makeSignal()).catch(() => {});

      expect(dispatchCommand).not.toHaveBeenCalled();
    });
  });
});
