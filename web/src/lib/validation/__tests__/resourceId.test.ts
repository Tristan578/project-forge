/**
 * Unit tests for validateResourceId — SSRF prevention via URL-safe ID validation.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { validateResourceId } from '../resourceId';

describe('validateResourceId', () => {
  describe('valid IDs', () => {
    it('accepts simple alphanumeric IDs', () => {
      expect(() => validateResourceId('abc123')).not.toThrow();
    });

    it('accepts IDs with hyphens', () => {
      expect(() => validateResourceId('my-resource-id')).not.toThrow();
    });

    it('accepts IDs with underscores', () => {
      expect(() => validateResourceId('my_resource_id')).not.toThrow();
    });

    it('accepts mixed alphanumeric, hyphens, and underscores', () => {
      expect(() => validateResourceId('proj_123-abc_DEF')).not.toThrow();
    });

    it('accepts single character IDs', () => {
      expect(() => validateResourceId('a')).not.toThrow();
      expect(() => validateResourceId('1')).not.toThrow();
      expect(() => validateResourceId('-')).not.toThrow();
      expect(() => validateResourceId('_')).not.toThrow();
    });

    it('accepts uppercase letters', () => {
      expect(() => validateResourceId('ABC')).not.toThrow();
    });

    it('accepts long valid IDs', () => {
      const longId = 'a'.repeat(1000);
      expect(() => validateResourceId(longId)).not.toThrow();
    });

    it('accepts UUIDs without dashes embedded', () => {
      expect(() => validateResourceId('550e8400e29b41d4a716446655440000')).not.toThrow();
    });

    it('accepts UUID format with dashes', () => {
      expect(() => validateResourceId('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();
    });
  });

  describe('path traversal attacks', () => {
    it('rejects dot-dot-slash path traversal', () => {
      expect(() => validateResourceId('../etc/passwd')).toThrow('Invalid resource ID');
    });

    it('rejects dot-dot-backslash path traversal', () => {
      expect(() => validateResourceId('..\\windows\\system32')).toThrow('Invalid resource ID');
    });

    it('rejects single dot path component', () => {
      expect(() => validateResourceId('./file')).toThrow('Invalid resource ID');
    });

    it('rejects forward slashes', () => {
      expect(() => validateResourceId('path/to/resource')).toThrow('Invalid resource ID');
    });

    it('rejects backslashes', () => {
      expect(() => validateResourceId('path\\to\\resource')).toThrow('Invalid resource ID');
    });

    it('rejects encoded path traversal sequences', () => {
      expect(() => validateResourceId('%2e%2e%2f')).toThrow('Invalid resource ID');
    });
  });

  describe('special characters', () => {
    it('rejects spaces', () => {
      expect(() => validateResourceId('my resource')).toThrow('Invalid resource ID');
    });

    it('rejects dots', () => {
      expect(() => validateResourceId('file.txt')).toThrow('Invalid resource ID');
    });

    it('rejects at signs', () => {
      expect(() => validateResourceId('user@domain')).toThrow('Invalid resource ID');
    });

    it('rejects hash symbols', () => {
      expect(() => validateResourceId('section#anchor')).toThrow('Invalid resource ID');
    });

    it('rejects question marks', () => {
      expect(() => validateResourceId('page?query=1')).toThrow('Invalid resource ID');
    });

    it('rejects ampersands', () => {
      expect(() => validateResourceId('a&b=c')).toThrow('Invalid resource ID');
    });

    it('rejects colons', () => {
      expect(() => validateResourceId('http:')).toThrow('Invalid resource ID');
    });

    it('rejects semicolons', () => {
      expect(() => validateResourceId('cmd;ls')).toThrow('Invalid resource ID');
    });

    it('rejects pipe characters', () => {
      expect(() => validateResourceId('cmd|ls')).toThrow('Invalid resource ID');
    });

    it('rejects angle brackets', () => {
      expect(() => validateResourceId('<script>')).toThrow('Invalid resource ID');
    });

    it('rejects curly braces', () => {
      expect(() => validateResourceId('{id}')).toThrow('Invalid resource ID');
    });

    it('rejects square brackets', () => {
      expect(() => validateResourceId('[0]')).toThrow('Invalid resource ID');
    });

    it('rejects parentheses', () => {
      expect(() => validateResourceId('fn()')).toThrow('Invalid resource ID');
    });

    it('rejects null bytes', () => {
      expect(() => validateResourceId('id\x00evil')).toThrow('Invalid resource ID');
    });

    it('rejects newlines', () => {
      expect(() => validateResourceId('id\nevil')).toThrow('Invalid resource ID');
    });

    it('rejects tabs', () => {
      expect(() => validateResourceId('id\tevil')).toThrow('Invalid resource ID');
    });

    it('rejects unicode characters', () => {
      expect(() => validateResourceId('café')).toThrow('Invalid resource ID');
    });

    it('rejects emoji', () => {
      expect(() => validateResourceId('test🔥')).toThrow('Invalid resource ID');
    });
  });

  describe('edge cases', () => {
    it('rejects empty string', () => {
      expect(() => validateResourceId('')).toThrow('Invalid resource ID');
    });

    it('rejects whitespace-only strings', () => {
      expect(() => validateResourceId('   ')).toThrow('Invalid resource ID');
    });

    it('rejects percent-encoded characters', () => {
      expect(() => validateResourceId('%20')).toThrow('Invalid resource ID');
    });

    it('error message does not leak the ID value', () => {
      try {
        validateResourceId('../../../etc/passwd');
        expect.fail('Should have thrown');
      } catch (e) {
        const msg = (e as Error).message;
        expect(msg).not.toContain('../../../etc/passwd');
        expect(msg).toContain('disallowed characters');
      }
    });
  });
});
