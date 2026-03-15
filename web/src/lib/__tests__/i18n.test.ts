import { describe, it, expect } from 'vitest';
import enMessages from '../../i18n/messages/en.json';
import { locales, defaultLocale } from '../../i18n/config';

describe('i18n config', () => {
  it('exports the en locale', () => {
    expect(locales).toContain('en');
  });

  it('defaults to en locale', () => {
    expect(defaultLocale).toBe('en');
  });
});

describe('en.json message catalog', () => {
  it('parses as valid JSON with expected top-level namespaces', () => {
    expect(enMessages).toHaveProperty('common');
    expect(enMessages).toHaveProperty('editor');
    expect(enMessages).toHaveProperty('auth');
  });

  describe('common namespace', () => {
    it('has save key', () => {
      expect(enMessages.common.save).toBe('Save');
    });

    it('has cancel key', () => {
      expect(enMessages.common.cancel).toBe('Cancel');
    });

    it('has delete key', () => {
      expect(enMessages.common.delete).toBe('Delete');
    });

    it('has loading key', () => {
      expect(enMessages.common.loading).toBe('Loading...');
    });

    it('has error key', () => {
      expect(enMessages.common.error).toBe('An error occurred');
    });
  });

  describe('editor namespace', () => {
    it('has addEntity key', () => {
      expect(enMessages.editor.addEntity).toBe('Add Entity');
    });

    it('has play key', () => {
      expect(enMessages.editor.play).toBe('Play');
    });

    it('has stop key', () => {
      expect(enMessages.editor.stop).toBe('Stop');
    });

    it('has pause key', () => {
      expect(enMessages.editor.pause).toBe('Pause');
    });

    it('has export key', () => {
      expect(enMessages.editor.export).toBe('Export Game');
    });
  });

  describe('auth namespace', () => {
    it('has signIn key', () => {
      expect(enMessages.auth.signIn).toBe('Sign In');
    });

    it('has signUp key', () => {
      expect(enMessages.auth.signUp).toBe('Sign Up');
    });

    it('has signOut key', () => {
      expect(enMessages.auth.signOut).toBe('Sign Out');
    });
  });

  it('has no empty string values', () => {
    function checkNoEmpty(obj: Record<string, unknown>, path = ''): void {
      for (const [key, value] of Object.entries(obj)) {
        const fullPath = path ? `${path}.${key}` : key;
        if (typeof value === 'string') {
          expect(value, `Key "${fullPath}" must not be empty`).not.toBe('');
        } else if (typeof value === 'object' && value !== null) {
          checkNoEmpty(value as Record<string, unknown>, fullPath);
        }
      }
    }
    checkNoEmpty(enMessages);
  });
});
