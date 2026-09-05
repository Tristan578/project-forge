import { describe, it, expect, afterEach } from 'vitest';
import { moderateContent, shouldBlock, shouldFlag } from './contentFilter';

describe('moderateContent', () => {
  afterEach(() => {
    // Clean up env var
    delete process.env.MODERATION_BLOCK_LIST;
  });

  it('passes clean text', () => {
    const result = moderateContent('Hello, this is a nice game!');
    expect(result.severity).toBe('pass');
    expect(result.reasons).toHaveLength(0);
    expect(result.cleaned).toBe('Hello, this is a nice game!');
  });

  it('blocks severe slurs', () => {
    const result = moderateContent('This contains a n1gger slur');
    expect(result.severity).toBe('block');
    expect(result.reasons).toContain('Contains prohibited content');
    // Blocked words should be replaced with asterisks
    expect(result.cleaned).not.toContain('n1gger');
  });

  it('blocks self-harm abbreviations', () => {
    const result = moderateContent('just kys already');
    expect(result.severity).toBe('block');
    expect(result.reasons).toContain('Contains prohibited content');
  });

  it('flags profanity', () => {
    const result = moderateContent('What the fuck is going on');
    expect(result.severity).toBe('flag');
    expect(result.reasons).toContain('Contains inappropriate language');
    expect(result.cleaned).not.toContain('fuck');
  });

  it('flags sexual content', () => {
    const result = moderateContent('This game has sexual content');
    expect(result.severity).toBe('flag');
    expect(result.reasons).toContain('Contains inappropriate language');
  });

  it('flags suicide/self-harm mentions', () => {
    const result = moderateContent('A game about suicide prevention');
    expect(result.severity).toBe('flag');
    expect(result.reasons).toContain('Contains inappropriate language');
  });

  it('flags spam patterns - repeated characters', () => {
    const result = moderateContent('Wowwwwwwwwwwwwwwwwwwww great game');
    expect(result.severity).toBe('flag');
    expect(result.reasons).toContain('Potential spam detected');
  });

  it('flags spam patterns - excessive caps', () => {
    const result = moderateContent('BUY MY GAME NOW ITS THE BEST EVER MADE');
    expect(result.severity).toBe('flag');
    expect(result.reasons).toContain('Potential spam detected');
  });

  it('flags spam patterns - URL fragments', () => {
    const result = moderateContent('Visit www.sketchy.com for free stuff');
    expect(result.severity).toBe('flag');
    expect(result.reasons).toContain('Potential spam detected');
  });

  it('deduplicates reasons', () => {
    // Text that triggers multiple flag patterns
    const result = moderateContent('fuck shit bitch');
    expect(result.severity).toBe('flag');
    // All matches produce the same reason, so it should be deduplicated
    const uniqueReasons = [...new Set(result.reasons)];
    expect(result.reasons.length).toBe(uniqueReasons.length);
  });

  it('block severity takes priority over flag', () => {
    // Text that would trigger both block and flag patterns
    const result = moderateContent('kys you fucking idiot');
    expect(result.severity).toBe('block');
  });

  it('respects custom MODERATION_BLOCK_LIST environment variable', () => {
    process.env.MODERATION_BLOCK_LIST = 'badgame,toxicword';
    const result = moderateContent('This badgame is terrible');
    expect(result.severity).toBe('block');
    expect(result.reasons).toContain('Contains blocked term');
  });

  it('handles empty custom block list', () => {
    process.env.MODERATION_BLOCK_LIST = '';
    const result = moderateContent('A perfectly fine message');
    expect(result.severity).toBe('pass');
  });
});

describe('shouldBlock', () => {
  it('returns true for blocked content', () => {
    expect(shouldBlock('kys loser')).toBe(true);
  });

  it('returns false for flagged content', () => {
    expect(shouldBlock('damn this game')).toBe(false);
  });

  it('returns false for clean content', () => {
    expect(shouldBlock('Great game!')).toBe(false);
  });
});

describe('shouldFlag', () => {
  it('returns true for blocked content', () => {
    expect(shouldFlag('kys loser')).toBe(true);
  });

  it('returns true for flagged content', () => {
    expect(shouldFlag('what the fuck')).toBe(true);
  });

  it('returns false for clean content', () => {
    expect(shouldFlag('This is a great game')).toBe(false);
  });
});
