import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  copyTransformProperty,
  copyFullTransform,
  readTransformFromClipboard,
  getPropertyFromClipboard,
  hasTransformInClipboard,
  hasPropertyInClipboard,
  type TransformClipboardData,
} from './transformClipboard';

describe('transformClipboard', () => {
  let clipboardText = '';

  beforeEach(() => {
    clipboardText = '';
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async (text: string) => {
          clipboardText = text;
        }),
        readText: vi.fn(async () => clipboardText),
      },
    });
  });

  describe('Copy Operations', () => {
    it('should copy transform property to clipboard with correct JSON', async () => {
      const result = await copyTransformProperty('position', [1, 2, 3]);
      expect(result).toBe(true);

      const parsed = JSON.parse(clipboardText) as TransformClipboardData;
      expect(parsed.type).toBe('forge-transform');
      expect(parsed.property).toBe('position');
      expect(parsed.position).toEqual([1, 2, 3]);
    });

    it('should copy full transform with position, rotation, and scale', async () => {
      const result = await copyFullTransform([1, 2, 3], [45, 90, 0], [2, 2, 2]);
      expect(result).toBe(true);

      const parsed = JSON.parse(clipboardText) as TransformClipboardData;
      expect(parsed.type).toBe('forge-transform');
      expect(parsed.position).toEqual([1, 2, 3]);
      expect(parsed.rotation).toEqual([45, 90, 0]);
      expect(parsed.scale).toEqual([2, 2, 2]);
    });

    it('should return true on successful copy', async () => {
      const result = await copyTransformProperty('scale', [1.5, 1.5, 1.5]);
      expect(result).toBe(true);
    });

    it('should copy rotation property correctly', async () => {
      await copyTransformProperty('rotation', [0, 45, 90]);
      const parsed = JSON.parse(clipboardText) as TransformClipboardData;
      expect(parsed.rotation).toEqual([0, 45, 90]);
      expect(parsed.property).toBe('rotation');
    });
  });

  describe('Read Operations', () => {
    it('should read parsed data after copy', async () => {
      await copyTransformProperty('position', [10, 20, 30]);
      const data = await readTransformFromClipboard();

      expect(data).toBeDefined();
      expect(data?.type).toBe('forge-transform');
      expect(data?.position).toEqual([10, 20, 30]);
      expect(data?.property).toBe('position');
    });

    it('should return null when clipboard is empty', async () => {
      clipboardText = '';
      const data = await readTransformFromClipboard();
      expect(data).toBeNull();
    });

    it('should return null for non-transform JSON', async () => {
      clipboardText = JSON.stringify({ type: 'other-data', value: 123 });
      const data = await readTransformFromClipboard();
      expect(data).toBeNull();
    });

    it('should return null for invalid JSON', async () => {
      clipboardText = 'not json at all';
      const data = await readTransformFromClipboard();
      expect(data).toBeNull();
    });

    it('should read full transform correctly', async () => {
      await copyFullTransform([5, 10, 15], [30, 60, 90], [0.5, 0.5, 0.5]);
      const data = await readTransformFromClipboard();

      expect(data?.position).toEqual([5, 10, 15]);
      expect(data?.rotation).toEqual([30, 60, 90]);
      expect(data?.scale).toEqual([0.5, 0.5, 0.5]);
    });
  });

  describe('Property Extraction', () => {
    it('should extract specific property from full transform', async () => {
      await copyFullTransform([1, 2, 3], [45, 90, 135], [2, 2, 2]);
      const rotation = await getPropertyFromClipboard('rotation');

      expect(rotation).toEqual([45, 90, 135]);
    });

    it('should return null when property not present', async () => {
      await copyTransformProperty('position', [1, 2, 3]);
      const rotation = await getPropertyFromClipboard('rotation');

      expect(rotation).toBeNull();
    });

    it('should extract property when only that property was copied', async () => {
      await copyTransformProperty('scale', [3, 3, 3]);
      const scale = await getPropertyFromClipboard('scale');

      expect(scale).toEqual([3, 3, 3]);
    });
  });

  describe('Clipboard Checks', () => {
    it('should return true when transform data is in clipboard', async () => {
      await copyTransformProperty('position', [0, 0, 0]);
      const hasData = await hasTransformInClipboard();
      expect(hasData).toBe(true);
    });

    it('should return false when clipboard is empty', async () => {
      clipboardText = '';
      const hasData = await hasTransformInClipboard();
      expect(hasData).toBe(false);
    });

    it('should return true for hasPropertyInClipboard after copying that property', async () => {
      await copyTransformProperty('position', [7, 8, 9]);
      const hasPosition = await hasPropertyInClipboard('position');
      expect(hasPosition).toBe(true);
    });

    it('should return false for hasPropertyInClipboard when property not present', async () => {
      await copyTransformProperty('position', [1, 2, 3]);
      const hasRotation = await hasPropertyInClipboard('rotation');
      expect(hasRotation).toBe(false);
    });

    it('should return true for all properties in full transform', async () => {
      await copyFullTransform([1, 2, 3], [4, 5, 6], [7, 8, 9]);

      const hasPosition = await hasPropertyInClipboard('position');
      const hasRotation = await hasPropertyInClipboard('rotation');
      const hasScale = await hasPropertyInClipboard('scale');

      expect(hasPosition).toBe(true);
      expect(hasRotation).toBe(true);
      expect(hasScale).toBe(true);
    });
  });
});
