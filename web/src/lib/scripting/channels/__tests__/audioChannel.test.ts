/**
 * Unit tests for the audio channel handler (audioChannel.ts).
 *
 * Tests cover: detectLoopPoints, getWaveform, unknown method,
 * missing assetId validation, and result forwarding.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAudioHandler } from '../audioChannel';

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

const noProgress = vi.fn();

describe('createAudioHandler', () => {
  describe('detectLoopPoints', () => {
    it('calls detectLoopPoints dep with the assetId', async () => {
      const loopPoints = { start: 0.5, end: 12.3 };
      const detectLoopPoints = vi.fn(() => Promise.resolve(loopPoints));
      const getWaveform = vi.fn();
      const handler = createAudioHandler({ detectLoopPoints, getWaveform });

      const result = await handler(
        'detectLoopPoints',
        { assetId: 'sfx-1' },
        noProgress,
        makeSignal(),
      );

      expect(detectLoopPoints).toHaveBeenCalledWith('sfx-1');
      expect(result).toEqual(loopPoints);
    });

    it('throws when assetId is missing', async () => {
      const detectLoopPoints = vi.fn();
      const getWaveform = vi.fn();
      const handler = createAudioHandler({ detectLoopPoints, getWaveform });

      await expect(
        handler('detectLoopPoints', {}, noProgress, makeSignal()),
      ).rejects.toThrow('Missing assetId for detectLoopPoints');
    });

    it('throws when assetId is empty string', async () => {
      const detectLoopPoints = vi.fn();
      const getWaveform = vi.fn();
      const handler = createAudioHandler({ detectLoopPoints, getWaveform });

      await expect(
        handler('detectLoopPoints', { assetId: '' }, noProgress, makeSignal()),
      ).rejects.toThrow('Missing assetId for detectLoopPoints');
    });

    it('does not call getWaveform when called as detectLoopPoints', async () => {
      const detectLoopPoints = vi.fn(() => Promise.resolve({}));
      const getWaveform = vi.fn();
      const handler = createAudioHandler({ detectLoopPoints, getWaveform });

      await handler('detectLoopPoints', { assetId: 'track-1' }, noProgress, makeSignal());

      expect(getWaveform).not.toHaveBeenCalled();
    });

    it('propagates rejection from detectLoopPoints dep', async () => {
      const detectLoopPoints = vi.fn(() => Promise.reject(new Error('Analysis failed')));
      const getWaveform = vi.fn();
      const handler = createAudioHandler({ detectLoopPoints, getWaveform });

      await expect(
        handler('detectLoopPoints', { assetId: 'track-2' }, noProgress, makeSignal()),
      ).rejects.toThrow('Analysis failed');
    });
  });

  describe('getWaveform', () => {
    it('calls getWaveform dep with the assetId', async () => {
      const waveform = { peaks: [0.1, 0.5, 0.9, 0.3], duration: 30.0 };
      const detectLoopPoints = vi.fn();
      const getWaveform = vi.fn(() => Promise.resolve(waveform));
      const handler = createAudioHandler({ detectLoopPoints, getWaveform });

      const result = await handler(
        'getWaveform',
        { assetId: 'music-1' },
        noProgress,
        makeSignal(),
      );

      expect(getWaveform).toHaveBeenCalledWith('music-1');
      expect(result).toEqual(waveform);
    });

    it('throws when assetId is missing', async () => {
      const detectLoopPoints = vi.fn();
      const getWaveform = vi.fn();
      const handler = createAudioHandler({ detectLoopPoints, getWaveform });

      await expect(
        handler('getWaveform', {}, noProgress, makeSignal()),
      ).rejects.toThrow('Missing assetId for getWaveform');
    });

    it('throws when assetId is empty string', async () => {
      const detectLoopPoints = vi.fn();
      const getWaveform = vi.fn();
      const handler = createAudioHandler({ detectLoopPoints, getWaveform });

      await expect(
        handler('getWaveform', { assetId: '' }, noProgress, makeSignal()),
      ).rejects.toThrow('Missing assetId for getWaveform');
    });

    it('does not call detectLoopPoints when called as getWaveform', async () => {
      const detectLoopPoints = vi.fn();
      const getWaveform = vi.fn(() => Promise.resolve([]));
      const handler = createAudioHandler({ detectLoopPoints, getWaveform });

      await handler('getWaveform', { assetId: 'music-2' }, noProgress, makeSignal());

      expect(detectLoopPoints).not.toHaveBeenCalled();
    });

    it('propagates rejection from getWaveform dep', async () => {
      const detectLoopPoints = vi.fn();
      const getWaveform = vi.fn(() => Promise.reject(new Error('Decode error')));
      const handler = createAudioHandler({ detectLoopPoints, getWaveform });

      await expect(
        handler('getWaveform', { assetId: 'track-3' }, noProgress, makeSignal()),
      ).rejects.toThrow('Decode error');
    });
  });

  describe('unknown method', () => {
    it('throws for unknown audio method', async () => {
      const detectLoopPoints = vi.fn();
      const getWaveform = vi.fn();
      const handler = createAudioHandler({ detectLoopPoints, getWaveform });

      await expect(
        handler('play', {}, noProgress, makeSignal()),
      ).rejects.toThrow('Unknown audio method: play');
    });

    it('does not call either dep for unknown method', async () => {
      const detectLoopPoints = vi.fn();
      const getWaveform = vi.fn();
      const handler = createAudioHandler({ detectLoopPoints, getWaveform });

      await handler('unknownAudioMethod', {}, noProgress, makeSignal()).catch(() => {});

      expect(detectLoopPoints).not.toHaveBeenCalled();
      expect(getWaveform).not.toHaveBeenCalled();
    });
  });
});
