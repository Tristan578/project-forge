import { describe, it, expect } from 'vitest';
import {
  QUICK_START_AUTO_GATES,
  QUICK_START_GAME_TYPES,
  buildQuickStartPrompt,
  findQuickStartGameType,
} from '../quickStart';

describe('QUICK_START_AUTO_GATES', () => {
  it('auto-approves gate_plan and nothing else', () => {
    // Pinned as an exact list, not a `toContain`: gate_assets gates real token
    // spend and gate_final gates the finished result, so silently adding either
    // here would let the quick-start flow answer them on the user's behalf.
    expect(Array.from(QUICK_START_AUTO_GATES)).toEqual(['gate_plan']);
  });
});

describe('QUICK_START_GAME_TYPES', () => {
  it('offers the four game types with unique ids', () => {
    expect(QUICK_START_GAME_TYPES.map((c) => c.id)).toEqual([
      'platformer',
      'shooter',
      'puzzle',
      'explorer',
    ]);
  });

  it('gives every card a label, description and non-empty placeholder', () => {
    for (const card of QUICK_START_GAME_TYPES) {
      expect(card.label.length).toBeGreaterThan(0);
      expect(card.description.length).toBeGreaterThan(0);
      // The placeholder is also the fallback prompt, so an empty one would send
      // a bare "Platformer:" to the pipeline.
      expect(card.placeholder.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('findQuickStartGameType', () => {
  it('returns the matching card', () => {
    expect(findQuickStartGameType('puzzle')?.label).toBe('Puzzle');
  });

  it('returns null for an unknown or missing id', () => {
    expect(findQuickStartGameType('roguelike')).toBeNull();
    expect(findQuickStartGameType(null)).toBeNull();
    expect(findQuickStartGameType(undefined)).toBeNull();
  });

  it('does not resolve inherited Object properties', () => {
    // `QUICK_START_GAME_TYPES.find` is array-based, but a future Record-based
    // rewrite must not let `constructor` / `__proto__` resolve to a truthy value.
    expect(findQuickStartGameType('constructor')).toBeNull();
    expect(findQuickStartGameType('__proto__')).toBeNull();
  });
});

describe('buildQuickStartPrompt', () => {
  const card = QUICK_START_GAME_TYPES[0];

  it('prefixes the card label onto what the user typed', () => {
    expect(buildQuickStartPrompt(card, 'a castle with lava pits')).toBe(
      'Platformer: a castle with lava pits'
    );
  });

  it('trims the typed prompt', () => {
    expect(buildQuickStartPrompt(card, '  a castle  ')).toBe('Platformer: a castle');
  });

  it('falls back to the placeholder when the prompt is blank', () => {
    expect(buildQuickStartPrompt(card, '   ')).toBe(`Platformer: ${card.placeholder}`);
    expect(buildQuickStartPrompt(card, '')).toBe(`Platformer: ${card.placeholder}`);
  });
});
