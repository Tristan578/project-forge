import { describe, it, expect } from 'vitest';
import {
  GENRE_CATALOG,
  MECHANIC_CATALOG,
  filterGenres,
  filterMechanics,
  scoreIdea,
  seededRandom,
  generateIdea,
  generateIdeas,
  buildGddPrompt,
  type GenreMix,
  type MechanicCombo,
} from '../ideaGenerator';

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

describe('GENRE_CATALOG', () => {
  it('contains at least 10 genres', () => {
    expect(GENRE_CATALOG.length).toBeGreaterThanOrEqual(10);
  });

  it('each genre has required fields', () => {
    for (const genre of GENRE_CATALOG) {
      expect(genre.id).not.toBeNull();
      expect(genre.name).not.toBeNull();
      expect(genre.description).not.toBeNull();
      expect(typeof genre.trending).toBe('boolean');
      expect(genre.tags.length).toBeGreaterThan(0);
    }
  });

  it('has unique genre IDs', () => {
    const ids = GENRE_CATALOG.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes some trending genres', () => {
    const trending = GENRE_CATALOG.filter((g) => g.trending);
    expect(trending.length).toBeGreaterThan(0);
  });
});

describe('MECHANIC_CATALOG', () => {
  it('contains at least 10 mechanics', () => {
    expect(MECHANIC_CATALOG.length).toBeGreaterThanOrEqual(10);
  });

  it('each mechanic has required fields', () => {
    for (const mechanic of MECHANIC_CATALOG) {
      expect(mechanic.id).not.toBeNull();
      expect(mechanic.name).not.toBeNull();
      expect(mechanic.description).not.toBeNull();
      expect(['low', 'medium', 'high']).toContain(mechanic.complexity);
      expect(mechanic.tags.length).toBeGreaterThan(0);
    }
  });

  it('has unique mechanic IDs', () => {
    const ids = MECHANIC_CATALOG.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes all complexity levels', () => {
    const complexities = new Set(MECHANIC_CATALOG.map((m) => m.complexity));
    expect(complexities.has('low')).toBe(true);
    expect(complexities.has('medium')).toBe(true);
    expect(complexities.has('high')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

describe('filterGenres', () => {
  it('returns all genres with empty filters', () => {
    const result = filterGenres(GENRE_CATALOG, {});
    expect(result).toEqual(GENRE_CATALOG);
  });

  it('filters by genre IDs', () => {
    const result = filterGenres(GENRE_CATALOG, { genreIds: ['platformer', 'puzzle'] });
    expect(result.length).toBe(2);
    expect(result.map((g) => g.id)).toEqual(['platformer', 'puzzle']);
  });

  it('filters by trending only', () => {
    const result = filterGenres(GENRE_CATALOG, { trendingOnly: true });
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((g) => g.trending)).toBe(true);
  });

  it('combines genre ID and trending filters', () => {
    const result = filterGenres(GENRE_CATALOG, {
      genreIds: ['platformer', 'rpg', 'puzzle'],
      trendingOnly: true,
    });
    // platformer and puzzle are trending, rpg is not
    expect(result.every((g) => g.trending)).toBe(true);
    expect(result.map((g) => g.id)).not.toContain('rpg');
  });

  it('returns empty array when no genres match', () => {
    const result = filterGenres(GENRE_CATALOG, { genreIds: ['nonexistent'] });
    expect(result).toEqual([]);
  });
});

describe('filterMechanics', () => {
  it('returns all mechanics with empty filters', () => {
    const result = filterMechanics(MECHANIC_CATALOG, {});
    expect(result).toEqual(MECHANIC_CATALOG);
  });

  it('filters by mechanic IDs', () => {
    const result = filterMechanics(MECHANIC_CATALOG, { mechanicIds: ['crafting', 'stealth'] });
    expect(result.length).toBe(2);
  });

  it('filters by max complexity low', () => {
    const result = filterMechanics(MECHANIC_CATALOG, { maxComplexity: 'low' });
    expect(result.every((m) => m.complexity === 'low')).toBe(true);
  });

  it('filters by max complexity medium (includes low)', () => {
    const result = filterMechanics(MECHANIC_CATALOG, { maxComplexity: 'medium' });
    expect(result.every((m) => m.complexity !== 'high')).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('max complexity high returns all mechanics', () => {
    const result = filterMechanics(MECHANIC_CATALOG, { maxComplexity: 'high' });
    expect(result).toEqual(MECHANIC_CATALOG);
  });
});

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

describe('scoreIdea', () => {
  const platformer = GENRE_CATALOG.find((g) => g.id === 'platformer')!;
  const puzzle = GENRE_CATALOG.find((g) => g.id === 'puzzle')!;
  const rpg = GENRE_CATALOG.find((g) => g.id === 'rpg')!;

  const crafting = MECHANIC_CATALOG.find((m) => m.id === 'crafting')!;
  const comboChain = MECHANIC_CATALOG.find((m) => m.id === 'combo-chain')!;
  const resourceLoop = MECHANIC_CATALOG.find((m) => m.id === 'resource-loop')!;
  const timeRewind = MECHANIC_CATALOG.find((m) => m.id === 'time-rewind')!;

  it('returns a number between 0 and 100', () => {
    const mix: GenreMix = { primary: platformer, secondary: puzzle };
    const combo: MechanicCombo = { mechanics: [crafting, comboChain] };
    const score = scoreIdea(mix, combo);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('penalizes identical genres', () => {
    const sameMix: GenreMix = { primary: platformer, secondary: platformer };
    const diffMix: GenreMix = { primary: platformer, secondary: puzzle };
    const combo: MechanicCombo = { mechanics: [crafting] };
    const sameScore = scoreIdea(sameMix, combo);
    const diffScore = scoreIdea(diffMix, combo);
    expect(diffScore).toBeGreaterThan(sameScore);
  });

  it('rewards trending genres', () => {
    // platformer is trending, rpg is not
    const trendingMix: GenreMix = { primary: platformer, secondary: puzzle };
    const nonTrendingMix: GenreMix = { primary: rpg, secondary: rpg };
    const combo: MechanicCombo = { mechanics: [resourceLoop] };
    const trendingScore = scoreIdea(trendingMix, combo);
    const nonTrendingScore = scoreIdea(nonTrendingMix, combo);
    expect(trendingScore).toBeGreaterThan(nonTrendingScore);
  });

  it('rewards complexity variety', () => {
    const mix: GenreMix = { primary: platformer, secondary: puzzle };
    const varied: MechanicCombo = { mechanics: [resourceLoop, timeRewind] }; // low + high
    const uniform: MechanicCombo = { mechanics: [resourceLoop, resourceLoop] }; // low + low (same complexity)
    const variedScore = scoreIdea(mix, varied);
    const uniformScore = scoreIdea(mix, uniform);
    expect(variedScore).toBeGreaterThan(uniformScore);
  });

  it('rewards mechanic-genre tag overlap', () => {
    const mix: GenreMix = { primary: platformer, secondary: puzzle };
    // comboChain has 'action' tag matching platformer's 'action' tag
    const overlapping: MechanicCombo = { mechanics: [comboChain] };
    // dialogue-choices has 'rpg' and 'story' tags — no overlap with platformer+puzzle
    const dialogueChoices = MECHANIC_CATALOG.find((m) => m.id === 'dialogue-choices')!;
    const nonOverlapping: MechanicCombo = { mechanics: [dialogueChoices] };
    const overlapScore = scoreIdea(mix, overlapping);
    const noOverlapScore = scoreIdea(mix, nonOverlapping);
    expect(overlapScore).toBeGreaterThan(noOverlapScore);
  });
});

// ---------------------------------------------------------------------------
// Seeded Random
// ---------------------------------------------------------------------------

describe('seededRandom', () => {
  it('produces deterministic results for same seed', () => {
    const rng1 = seededRandom(42);
    const rng2 = seededRandom(42);
    const results1 = Array.from({ length: 10 }, () => rng1());
    const results2 = Array.from({ length: 10 }, () => rng2());
    expect(results1).toEqual(results2);
  });

  it('produces different results for different seeds', () => {
    const rng1 = seededRandom(42);
    const rng2 = seededRandom(99);
    const results1 = Array.from({ length: 10 }, () => rng1());
    const results2 = Array.from({ length: 10 }, () => rng2());
    expect(results1).not.toEqual(results2);
  });

  it('produces values between 0 and 1', () => {
    const rng = seededRandom(123);
    for (let i = 0; i < 100; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Idea Generation
// ---------------------------------------------------------------------------

describe('generateIdea', () => {
  it('returns a valid GameIdea', () => {
    const rng = seededRandom(42);
    const idea = generateIdea({}, rng);
    expect(idea.id).not.toBeNull();
    expect(idea.title).not.toBeNull();
    expect(idea.description).not.toBeNull();
    expect(idea.genreMix.primary).not.toBeNull();
    expect(idea.genreMix.secondary).not.toBeNull();
    expect(idea.mechanicCombo.mechanics.length).toBeGreaterThan(0);
    expect(idea.score).toBeGreaterThanOrEqual(0);
    expect(idea.score).toBeLessThanOrEqual(100);
    expect(idea.hooks.length).toBeGreaterThan(0);
    expect(idea.targetAudience).not.toBeNull();
  });

  it('produces deterministic results with same seed', () => {
    const idea1 = generateIdea({}, seededRandom(42));
    const idea2 = generateIdea({}, seededRandom(42));
    expect(idea1.title).toBe(idea2.title);
    expect(idea1.genreMix.primary.id).toBe(idea2.genreMix.primary.id);
    expect(idea1.genreMix.secondary.id).toBe(idea2.genreMix.secondary.id);
  });

  it('respects genre filters', () => {
    const rng = seededRandom(55);
    const idea = generateIdea({ genreIds: ['platformer', 'puzzle', 'roguelike'] }, rng);
    const allowedIds = ['platformer', 'puzzle', 'roguelike'];
    expect(allowedIds).toContain(idea.genreMix.primary.id);
    expect(allowedIds).toContain(idea.genreMix.secondary.id);
  });

  it('respects mechanic filters', () => {
    const rng = seededRandom(77);
    const idea = generateIdea({ mechanicIds: ['crafting', 'stealth'] }, rng);
    const allowedIds = ['crafting', 'stealth'];
    for (const m of idea.mechanicCombo.mechanics) {
      expect(allowedIds).toContain(m.id);
    }
  });

  it('falls back to full catalog when too few genres after filtering', () => {
    const rng = seededRandom(88);
    // Only 1 genre selected — should fall back
    const idea = generateIdea({ genreIds: ['platformer'] }, rng);
    expect(idea.genreMix.primary).not.toBeNull();
    expect(idea.genreMix.secondary).not.toBeNull();
  });

  it('handles trending-only filter', () => {
    const rng = seededRandom(99);
    const idea = generateIdea({ trendingOnly: true }, rng);
    expect(idea.genreMix.primary.trending).toBe(true);
    expect(idea.genreMix.secondary.trending).toBe(true);
  });
});

describe('generateIdeas', () => {
  it('returns the requested number of ideas', () => {
    const rng = seededRandom(42);
    const ideas = generateIdeas(5, {}, rng);
    expect(ideas.length).toBe(5);
  });

  it('sorts ideas by score descending', () => {
    const rng = seededRandom(42);
    const ideas = generateIdeas(10, {}, rng);
    for (let i = 1; i < ideas.length; i++) {
      expect(ideas[i - 1].score).toBeGreaterThanOrEqual(ideas[i].score);
    }
  });

  it('generates unique IDs', () => {
    const rng = seededRandom(42);
    const ideas = generateIdeas(10, {}, rng);
    const ids = ideas.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns empty array for count 0', () => {
    const ideas = generateIdeas(0);
    expect(ideas).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GDD Prompt Builder
// ---------------------------------------------------------------------------

describe('buildGddPrompt', () => {
  it('includes the idea title', () => {
    const rng = seededRandom(42);
    const idea = generateIdea({}, rng);
    const prompt = buildGddPrompt(idea);
    expect(prompt).toContain(idea.title);
  });

  it('includes genre names', () => {
    const rng = seededRandom(42);
    const idea = generateIdea({}, rng);
    const prompt = buildGddPrompt(idea);
    expect(prompt).toContain(idea.genreMix.primary.name);
    expect(prompt).toContain(idea.genreMix.secondary.name);
  });

  it('includes mechanic names', () => {
    const rng = seededRandom(42);
    const idea = generateIdea({}, rng);
    const prompt = buildGddPrompt(idea);
    for (const m of idea.mechanicCombo.mechanics) {
      expect(prompt).toContain(m.name);
    }
  });

  it('includes target audience', () => {
    const rng = seededRandom(42);
    const idea = generateIdea({}, rng);
    const prompt = buildGddPrompt(idea);
    expect(prompt).toContain(idea.targetAudience);
  });

  it('includes GDD sections', () => {
    const rng = seededRandom(42);
    const idea = generateIdea({}, rng);
    const prompt = buildGddPrompt(idea);
    expect(prompt).toContain('Core gameplay loop');
    expect(prompt).toContain('Art style');
    expect(prompt).toContain('Progression system');
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('generates idea with maxComplexity low filter', () => {
    const rng = seededRandom(42);
    const idea = generateIdea({ maxComplexity: 'low' }, rng);
    for (const m of idea.mechanicCombo.mechanics) {
      expect(m.complexity).toBe('low');
    }
  });

  it('scoreIdea handles single mechanic', () => {
    const genre1 = GENRE_CATALOG[0];
    const genre2 = GENRE_CATALOG[1];
    const mix: GenreMix = { primary: genre1, secondary: genre2 };
    const combo: MechanicCombo = { mechanics: [MECHANIC_CATALOG[0]] };
    const score = scoreIdea(mix, combo);
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('scoreIdea handles empty mechanics', () => {
    const genre1 = GENRE_CATALOG[0];
    const genre2 = GENRE_CATALOG[1];
    const mix: GenreMix = { primary: genre1, secondary: genre2 };
    const combo: MechanicCombo = { mechanics: [] };
    const score = scoreIdea(mix, combo);
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('filterGenres with empty genreIds array returns all', () => {
    const result = filterGenres(GENRE_CATALOG, { genreIds: [] });
    expect(result).toEqual(GENRE_CATALOG);
  });

  it('filterMechanics with empty mechanicIds array returns all', () => {
    const result = filterMechanics(MECHANIC_CATALOG, { mechanicIds: [] });
    expect(result).toEqual(MECHANIC_CATALOG);
  });
});
