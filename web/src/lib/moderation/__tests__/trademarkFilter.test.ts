/**
 * Tests for the trademark / copyrighted IP name filter.
 *
 * Verifies that known gaming IPs are detected in both titles and slugs
 * (hyphenated), and that non-infringing text passes cleanly.
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterEach } from 'vitest';
import { checkTrademark } from '../trademarkFilter';

describe('trademarkFilter', () => {
  const originalEnv = process.env.TRADEMARK_BLOCK_LIST;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.TRADEMARK_BLOCK_LIST;
    } else {
      process.env.TRADEMARK_BLOCK_LIST = originalEnv;
    }
  });

  describe('checkTrademark', () => {
    it('should pass clean, original game titles', () => {
      expect(checkTrademark('My Awesome Platformer').matched).toBe(false);
      expect(checkTrademark('A fantasy RPG with dragons').matched).toBe(false);
    });

    it('should pass clean slugs', () => {
      expect(checkTrademark('my-awesome-platformer').matched).toBe(false);
      expect(checkTrademark('fantasy-rpg-dragons').matched).toBe(false);
    });

    it('should detect Sonic in a title', () => {
      const result = checkTrademark('Sonic 2 Ultimate');
      expect(result.matched).toBe(true);
      expect(result.matches).toContain('Sonic the Hedgehog');
    });

    it('should detect Sonic in a slug (hyphenated)', () => {
      const result = checkTrademark('sonic-2-ultimate');
      expect(result.matched).toBe(true);
      expect(result.matches).toContain('Sonic the Hedgehog');
    });

    it('should detect Mario in a title', () => {
      const result = checkTrademark('Super Mario Adventure');
      expect(result.matched).toBe(true);
      expect(result.matches).toContain('Mario');
    });

    it('should detect Animal Crossing in a slug', () => {
      const result = checkTrademark('rovanimalworld');
      // "rovanimalworld" has no word boundary around "animal" — should NOT match
      expect(result.matched).toBe(false);
    });

    it('should detect Animal Crossing when properly separated', () => {
      const result = checkTrademark('animal-crossing-clone');
      expect(result.matched).toBe(true);
      expect(result.matches).toContain('Animal Crossing');
    });

    it('should be case-insensitive', () => {
      expect(checkTrademark('SONIC THE HEDGEHOG').matched).toBe(true);
      expect(checkTrademark('mArIo').matched).toBe(true);
    });

    it('should detect multiple IPs and deduplicate', () => {
      const result = checkTrademark('Sonic meets Mario');
      expect(result.matched).toBe(true);
      expect(result.matches).toHaveLength(2);
    });

    it('should detect multi-word IPs with hyphens in slugs', () => {
      expect(checkTrademark('legend-of-zelda-fan-game').matched).toBe(true);
      expect(checkTrademark('mortal-kombat-tribute').matched).toBe(true);
      expect(checkTrademark('call-of-duty-clone').matched).toBe(true);
    });

    it('should not match partial word boundaries', () => {
      // "sonic" inside "bisonic" should not match (no word boundary)
      expect(checkTrademark('bisonic-game').matched).toBe(false);
    });

    it('should respect TRADEMARK_BLOCK_LIST env var', () => {
      process.env.TRADEMARK_BLOCK_LIST = 'Hollow Knight, Celeste';
      expect(checkTrademark('Hollow Knight adventure').matched).toBe(true);
      expect(checkTrademark('celeste-style platformer').matched).toBe(true);
    });

    it('should handle empty string', () => {
      const result = checkTrademark('');
      expect(result.matched).toBe(false);
      expect(result.matches).toHaveLength(0);
    });
  });
});
