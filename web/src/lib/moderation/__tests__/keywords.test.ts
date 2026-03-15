import { describe, it, expect } from 'vitest';
import { containsBlockedKeyword, DEFAULT_BLOCKED_KEYWORDS } from '@/lib/moderation/keywords';

describe('DEFAULT_BLOCKED_KEYWORDS', () => {
  it('is a non-empty array of strings', () => {
    expect(Array.isArray(DEFAULT_BLOCKED_KEYWORDS)).toBe(true);
    expect(DEFAULT_BLOCKED_KEYWORDS.length).toBeGreaterThan(0);
    for (const kw of DEFAULT_BLOCKED_KEYWORDS) {
      expect(typeof kw).toBe('string');
    }
  });
});

describe('containsBlockedKeyword', () => {
  describe('exact single-word matches', () => {
    it('detects a blocked keyword at the start of the string', () => {
      expect(containsBlockedKeyword('fuck this game')).toBe(true);
    });

    it('detects a blocked keyword at the end of the string', () => {
      expect(containsBlockedKeyword('I hate this shit')).toBe(true);
    });

    it('detects a blocked keyword in the middle of a sentence', () => {
      expect(containsBlockedKeyword('you are an asshole for doing this')).toBe(true);
    });

    it('detects keyword that is the entire string', () => {
      expect(containsBlockedKeyword('fuck')).toBe(true);
    });
  });

  describe('case insensitivity', () => {
    it('matches uppercase keyword', () => {
      expect(containsBlockedKeyword('FUCK you')).toBe(true);
    });

    it('matches mixed-case keyword', () => {
      expect(containsBlockedKeyword('Shit happens')).toBe(true);
    });

    it('matches all-caps with surrounding context', () => {
      expect(containsBlockedKeyword('this is BITCH behaviour')).toBe(true);
    });
  });

  describe('word-boundary enforcement (no false positives)', () => {
    it('does NOT match "ass" inside "grass"', () => {
      expect(containsBlockedKeyword('The grass is green')).toBe(false);
    });

    it('does NOT match "ass" inside "classic"', () => {
      expect(containsBlockedKeyword('a classic game')).toBe(false);
    });

    it('does NOT match "dick" inside "dictionary"', () => {
      expect(containsBlockedKeyword('check the dictionary')).toBe(false);
    });

    it('does NOT match "cunt" inside "punctuation"', () => {
      expect(containsBlockedKeyword('watch your punctuation')).toBe(false);
    });

    it('does NOT match "shit" inside "shifting"', () => {
      expect(containsBlockedKeyword('the shifting sands')).toBe(false);
    });
  });

  describe('multi-word phrase matching', () => {
    it('detects "buy now" phrase', () => {
      expect(containsBlockedKeyword('buy now and save big')).toBe(true);
    });

    it('detects "free money" phrase', () => {
      expect(containsBlockedKeyword('win free money today')).toBe(true);
    });

    it('detects "kill yourself" phrase', () => {
      expect(containsBlockedKeyword('you should kill yourself')).toBe(true);
    });

    it('detects phrase case-insensitively', () => {
      expect(containsBlockedKeyword('BUY NOW to get started')).toBe(true);
    });

    it('does NOT match partial phrase', () => {
      // "click" alone is not in the list, only "click here"
      expect(containsBlockedKeyword('click the button')).toBe(false);
    });
  });

  describe('clean text', () => {
    it('returns false for completely clean text', () => {
      expect(containsBlockedKeyword('This is a great game!')).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(containsBlockedKeyword('')).toBe(false);
    });

    it('returns false for whitespace only', () => {
      expect(containsBlockedKeyword('   ')).toBe(false);
    });
  });

  describe('custom keywords list', () => {
    it('uses provided keywords instead of defaults', () => {
      expect(containsBlockedKeyword('badword here', ['badword'])).toBe(true);
    });

    it('does NOT match default keywords when custom list provided', () => {
      // "fuck" is in defaults but NOT in custom list
      expect(containsBlockedKeyword('fuck this', ['badword'])).toBe(false);
    });

    it('handles empty custom keywords list (no matches)', () => {
      expect(containsBlockedKeyword('fuck this', [])).toBe(false);
    });

    it('handles custom multi-word phrase', () => {
      expect(containsBlockedKeyword('buy cheap items now', ['buy cheap'])).toBe(true);
    });

    it('handles custom keyword with word-boundary', () => {
      // "spam" should match "spam" but not "spammer" when using word boundaries
      expect(containsBlockedKeyword('this is spam', ['spam'])).toBe(true);
    });
  });

  describe('spam patterns in default list', () => {
    it('detects "kys" abbreviation', () => {
      expect(containsBlockedKeyword('just kys already')).toBe(true);
    });

    it('detects "suicide" keyword', () => {
      expect(containsBlockedKeyword('talking about suicide')).toBe(true);
    });

    it('detects "retard" slur', () => {
      expect(containsBlockedKeyword('stop being a retard')).toBe(true);
    });
  });
});
