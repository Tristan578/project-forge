import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  copyTransformProperty,
  copyFullTransform,
  readTransformFromClipboard,
  getPropertyFromClipboard,
  hasTransformInClipboard,
  hasPropertyInClipboard,
} from '../transformClipboard';

describe('transformClipboard', () => {
  let clipboardText: string;

  beforeEach(() => {
    clipboardText = '';
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async (text: string) => { clipboardText = text; }),
        readText: vi.fn(async () => clipboardText),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('copyTransformProperty', () => {
    it('should copy position to clipboard', async () => {
      const result = await copyTransformProperty('position', [1, 2, 3]);
      expect(result).toBe(true);
      const data = JSON.parse(clipboardText);
      expect(data.type).toBe('forge-transform');
      expect(data.property).toBe('position');
      expect(data.position).toEqual([1, 2, 3]);
    });

    it('should copy rotation to clipboard', async () => {
      await copyTransformProperty('rotation', [45, 90, 0]);
      const data = JSON.parse(clipboardText);
      expect(data.rotation).toEqual([45, 90, 0]);
    });

    it('should copy scale to clipboard', async () => {
      await copyTransformProperty('scale', [2, 2, 2]);
      const data = JSON.parse(clipboardText);
      expect(data.scale).toEqual([2, 2, 2]);
    });

    it('should return false on clipboard error', async () => {
      vi.stubGlobal('navigator', {
        clipboard: {
          writeText: vi.fn(async () => { throw new Error('denied'); }),
          readText: vi.fn(async () => ''),
        },
      });
      const result = await copyTransformProperty('position', [0, 0, 0]);
      expect(result).toBe(false);
    });
  });

  describe('copyFullTransform', () => {
    it('should copy all three properties', async () => {
      const result = await copyFullTransform([1, 2, 3], [0, 90, 0], [1, 1, 1]);
      expect(result).toBe(true);
      const data = JSON.parse(clipboardText);
      expect(data.type).toBe('forge-transform');
      expect(data.position).toEqual([1, 2, 3]);
      expect(data.rotation).toEqual([0, 90, 0]);
      expect(data.scale).toEqual([1, 1, 1]);
    });
  });

  describe('readTransformFromClipboard', () => {
    it('should read valid transform data', async () => {
      clipboardText = JSON.stringify({
        type: 'forge-transform',
        position: [1, 2, 3],
      });
      const data = await readTransformFromClipboard();
      expect(data).not.toBeNull();
      expect(data!.position).toEqual([1, 2, 3]);
    });

    it('should return null for empty clipboard', async () => {
      clipboardText = '';
      const data = await readTransformFromClipboard();
      expect(data).toBeNull();
    });

    it('should return null for invalid JSON', async () => {
      clipboardText = 'not json';
      const data = await readTransformFromClipboard();
      expect(data).toBeNull();
    });

    it('should return null for wrong type', async () => {
      clipboardText = JSON.stringify({ type: 'other', position: [1, 2, 3] });
      const data = await readTransformFromClipboard();
      expect(data).toBeNull();
    });

    it('should return null for missing transform properties', async () => {
      clipboardText = JSON.stringify({ type: 'forge-transform' });
      const data = await readTransformFromClipboard();
      expect(data).toBeNull();
    });

    it('should accept data with only scale', async () => {
      clipboardText = JSON.stringify({
        type: 'forge-transform',
        scale: [2, 2, 2],
      });
      const data = await readTransformFromClipboard();
      expect(data).not.toBeNull();
      expect(data!.scale).toEqual([2, 2, 2]);
    });
  });

  describe('getPropertyFromClipboard', () => {
    it('should extract position from full transform', async () => {
      clipboardText = JSON.stringify({
        type: 'forge-transform',
        position: [5, 10, 15],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      });
      const pos = await getPropertyFromClipboard('position');
      expect(pos).toEqual([5, 10, 15]);
    });

    it('should return null when property is missing', async () => {
      clipboardText = JSON.stringify({
        type: 'forge-transform',
        position: [1, 2, 3],
      });
      const rot = await getPropertyFromClipboard('rotation');
      expect(rot).toBeNull();
    });

    it('should return null when clipboard is empty', async () => {
      const result = await getPropertyFromClipboard('position');
      expect(result).toBeNull();
    });
  });

  describe('hasTransformInClipboard', () => {
    it('should return true for valid transform', async () => {
      clipboardText = JSON.stringify({
        type: 'forge-transform',
        position: [0, 0, 0],
      });
      expect(await hasTransformInClipboard()).toBe(true);
    });

    it('should return false for empty clipboard', async () => {
      expect(await hasTransformInClipboard()).toBe(false);
    });
  });

  describe('hasPropertyInClipboard', () => {
    it('should return true when property exists', async () => {
      clipboardText = JSON.stringify({
        type: 'forge-transform',
        rotation: [0, 90, 0],
      });
      expect(await hasPropertyInClipboard('rotation')).toBe(true);
    });

    it('should return false when property is absent', async () => {
      clipboardText = JSON.stringify({
        type: 'forge-transform',
        position: [1, 2, 3],
      });
      expect(await hasPropertyInClipboard('scale')).toBe(false);
    });
  });
});
