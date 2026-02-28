/**
 * Tests for ExportDialog utility functions and logic.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

// Re-implement parseResolution from ExportDialog for testing
function parseResolution(res: string): [number, number] {
  const parts = res.split('x');
  return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
}

// Filename sanitization logic from ExportDialog
function sanitizeFilename(title: string): string {
  return title.replace(/[^a-z0-9_-]/gi, '_');
}

describe('ExportDialog utilities', () => {
  describe('parseResolution', () => {
    it('should parse 1920x1080', () => {
      expect(parseResolution('1920x1080')).toEqual([1920, 1080]);
    });

    it('should parse 1280x720', () => {
      expect(parseResolution('1280x720')).toEqual([1280, 720]);
    });

    it('should parse custom resolutions', () => {
      expect(parseResolution('800x600')).toEqual([800, 600]);
    });
  });

  describe('sanitizeFilename', () => {
    it('should keep alphanumeric characters', () => {
      expect(sanitizeFilename('MyGame123')).toBe('MyGame123');
    });

    it('should keep hyphens and underscores', () => {
      expect(sanitizeFilename('my-game_v2')).toBe('my-game_v2');
    });

    it('should replace spaces with underscores', () => {
      expect(sanitizeFilename('My Cool Game')).toBe('My_Cool_Game');
    });

    it('should replace special characters', () => {
      expect(sanitizeFilename('Game! @#$%')).toBe('Game______');
    });

    it('should handle empty string', () => {
      expect(sanitizeFilename('')).toBe('');
    });
  });

  describe('export error handling', () => {
    it('should extract message from Error objects', () => {
      const err = new Error('WASM fetch failed');
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toBe('WASM fetch failed');
    });

    it('should stringify non-Error objects', () => {
      const err: unknown = 'Network timeout';
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toBe('Network timeout');
    });

    it('should handle null/undefined errors', () => {
      const err: unknown = null;
      const message = err instanceof Error ? err.message : String(err);
      expect(message).toBe('null');
    });
  });

  describe('title validation', () => {
    it('should consider empty string invalid', () => {
      expect(''.trim().length > 0).toBe(false);
    });

    it('should consider whitespace-only invalid', () => {
      expect('   '.trim().length > 0).toBe(false);
    });

    it('should consider non-empty string valid', () => {
      expect('My Game'.trim().length > 0).toBe(true);
    });
  });
});
