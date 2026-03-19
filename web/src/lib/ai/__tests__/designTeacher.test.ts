import { describe, it, expect } from 'vitest';
import {
  DESIGN_PRINCIPLES,
  suggestLessons,
  explainDecision,
  generateDesignCritique,
  searchPrinciples,
  getPrinciplesByCategory,
  type TeacherSceneContext,
  type DesignCategory,
} from '../designTeacher';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<TeacherSceneContext> = {}): TeacherSceneContext {
  return {
    entityCount: 0,
    entities: [],
    lightCount: 0,
    hasShadows: false,
    hasPhysicsGround: false,
    hasDynamicBodies: false,
    hasPlayerCharacter: false,
    hasCollectibles: false,
    hasEnemies: false,
    hasWinCondition: false,
    hasUI: false,
    hasDialogue: false,
    projectType: '3d',
    ...overrides,
  };
}

function makeEntity(overrides: Partial<TeacherSceneContext['entities'][0]> = {}) {
  return {
    name: 'TestEntity',
    entityType: 'mesh',
    components: [],
    hasPhysics: false,
    hasScript: false,
    hasAudio: false,
    hasAnimation: false,
    hasGameComponent: false,
    gameComponentTypes: [],
    position: [0, 0, 0] as [number, number, number],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DESIGN_PRINCIPLES catalog
// ---------------------------------------------------------------------------

describe('DESIGN_PRINCIPLES catalog', () => {
  it('has at least 20 principles', () => {
    expect(DESIGN_PRINCIPLES.length).toBeGreaterThanOrEqual(20);
  });

  it('every principle has required fields', () => {
    for (const p of DESIGN_PRINCIPLES) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(p.category).toBeTruthy();
      expect(p.description.length).toBeGreaterThan(10);
      expect(p.example.length).toBeGreaterThan(10);
      expect(p.keywords.length).toBeGreaterThan(0);
    }
  });

  it('every principle has a unique id', () => {
    const ids = DESIGN_PRINCIPLES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers all six categories', () => {
    const categories = new Set(DESIGN_PRINCIPLES.map((p) => p.category));
    const expected: DesignCategory[] = [
      'mechanics',
      'level_design',
      'narrative',
      'balance',
      'ux',
      'aesthetics',
    ];
    for (const c of expected) {
      expect(categories.has(c)).toBe(true);
    }
  });

  it('every principle id is lowercase kebab-case', () => {
    for (const p of DESIGN_PRINCIPLES) {
      expect(p.id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});

// ---------------------------------------------------------------------------
// suggestLessons
// ---------------------------------------------------------------------------

describe('suggestLessons', () => {
  it('returns KISS lesson for empty scene', () => {
    const lessons = suggestLessons(makeCtx());
    expect(lessons.length).toBe(1);
    expect(lessons[0].principle).toContain('KISS');
  });

  it('returns progressive disclosure when player but no objects', () => {
    const ctx = makeCtx({
      entityCount: 1,
      entities: [makeEntity({ hasGameComponent: true, gameComponentTypes: ['characterController'] })],
      hasPlayerCharacter: true,
    });
    const lessons = suggestLessons(ctx);
    const names = lessons.map((l) => l.principle);
    expect(names).toContain('Progressive Disclosure');
  });

  it('returns agency lesson when collectibles but no win condition', () => {
    const ctx = makeCtx({
      entityCount: 3,
      entities: [makeEntity()],
      hasCollectibles: true,
      hasWinCondition: false,
    });
    const lessons = suggestLessons(ctx);
    const names = lessons.map((l) => l.principle);
    expect(names).toContain('Player Agency');
  });

  it('returns safe space lesson when dynamic bodies but no ground', () => {
    const ctx = makeCtx({
      entityCount: 2,
      entities: [makeEntity({ hasPhysics: true })],
      hasDynamicBodies: true,
      hasPhysicsGround: false,
    });
    const lessons = suggestLessons(ctx);
    const names = lessons.map((l) => l.principle);
    expect(names).toContain('Safe Experimentation Space');
  });

  it('returns juice lesson when multiple entities but no audio', () => {
    const ctx = makeCtx({
      entityCount: 5,
      entities: Array.from({ length: 5 }, () => makeEntity()),
    });
    const lessons = suggestLessons(ctx);
    const names = lessons.map((l) => l.principle);
    expect(names).toContain('Juice / Game Feel');
  });

  it('returns pacing lesson for large scene', () => {
    const entities = Array.from({ length: 20 }, () => makeEntity());
    const ctx = makeCtx({ entityCount: 20, entities });
    const lessons = suggestLessons(ctx);
    const names = lessons.map((l) => l.principle);
    expect(names).toContain('Pacing');
  });

  it('returns risk/reward when player + enemies but no health', () => {
    const ctx = makeCtx({
      entityCount: 3,
      entities: [
        makeEntity({ hasGameComponent: true, gameComponentTypes: ['characterController'] }),
        makeEntity({ gameComponentTypes: [] }),
      ],
      hasPlayerCharacter: true,
      hasEnemies: true,
    });
    const lessons = suggestLessons(ctx);
    const names = lessons.map((l) => l.principle);
    expect(names).toContain('Risk vs Reward');
  });

  it('returns color theory when no lights', () => {
    const ctx = makeCtx({
      entityCount: 3,
      entities: [makeEntity()],
      lightCount: 0,
    });
    const lessons = suggestLessons(ctx);
    const names = lessons.map((l) => l.principle);
    expect(names).toContain('Color Theory');
  });

  it('returns camera composition for 2D with enough entities', () => {
    const entities = Array.from({ length: 6 }, () => makeEntity());
    const ctx = makeCtx({ entityCount: 6, entities, projectType: '2d' });
    const lessons = suggestLessons(ctx);
    const names = lessons.map((l) => l.principle);
    expect(names).toContain('Camera Composition');
  });

  it('all returned lessons have valid structure', () => {
    const ctx = makeCtx({
      entityCount: 10,
      entities: Array.from({ length: 10 }, () => makeEntity()),
      hasPlayerCharacter: true,
      lightCount: 0,
    });
    const lessons = suggestLessons(ctx);
    for (const lesson of lessons) {
      expect(lesson.principle).toBeTruthy();
      expect(lesson.category).toBeTruthy();
      expect(lesson.explanation.length).toBeGreaterThan(10);
      expect(lesson.example.length).toBeGreaterThan(5);
      expect(lesson.relevance.length).toBeGreaterThan(5);
    }
  });
});

// ---------------------------------------------------------------------------
// explainDecision
// ---------------------------------------------------------------------------

describe('explainDecision', () => {
  it('returns principles for enemy-related decisions', () => {
    const result = explainDecision('Add enemy patrol', makeCtx());
    expect(result.principles).toContain('Risk vs Reward');
    expect(result.alternatives.length).toBeGreaterThan(0);
    expect(result.tradeoffs.length).toBeGreaterThan(0);
  });

  it('returns principles for collectible decisions', () => {
    const result = explainDecision('Add collectible coins', makeCtx());
    expect(result.principles).toContain('Juice / Game Feel');
  });

  it('returns principles for lighting decisions', () => {
    const result = explainDecision('Add shadow-casting light', makeCtx());
    expect(result.principles).toContain('Signposting');
    expect(result.principles).toContain('Color Theory');
  });

  it('returns principles for platform decisions', () => {
    const result = explainDecision('Add jump platforms', makeCtx());
    expect(result.principles).toContain('Flow Theory');
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  it('returns KISS as fallback for unrecognized decisions', () => {
    const result = explainDecision('Something completely unknown xyz', makeCtx());
    expect(result.principles).toContain('KISS (Keep It Simple)');
  });

  it('includes scene-aware reasoning with player character', () => {
    const ctx = makeCtx({ hasPlayerCharacter: true, entityCount: 1 });
    const result = explainDecision('Add enemy', ctx);
    expect(result.reasoning.some((r) => r.includes('player'))).toBe(true);
  });

  it('deduplicates principles', () => {
    const result = explainDecision('Add enemy hazard danger risk', makeCtx());
    const unique = new Set(result.principles);
    expect(unique.size).toBe(result.principles.length);
  });

  it('returns valid structure', () => {
    const result = explainDecision('Add a moving platform', makeCtx());
    expect(result.decision).toBe('Add a moving platform');
    expect(Array.isArray(result.reasoning)).toBe(true);
    expect(Array.isArray(result.principles)).toBe(true);
    expect(Array.isArray(result.alternatives)).toBe(true);
    expect(Array.isArray(result.tradeoffs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateDesignCritique
// ---------------------------------------------------------------------------

describe('generateDesignCritique', () => {
  it('returns low scores for empty scene', () => {
    const critique = generateDesignCritique(makeCtx());
    expect(critique.overallScore).toBeLessThanOrEqual(5);
    expect(critique.summary).toContain('empty');
  });

  it('scores KISS higher for small scenes', () => {
    const ctx = makeCtx({
      entityCount: 5,
      entities: Array.from({ length: 5 }, () => makeEntity()),
    });
    const critique = generateDesignCritique(ctx);
    const kissScore = critique.scores.find((s) => s.principle === 'KISS');
    expect(kissScore).toBeDefined();
    expect(kissScore!.score).toBeGreaterThanOrEqual(7);
  });

  it('scores juice higher with audio and animation', () => {
    const ctx = makeCtx({
      entityCount: 3,
      entities: [
        makeEntity({ hasAudio: true }),
        makeEntity({ hasAnimation: true }),
        makeEntity({ components: ['ParticleEnabled'] }),
      ],
      hasShadows: true,
    });
    const critique = generateDesignCritique(ctx);
    const juiceScore = critique.scores.find((s) => s.principle === 'Juice / Game Feel');
    expect(juiceScore).toBeDefined();
    expect(juiceScore!.score).toBeGreaterThanOrEqual(7);
  });

  it('scores gameplay loop higher with player + enemies + win condition', () => {
    const ctx = makeCtx({
      entityCount: 5,
      entities: Array.from({ length: 5 }, () => makeEntity()),
      hasPlayerCharacter: true,
      hasEnemies: true,
      hasWinCondition: true,
      hasDynamicBodies: true,
    });
    const critique = generateDesignCritique(ctx);
    const gameplayScore = critique.scores.find((s) => s.principle === 'Gameplay Loop');
    expect(gameplayScore).toBeDefined();
    expect(gameplayScore!.score).toBeGreaterThanOrEqual(7);
  });

  it('includes strengths and improvements', () => {
    const ctx = makeCtx({
      entityCount: 5,
      entities: Array.from({ length: 5 }, () => makeEntity()),
      lightCount: 2,
      hasShadows: true,
      hasPlayerCharacter: true,
    });
    const critique = generateDesignCritique(ctx);
    expect(critique.strengths.length + critique.improvements.length).toBeGreaterThan(0);
  });

  it('returns valid score structure', () => {
    const ctx = makeCtx({
      entityCount: 3,
      entities: Array.from({ length: 3 }, () => makeEntity()),
    });
    const critique = generateDesignCritique(ctx);
    expect(critique.scores.length).toBeGreaterThan(0);
    for (const score of critique.scores) {
      expect(score.principle).toBeTruthy();
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(10);
      expect(score.feedback.length).toBeGreaterThan(0);
    }
  });

  it('evaluates level layout for scenes with 5+ entities', () => {
    const entities = Array.from({ length: 6 }, (_, i) =>
      makeEntity({ position: [i * 5, 0, 0] }),
    );
    const ctx = makeCtx({ entityCount: 6, entities });
    const critique = generateDesignCritique(ctx);
    const layoutScore = critique.scores.find((s) => s.principle === 'Level Layout');
    expect(layoutScore).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// searchPrinciples
// ---------------------------------------------------------------------------

describe('searchPrinciples', () => {
  it('returns all principles for empty query', () => {
    expect(searchPrinciples('')).toEqual(DESIGN_PRINCIPLES);
  });

  it('finds principles by name', () => {
    const results = searchPrinciples('Flow');
    expect(results.some((p) => p.name === 'Flow Theory')).toBe(true);
  });

  it('finds principles by keyword', () => {
    const results = searchPrinciples('difficulty');
    expect(results.length).toBeGreaterThan(0);
  });

  it('finds principles by category', () => {
    const results = searchPrinciples('narrative');
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns empty for nonsense query', () => {
    const results = searchPrinciples('zzzzxyzzy999');
    expect(results.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getPrinciplesByCategory
// ---------------------------------------------------------------------------

describe('getPrinciplesByCategory', () => {
  it('returns mechanics principles', () => {
    const results = getPrinciplesByCategory('mechanics');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((p) => p.category === 'mechanics')).toBe(true);
  });

  it('returns aesthetics principles', () => {
    const results = getPrinciplesByCategory('aesthetics');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((p) => p.category === 'aesthetics')).toBe(true);
  });

  it('returns level_design principles', () => {
    const results = getPrinciplesByCategory('level_design');
    expect(results.length).toBeGreaterThan(0);
  });
});
