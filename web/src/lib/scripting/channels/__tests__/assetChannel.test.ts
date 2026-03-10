/**
 * Unit tests for the asset channel handler (assetChannel.ts).
 *
 * Tests cover: loadImage, loadModel, unknown method, progress reporting,
 * argument forwarding, and fetch delegation.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAssetHandler } from '../assetChannel';

function makeSignal(): AbortSignal {
  return new AbortController().signal;
}

const noProgress = vi.fn();

/** Extract the RequestInit from the second argument of a vi.fn() call. */
function getCallInit(mockFn: ReturnType<typeof vi.fn>, callIndex = 0): RequestInit {
  return (mockFn.mock.calls[callIndex] as [string, RequestInit])[1];
}

describe('createAssetHandler', () => {
  describe('loadImage', () => {
    it('calls /api/assets/load with type image', async () => {
      const fetchJson = vi.fn(() => Promise.resolve({ assetId: 'img-1', handle: 'h1' }));
      const handler = createAssetHandler({ fetchJson });

      const result = await handler(
        'loadImage',
        { url: 'https://example.com/tex.png', assetId: 'img-1' },
        noProgress,
        makeSignal(),
      );

      expect(fetchJson).toHaveBeenCalledWith(
        '/api/assets/load',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      const callBody = JSON.parse(getCallInit(fetchJson).body as string);
      expect(callBody).toEqual({
        type: 'image',
        url: 'https://example.com/tex.png',
        assetId: 'img-1',
      });

      expect(result).toEqual({ assetId: 'img-1', handle: 'h1' });
    });

    it('reports progress at 0 and 100', async () => {
      const fetchJson = vi.fn(() => Promise.resolve({ ok: true }));
      const reportProgress = vi.fn();
      const handler = createAssetHandler({ fetchJson });

      await handler(
        'loadImage',
        { url: 'https://example.com/img.png' },
        reportProgress,
        makeSignal(),
      );

      expect(reportProgress).toHaveBeenCalledWith(0, 'Loading image...');
      expect(reportProgress).toHaveBeenCalledWith(100, 'Image loaded');
    });

    it('passes signal to fetchJson', async () => {
      const fetchJson = vi.fn(() => Promise.resolve({}));
      const handler = createAssetHandler({ fetchJson });
      const signal = makeSignal();

      await handler('loadImage', { url: 'https://x.com/a.png' }, noProgress, signal);

      expect(getCallInit(fetchJson).signal).toBe(signal);
    });
  });

  describe('loadModel', () => {
    it('calls /api/assets/load with type model', async () => {
      const fetchJson = vi.fn(() => Promise.resolve({ assetId: 'model-1' }));
      const handler = createAssetHandler({ fetchJson });

      await handler(
        'loadModel',
        { url: 'https://example.com/scene.glb', assetId: 'model-1' },
        noProgress,
        makeSignal(),
      );

      const callBody = JSON.parse(getCallInit(fetchJson).body as string);
      expect(callBody).toEqual({
        type: 'model',
        url: 'https://example.com/scene.glb',
        assetId: 'model-1',
      });
    });

    it('reports progress at 0 and 100 for model', async () => {
      const fetchJson = vi.fn(() => Promise.resolve({}));
      const reportProgress = vi.fn();
      const handler = createAssetHandler({ fetchJson });

      await handler(
        'loadModel',
        { url: 'https://example.com/mesh.glb' },
        reportProgress,
        makeSignal(),
      );

      expect(reportProgress).toHaveBeenCalledWith(0, 'Loading model...');
      expect(reportProgress).toHaveBeenCalledWith(100, 'Model loaded');
    });

    it('returns the fetch result', async () => {
      const fetchResult = { assetId: 'model-2', entityId: 'ent-99' };
      const fetchJson = vi.fn(() => Promise.resolve(fetchResult));
      const handler = createAssetHandler({ fetchJson });

      const result = await handler(
        'loadModel',
        { url: 'https://cdn.example.com/hero.glb' },
        noProgress,
        makeSignal(),
      );

      expect(result).toEqual(fetchResult);
    });

    it('passes signal for model fetch', async () => {
      const fetchJson = vi.fn(() => Promise.resolve({}));
      const handler = createAssetHandler({ fetchJson });
      const signal = makeSignal();

      await handler('loadModel', { url: 'https://x.com/m.glb' }, noProgress, signal);

      expect(getCallInit(fetchJson).signal).toBe(signal);
    });
  });

  describe('unknown method', () => {
    it('throws for unknown asset method', async () => {
      const fetchJson = vi.fn();
      const handler = createAssetHandler({ fetchJson });

      await expect(
        handler('loadAudio', {}, noProgress, makeSignal()),
      ).rejects.toThrow('Unknown asset method: loadAudio');
    });

    it('does not call fetchJson for unknown methods', async () => {
      const fetchJson = vi.fn();
      const handler = createAssetHandler({ fetchJson });

      await handler('badMethod', {}, noProgress, makeSignal()).catch(() => {});

      expect(fetchJson).not.toHaveBeenCalled();
    });
  });
});
