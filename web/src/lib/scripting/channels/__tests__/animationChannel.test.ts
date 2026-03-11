/**
 * Unit tests for the animation channel handler (animationChannel.ts).
 *
 * Tests cover: listClips, getClipDuration, unknown method,
 * null/undefined return handling, and argument forwarding.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAnimationHandler } from '../animationChannel';

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

const noProgress = vi.fn();

describe('createAnimationHandler', () => {
  describe('listClips', () => {
    it('dispatches list_animation_clips with entityId', async () => {
      const dispatchCommand = vi.fn(() => ['idle', 'run', 'jump']);
      const handler = createAnimationHandler({ dispatchCommand });

      const result = await handler(
        'listClips',
        { entityId: 'e-42' },
        noProgress,
        makeSignal(),
      );

      expect(dispatchCommand).toHaveBeenCalledWith('list_animation_clips', {
        entityId: 'e-42',
      });
      expect(result).toEqual(['idle', 'run', 'jump']);
    });

    it('returns empty array when dispatchCommand returns null', async () => {
      const dispatchCommand = vi.fn(() => null);
      const handler = createAnimationHandler({ dispatchCommand });

      const result = await handler('listClips', { entityId: 'e-1' }, noProgress, makeSignal());

      expect(result).toEqual([]);
    });

    it('returns empty array when dispatchCommand returns undefined', async () => {
      const dispatchCommand = vi.fn(() => undefined);
      const handler = createAnimationHandler({ dispatchCommand });

      const result = await handler('listClips', { entityId: 'e-2' }, noProgress, makeSignal());

      expect(result).toEqual([]);
    });

    it('returns actual array from dispatchCommand without wrapping', async () => {
      const clips = ['walk', 'attack', 'death'];
      const dispatchCommand = vi.fn(() => clips);
      const handler = createAnimationHandler({ dispatchCommand });

      const result = await handler('listClips', { entityId: 'e-3' }, noProgress, makeSignal());

      expect(result).toBe(clips);
    });
  });

  describe('getClipDuration', () => {
    it('dispatches get_clip_duration with entityId and clipName', async () => {
      const dispatchCommand = vi.fn(() => 1.5);
      const handler = createAnimationHandler({ dispatchCommand });

      const result = await handler(
        'getClipDuration',
        { entityId: 'e-10', clipName: 'run' },
        noProgress,
        makeSignal(),
      );

      expect(dispatchCommand).toHaveBeenCalledWith('get_clip_duration', {
        entityId: 'e-10',
        clipName: 'run',
      });
      expect(result).toBe(1.5);
    });

    it('returns 0 when dispatchCommand returns null', async () => {
      const dispatchCommand = vi.fn(() => null);
      const handler = createAnimationHandler({ dispatchCommand });

      const result = await handler(
        'getClipDuration',
        { entityId: 'e-11', clipName: 'idle' },
        noProgress,
        makeSignal(),
      );

      expect(result).toBe(0);
    });

    it('returns 0 when dispatchCommand returns undefined', async () => {
      const dispatchCommand = vi.fn(() => undefined);
      const handler = createAnimationHandler({ dispatchCommand });

      const result = await handler(
        'getClipDuration',
        { entityId: 'e-12', clipName: 'nonexistent' },
        noProgress,
        makeSignal(),
      );

      expect(result).toBe(0);
    });

    it('returns actual duration value', async () => {
      const dispatchCommand = vi.fn(() => 3.14159);
      const handler = createAnimationHandler({ dispatchCommand });

      const result = await handler(
        'getClipDuration',
        { entityId: 'e-20', clipName: 'attack' },
        noProgress,
        makeSignal(),
      );

      expect(result).toBe(3.14159);
    });
  });

  describe('unknown method', () => {
    it('throws for unknown animation method', async () => {
      const dispatchCommand = vi.fn();
      const handler = createAnimationHandler({ dispatchCommand });

      await expect(
        handler('playClip', {}, noProgress, makeSignal()),
      ).rejects.toThrow('Unknown animation method: playClip');
    });

    it('does not call dispatchCommand for unknown methods', async () => {
      const dispatchCommand = vi.fn();
      const handler = createAnimationHandler({ dispatchCommand });

      await handler('badMethod', {}, noProgress, makeSignal()).catch(() => {});

      expect(dispatchCommand).not.toHaveBeenCalled();
    });
  });
});
