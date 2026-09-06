import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPhysicsHandler } from '../channels/physicsChannel';
import { deliverRaycast2dAnswer, resetRaycast2dQueue } from '../raycast2dRegistry';
import { createAiHandler } from '../channels/aiChannel';
import { createAssetHandler } from '../channels/assetChannel';
import { createAudioHandler } from '../channels/audioChannel';
import { createAnimationHandler } from '../channels/animationChannel';

const noProgress = () => { /* no-op */ };
const neverAbort = new AbortController().signal;

describe('Channel Handlers', () => {
  // ─── Physics ──────────────────────────────────────────────────

  describe('physicsChannel', () => {
    beforeEach(() => {
      resetRaycast2dQueue();
    });

    it('dispatches raycast to WASM handle_command', async () => {
      const dispatchCommand = vi.fn().mockReturnValue({ hit: true, distance: 3.5 });
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler('raycast', {
        origin: [0, 1, 0],
        direction: [0, -1, 0],
        maxDistance: 50,
      }, noProgress, neverAbort);

      expect(dispatchCommand).toHaveBeenCalledWith('raycast_query', {
        origin: [0, 1, 0],
        direction: [0, -1, 0],
        maxDistance: 50,
      });
      expect(result).toEqual({ hit: true, distance: 3.5 });
    });

    it('defaults maxDistance to 100 for raycast', async () => {
      const dispatchCommand = vi.fn().mockReturnValue(null);
      const handler = createPhysicsHandler({ dispatchCommand });

      await handler('raycast', { origin: [0, 0, 0], direction: [1, 0, 0] }, noProgress, neverAbort);
      expect(dispatchCommand).toHaveBeenCalledWith('raycast_query', expect.objectContaining({
        maxDistance: 100,
      }));
    });

    /**
     * The 2D path is ASYNCHRONOUS and its answer arrives as an engine event, so
     * the cases here assert only what this file is for — that the handler sends
     * the right command. The end-to-end behaviour across the correlation seam
     * (hit, miss, overlapping casts, refusal, self-hit) is covered by
     * `channels/__tests__/physicsChannel.test.ts`.
     *
     * These two used to assert `raycast2d_query` — a command the engine has
     * never implemented — with `handle_command`'s acceptance envelope read as
     * the raycast answer, and `isGrounded` returning true from that envelope
     * with no origin supplied at all. They passed for as long as they existed
     * because the mock agreed (lessons-learned #14), and they were pinning
     * #9271 in place.
     */
    it('dispatches the real raycast2d command and does not answer synchronously', async () => {
      const dispatchCommand = vi.fn().mockReturnValue({ success: true });
      const handler = createPhysicsHandler({ dispatchCommand });

      let settled = false;
      const pending = handler('raycast2d', {
        originX: 0, originY: 0, dirX: 1, dirY: 0, maxDistance: 10,
      }, noProgress, neverAbort).then(() => { settled = true; });
      await Promise.resolve();
      await Promise.resolve();

      expect(dispatchCommand).toHaveBeenCalledWith('raycast2d', expect.objectContaining({
        originX: 0, dirX: 1, maxDistance: 10,
      }));
      // No engine event has been delivered, so no answer exists yet.
      expect(settled).toBe(false);

      deliverRaycast2dAnswer(null);
      await pending;
      expect(settled).toBe(true);
    });

    it('isGrounded answers false without dispatching when given no position', async () => {
      const dispatchCommand = vi.fn().mockReturnValue({ success: true });
      const handler = createPhysicsHandler({ dispatchCommand });

      const result = await handler('isGrounded', { entityId: 'player', distance: 0.2 }, noProgress, neverAbort);

      expect(result).toBe(false);
      expect(dispatchCommand).not.toHaveBeenCalled();
    });

    it('throws for unknown method', async () => {
      const handler = createPhysicsHandler({ dispatchCommand: vi.fn() });
      await expect(handler('unknownMethod', {}, noProgress, neverAbort)).rejects.toThrow('Unknown physics method');
    });
  });

  // ─── AI ───────────────────────────────────────────────────────

  describe('aiChannel', () => {
    it('submits request and polls until completed', async () => {
      const fetchJson = vi.fn()
        .mockResolvedValueOnce({ jobId: 'job_123' })                               // submit
        .mockResolvedValueOnce({ status: 'processing', progress: 40, message: 'Building mesh...' }) // poll 1
        .mockResolvedValueOnce({ status: 'completed', data: { url: 'https://example.com/model.glb' } }); // poll 2

      const reportProgress = vi.fn();
      const handler = createAiHandler({ fetchJson });

      const result = await handler('generateModel', { prompt: 'a sword' }, reportProgress, neverAbort);

      expect(fetchJson).toHaveBeenCalledTimes(3);
      expect(fetchJson).toHaveBeenCalledWith('/api/generate/model', expect.objectContaining({
        method: 'POST',
      }));
      expect(reportProgress).toHaveBeenCalledWith(0, 'Submitting request...');
      expect(reportProgress).toHaveBeenCalledWith(40, 'Building mesh...');
      expect(reportProgress).toHaveBeenCalledWith(100, 'Done');
      expect(result).toEqual({ url: 'https://example.com/model.glb' });
    });

    it('throws on failed generation', async () => {
      const fetchJson = vi.fn()
        .mockResolvedValueOnce({ jobId: 'job_456' })
        .mockResolvedValueOnce({ status: 'failed', error: 'Rate limited' });

      const handler = createAiHandler({ fetchJson });
      await expect(handler('generateTexture', { prompt: 'stone' }, vi.fn(), neverAbort))
        .rejects.toThrow('Rate limited');
    });

    it('throws when no jobId returned', async () => {
      const fetchJson = vi.fn().mockResolvedValueOnce({ error: 'Unauthorized' });
      const handler = createAiHandler({ fetchJson });

      await expect(handler('generateTexture', { prompt: 'wood' }, vi.fn(), neverAbort))
        .rejects.toThrow('Unauthorized');
    });

    it('throws for unknown AI method', async () => {
      const handler = createAiHandler({ fetchJson: vi.fn() });
      await expect(handler('unknownAiMethod', {}, vi.fn(), neverAbort))
        .rejects.toThrow('Unknown AI method');
    });
  });

  // ─── Asset ────────────────────────────────────────────────────

  describe('assetChannel', () => {
    it('loads image with progress', async () => {
      const fetchJson = vi.fn().mockResolvedValue({ assetId: 'img_1', url: '/assets/img.png' });
      const reportProgress = vi.fn();
      const handler = createAssetHandler({ fetchJson });

      const result = await handler('loadImage', { url: 'https://example.com/img.png' }, reportProgress, neverAbort);

      expect(fetchJson).toHaveBeenCalledWith('/api/assets/load', expect.objectContaining({
        method: 'POST',
      }));
      expect(reportProgress).toHaveBeenCalledWith(0, 'Loading image...');
      expect(reportProgress).toHaveBeenCalledWith(100, 'Image loaded');
      expect(result).toEqual({ assetId: 'img_1', url: '/assets/img.png' });
    });

    it('loads model with progress', async () => {
      const fetchJson = vi.fn().mockResolvedValue({ assetId: 'mdl_1' });
      const reportProgress = vi.fn();
      const handler = createAssetHandler({ fetchJson });

      await handler('loadModel', { url: 'https://example.com/model.glb' }, reportProgress, neverAbort);
      expect(reportProgress).toHaveBeenCalledWith(0, 'Loading model...');
      expect(reportProgress).toHaveBeenCalledWith(100, 'Model loaded');
    });

    it('throws for unknown method', async () => {
      const handler = createAssetHandler({ fetchJson: vi.fn() });
      await expect(handler('unknownMethod', {}, vi.fn(), neverAbort)).rejects.toThrow('Unknown asset method');
    });
  });

  // ─── Audio ────────────────────────────────────────────────────

  describe('audioChannel', () => {
    it('calls detectLoopPoints', async () => {
      const detectLoopPoints = vi.fn().mockResolvedValue([{ start: 0, end: 1.5 }]);
      const handler = createAudioHandler({
        detectLoopPoints,
        getWaveform: vi.fn(),
      });

      const result = await handler('detectLoopPoints', { assetId: 'music_01' }, noProgress, neverAbort);
      expect(detectLoopPoints).toHaveBeenCalledWith('music_01');
      expect(result).toEqual([{ start: 0, end: 1.5 }]);
    });

    it('throws when assetId missing for detectLoopPoints', async () => {
      const handler = createAudioHandler({
        detectLoopPoints: vi.fn(),
        getWaveform: vi.fn(),
      });
      await expect(handler('detectLoopPoints', {}, noProgress, neverAbort))
        .rejects.toThrow('Missing assetId');
    });

    it('calls getWaveform', async () => {
      const getWaveform = vi.fn().mockResolvedValue({ samples: [0.1, 0.5] });
      const handler = createAudioHandler({
        detectLoopPoints: vi.fn(),
        getWaveform,
      });

      const result = await handler('getWaveform', { assetId: 'sfx_01' }, noProgress, neverAbort);
      expect(getWaveform).toHaveBeenCalledWith('sfx_01');
      expect(result).toEqual({ samples: [0.1, 0.5] });
    });
  });

  // ─── Animation ────────────────────────────────────────────────

  describe('animationChannel', () => {
    it('dispatches listClips', async () => {
      const dispatchCommand = vi.fn().mockReturnValue(['idle', 'run', 'jump']);
      const handler = createAnimationHandler({ dispatchCommand });

      const result = await handler('listClips', { entityId: 'player' }, noProgress, neverAbort);
      expect(dispatchCommand).toHaveBeenCalledWith('list_animation_clips', { entityId: 'player' });
      expect(result).toEqual(['idle', 'run', 'jump']);
    });

    it('dispatches getClipDuration', async () => {
      const dispatchCommand = vi.fn().mockReturnValue(2.5);
      const handler = createAnimationHandler({ dispatchCommand });

      const result = await handler('getClipDuration', {
        entityId: 'player',
        clipName: 'run',
      }, noProgress, neverAbort);
      expect(result).toBe(2.5);
    });

    it('returns empty array when listClips has no result', async () => {
      const dispatchCommand = vi.fn().mockReturnValue(null);
      const handler = createAnimationHandler({ dispatchCommand });

      const result = await handler('listClips', { entityId: 'player' }, noProgress, neverAbort);
      expect(result).toEqual([]);
    });

    it('throws for unknown method', async () => {
      const handler = createAnimationHandler({ dispatchCommand: vi.fn() });
      await expect(handler('unknownMethod', {}, noProgress, neverAbort)).rejects.toThrow('Unknown animation method');
    });
  });
});
