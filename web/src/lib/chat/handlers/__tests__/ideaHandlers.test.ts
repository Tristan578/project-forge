import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ideaHandlers } from '../ideaHandlers';
import type { ToolCallContext } from '../types';

// ---------------------------------------------------------------------------
// Mock compoundHandlers (dynamic import inside start_from_idea)
// ---------------------------------------------------------------------------

vi.mock('@/lib/chat/handlers/compoundHandlers', () => ({
  compoundHandlers: {
    create_scene: vi.fn().mockResolvedValue({
      success: true,
      result: { message: 'Scene created' },
    }),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(): ToolCallContext {
  return {
    store: {
      sceneGraph: { nodes: {} },
    } as unknown as ToolCallContext['store'],
    dispatchCommand: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// generate_game_ideas
// ---------------------------------------------------------------------------

describe('ideaHandlers.generate_game_ideas', () => {
  it('returns 3 ideas by default', async () => {
    const result = await ideaHandlers['generate_game_ideas']({}, makeCtx());
    expect(result.success).toBe(true);
    const ideas = (result.result as { ideas: unknown[] }).ideas;
    expect(ideas.length).toBe(3);
  });

  it('respects count parameter', async () => {
    const result = await ideaHandlers['generate_game_ideas']({ count: 2 }, makeCtx());
    expect(result.success).toBe(true);
    const ideas = (result.result as { ideas: unknown[] }).ideas;
    expect(ideas.length).toBe(2);
  });

  it('returns max 5 ideas', async () => {
    const result = await ideaHandlers['generate_game_ideas']({ count: 5 }, makeCtx());
    expect(result.success).toBe(true);
    const ideas = (result.result as { ideas: unknown[] }).ideas;
    expect(ideas.length).toBe(5);
  });

  it('rejects count > 5', async () => {
    const result = await ideaHandlers['generate_game_ideas']({ count: 10 }, makeCtx());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments');
  });

  it('each idea has required fields', async () => {
    const result = await ideaHandlers['generate_game_ideas']({ count: 1 }, makeCtx());
    expect(result.success).toBe(true);
    const ideas = (result.result as { ideas: Record<string, unknown>[] }).ideas;
    const idea = ideas[0];
    expect(idea.id).toBeTruthy();
    expect(idea.title).toBeTruthy();
    expect(idea.description).toBeTruthy();
    expect(idea.primaryGenre).toBeTruthy();
    expect(idea.secondaryGenre).toBeTruthy();
    expect(Array.isArray(idea.mechanics)).toBe(true);
    expect(typeof idea.score).toBe('number');
    expect(Array.isArray(idea.hooks)).toBe(true);
    expect(idea.targetAudience).toBeTruthy();
    expect(idea.templateMatch).toBeTruthy();
  });

  it('filters by genreIds', async () => {
    const result = await ideaHandlers['generate_game_ideas'](
      { count: 3, genreIds: ['platformer', 'puzzle'] },
      makeCtx()
    );
    expect(result.success).toBe(true);
    const ideas = (result.result as { ideas: Record<string, unknown>[] }).ideas;
    for (const idea of ideas) {
      const allowed = ['Platformer', 'Puzzle'];
      expect(allowed).toContain(idea.primaryGenre);
      expect(allowed).toContain(idea.secondaryGenre);
    }
  });

  it('filters by maxComplexity low', async () => {
    const result = await ideaHandlers['generate_game_ideas'](
      { count: 1, maxComplexity: 'low' },
      makeCtx()
    );
    expect(result.success).toBe(true);
  });

  it('filters by trendingOnly', async () => {
    const result = await ideaHandlers['generate_game_ideas'](
      { count: 2, trendingOnly: true },
      makeCtx()
    );
    expect(result.success).toBe(true);
  });

  it('returns message with idea count', async () => {
    const result = await ideaHandlers['generate_game_ideas']({ count: 2 }, makeCtx());
    expect(result.success).toBe(true);
    expect(result.message).toContain('2 game ideas');
  });

  it('returns singular message for count 1', async () => {
    const result = await ideaHandlers['generate_game_ideas']({ count: 1 }, makeCtx());
    expect(result.success).toBe(true);
    expect(result.message).toContain('1 game idea');
  });
});

// ---------------------------------------------------------------------------
// get_idea_details
// ---------------------------------------------------------------------------

describe('ideaHandlers.get_idea_details', () => {
  it('generates an idea with no params', async () => {
    const result = await ideaHandlers['get_idea_details']({}, makeCtx());
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.title).toBeTruthy();
    expect(typeof r.gddOutlinePrompt).toBe('string');
    expect((r.gddOutlinePrompt as string).length).toBeGreaterThan(50);
  });

  it('uses provided genre names', async () => {
    const result = await ideaHandlers['get_idea_details'](
      { primaryGenre: 'platformer', secondaryGenre: 'puzzle' },
      makeCtx()
    );
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.gddOutlinePrompt).toBeTruthy();
  });

  it('applies title override', async () => {
    const result = await ideaHandlers['get_idea_details'](
      { primaryGenre: 'platformer', secondaryGenre: 'roguelike', title: 'My Epic Game' },
      makeCtx()
    );
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.title).toBe('My Epic Game');
    expect((r.gddOutlinePrompt as string)).toContain('My Epic Game');
  });

  it('includes GDD sections in the prompt', async () => {
    const result = await ideaHandlers['get_idea_details'](
      { primaryGenre: 'roguelike', secondaryGenre: 'rpg' },
      makeCtx()
    );
    const r = result.result as Record<string, unknown>;
    const prompt = r.gddOutlinePrompt as string;
    expect(prompt).toContain('Core gameplay loop');
    expect(prompt).toContain('Art style');
    expect(prompt).toContain('Progression system');
  });

  it('returns idea sub-object with mechanics', async () => {
    const result = await ideaHandlers['get_idea_details']({}, makeCtx());
    const r = result.result as Record<string, unknown>;
    const idea = r.idea as Record<string, unknown>;
    expect(Array.isArray(idea.mechanics)).toBe(true);
    expect(typeof idea.score).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// start_from_idea
// ---------------------------------------------------------------------------

describe('ideaHandlers.start_from_idea', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires title, primaryGenre, secondaryGenre', async () => {
    const result = await ideaHandlers['start_from_idea']({}, makeCtx());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments');
  });

  it('scaffolds a project successfully', async () => {
    const result = await ideaHandlers['start_from_idea'](
      {
        title: 'Shadow Forge',
        primaryGenre: 'platformer',
        secondaryGenre: 'roguelike',
      },
      makeCtx()
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain('Shadow Forge');
  });

  it('includes template and project type in result', async () => {
    const result = await ideaHandlers['start_from_idea'](
      {
        title: 'Neon Run',
        primaryGenre: 'platformer',
        secondaryGenre: 'puzzle',
      },
      makeCtx()
    );
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.templateUsed).toBeTruthy();
    expect(['2d', '3d']).toContain(r.projectType);
    expect(r.sceneName).toBeTruthy();
  });

  it('uses explicit templateMatch when provided', async () => {
    const result = await ideaHandlers['start_from_idea'](
      {
        title: 'Void Explorer',
        primaryGenre: 'rpg',
        secondaryGenre: 'simulation',
        templateMatch: 'explorer',
      },
      makeCtx()
    );
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.templateUsed).toBe('explorer');
  });

  it('includes mechanics in result', async () => {
    const result = await ideaHandlers['start_from_idea'](
      {
        title: 'Pixel Quest',
        primaryGenre: 'puzzle',
        secondaryGenre: 'idle',
        mechanics: ['crafting', 'stealth'],
      },
      makeCtx()
    );
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(Array.isArray(r.mechanics)).toBe(true);
    expect(r.mechanics).toContain('crafting');
  });
});

// ---------------------------------------------------------------------------
// remix_idea
// ---------------------------------------------------------------------------

describe('ideaHandlers.remix_idea', () => {
  it('requires primaryGenre and secondaryGenre', async () => {
    const result = await ideaHandlers['remix_idea']({}, makeCtx());
    expect(result.success).toBe(false);
  });

  it('remixes the mechanic dimension by default', async () => {
    const result = await ideaHandlers['remix_idea'](
      { primaryGenre: 'platformer', secondaryGenre: 'puzzle' },
      makeCtx()
    );
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.dimensionChanged).toBe('mechanic');
  });

  it('remixes the genre dimension when specified', async () => {
    const result = await ideaHandlers['remix_idea'](
      { primaryGenre: 'platformer', secondaryGenre: 'puzzle', dimension: 'genre' },
      makeCtx()
    );
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.dimensionChanged).toBe('genre');
  });

  it('remixes both dimensions', async () => {
    const result = await ideaHandlers['remix_idea'](
      {
        primaryGenre: 'roguelike',
        secondaryGenre: 'survival',
        mechanics: ['crafting', 'deck-building'],
        dimension: 'both',
      },
      makeCtx()
    );
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.dimensionChanged).toBe('both');
  });

  it('returns a valid idea structure', async () => {
    const result = await ideaHandlers['remix_idea'](
      { primaryGenre: 'shooter', secondaryGenre: 'rpg' },
      makeCtx()
    );
    expect(result.success).toBe(true);
    const r = result.result as Record<string, unknown>;
    expect(r.id).toBeTruthy();
    expect(r.title).toBeTruthy();
    expect(r.description).toBeTruthy();
    expect(Array.isArray(r.mechanics)).toBe(true);
    expect(typeof r.score).toBe('number');
    expect(r.templateMatch).toBeTruthy();
  });

  it('rejects invalid dimension enum', async () => {
    const result = await ideaHandlers['remix_idea'](
      { primaryGenre: 'platformer', secondaryGenre: 'puzzle', dimension: 'art' },
      makeCtx()
    );
    expect(result.success).toBe(false);
  });
});
