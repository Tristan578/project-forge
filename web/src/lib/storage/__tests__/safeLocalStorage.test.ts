import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safeGetItem, safeSetItem } from '../safeLocalStorage';

describe('safeLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('safeGetItem', () => {
    it('returns stored value', () => {
      localStorage.setItem('key1', 'value1');
      expect(safeGetItem('key1')).toBe('value1');
    });

    it('returns null for non-existent key', () => {
      expect(safeGetItem('missing')).toBeNull();
    });

    it('returns null when localStorage throws', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('Storage unavailable');
      });

      expect(safeGetItem('key')).toBeNull();
      spy.mockRestore();
    });
  });

  describe('safeSetItem', () => {
    it('stores a value', () => {
      safeSetItem('key2', 'value2');
      expect(localStorage.getItem('key2')).toBe('value2');
    });

    it('overwrites existing value', () => {
      safeSetItem('key3', 'old');
      safeSetItem('key3', 'new');
      expect(localStorage.getItem('key3')).toBe('new');
    });

    it('silently ignores write failure', () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      // Should not throw
      expect(() => safeSetItem('key', 'value')).not.toThrow();
      spy.mockRestore();
    });
  });
});
