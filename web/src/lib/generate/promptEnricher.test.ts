import { describe, it, expect } from 'vitest';
import {
  enrichPrompt,
  enrichSfxPrompt,
  enrichMusicPrompt,
  enrichVoiceStyle,
  getEnrichmentContext,
} from './promptEnricher';

/** Minimal mock of EditorState for testing enrichment. */
function mockStore(overrides: {
  projectType?: '2d' | '3d';
  sceneName?: string;
  nodes?: Record<string, { entityId: string; name: string; parentId: string | null; children: string[]; components: string[]; visible: boolean }>;
  allGameComponents?: Record<string, Array<{ type: string }>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} = {}): any {
  return {
    projectType: overrides.projectType ?? '3d',
    sceneName: overrides.sceneName ?? 'Untitled',
    sceneGraph: { nodes: overrides.nodes ?? {}, rootIds: Object.keys(overrides.nodes ?? {}) },
    allGameComponents: overrides.allGameComponents ?? {},
  };
}

describe('getEnrichmentContext', () => {
  it('extracts project type and scene name', () => {
    const ctx = getEnrichmentContext(mockStore({ projectType: '2d', sceneName: 'Level 1' }));
    expect(ctx.projectType).toBe('2d');
    expect(ctx.sceneName).toBe('Level 1');
  });

  it('filters out Camera from entity names', () => {
    const ctx = getEnrichmentContext(mockStore({
      nodes: {
        'e1': { entityId: 'e1', name: 'Camera', parentId: null, children: [], components: [], visible: true },
        'e2': { entityId: 'e2', name: 'Player', parentId: null, children: [], components: [], visible: true },
      },
    }));
    expect(ctx.entityNames).toEqual(['Player']);
  });

  it('collects unique game component types', () => {
    const ctx = getEnrichmentContext(mockStore({
      allGameComponents: {
        'e1': [{ type: 'characterController' }, { type: 'health' }],
        'e2': [{ type: 'health' }, { type: 'collectible' }],
      },
    }));
    expect(ctx.gameComponentTypes).toContain('characterController');
    expect(ctx.gameComponentTypes).toContain('health');
    expect(ctx.gameComponentTypes).toContain('collectible');
    expect(ctx.gameComponentTypes).toHaveLength(3);
  });

  it('infers platformer genre', () => {
    const ctx = getEnrichmentContext(mockStore({
      nodes: {
        'e1': { entityId: 'e1', name: 'Platform', parentId: null, children: [], components: [], visible: true },
        'e2': { entityId: 'e2', name: 'Player', parentId: null, children: [], components: [], visible: true },
      },
    }));
    expect(ctx.inferredGenre).toBe('platformer');
  });

  it('returns null genre when no signals present', () => {
    const ctx = getEnrichmentContext(mockStore({
      nodes: {
        'e1': { entityId: 'e1', name: 'Cube', parentId: null, children: [], components: [], visible: true },
      },
    }));
    expect(ctx.inferredGenre).toBeNull();
  });
});

describe('enrichPrompt', () => {
  it('adds 3D game asset context for model generation', () => {
    const result = enrichPrompt('treasure chest', 'model', mockStore());
    expect(result).toContain('3D game asset');
    expect(result).toContain('game-ready 3D model');
    expect(result).toContain('treasure chest');
  });

  it('adds 2D game asset context for sprite generation', () => {
    const result = enrichPrompt('hero character', 'sprite', mockStore({ projectType: '2d' }));
    expect(result).toContain('2D game asset');
    expect(result).toContain('game sprite');
    expect(result).toContain('hero character');
  });

  it('includes genre when inferred', () => {
    const store = mockStore({
      nodes: {
        'e1': { entityId: 'e1', name: 'Platform', parentId: null, children: [], components: [], visible: true },
      },
    });
    const result = enrichPrompt('tree', 'model', store);
    expect(result).toContain('platformer game');
  });

  it('includes scene name when not Untitled', () => {
    const result = enrichPrompt('rock', 'model', mockStore({ sceneName: 'Forest Level' }));
    expect(result).toContain('Forest Level');
  });

  it('omits scene name when Untitled', () => {
    const result = enrichPrompt('rock', 'model', mockStore({ sceneName: 'Untitled' }));
    expect(result).not.toContain('Untitled');
  });

  it('does not enrich voice prompts', () => {
    const result = enrichPrompt('Hello world', 'voice', mockStore());
    expect(result).toBe('Hello world');
  });

  it('adds game context to skybox without duplicating format hints', () => {
    const store = mockStore({
      sceneName: 'Desert',
      nodes: {
        'e1': { entityId: 'e1', name: 'Dragon', parentId: null, children: [], components: [], visible: true },
      },
    });
    const result = enrichPrompt('sunset sky', 'skybox', store);
    expect(result).toContain('fantasy game');
    expect(result).toContain('scene: Desert');
    expect(result).toContain('sunset sky');
  });

  it('adds texture-specific hints', () => {
    const result = enrichPrompt('brick wall', 'texture', mockStore());
    expect(result).toContain('PBR material texture');
    expect(result).toContain('seamless and tileable');
  });

  it('adds music-specific hints to enrichPrompt', () => {
    // enrichPrompt for music just uses the generic path
    const result = enrichPrompt('battle theme', 'music', mockStore());
    expect(result).toContain('game soundtrack');
    expect(result).toContain('loopable');
  });
});

describe('enrichSfxPrompt', () => {
  it('adds game sound effect context', () => {
    const result = enrichSfxPrompt('whoosh', undefined, mockStore());
    expect(result).toContain('game sound effect');
    expect(result).toContain('whoosh');
  });

  it('classifies explosion entity as impact sound', () => {
    const result = enrichSfxPrompt('boom', 'Explosion_FX', mockStore());
    expect(result).toContain('impact/explosion');
  });

  it('classifies UI entity as UI sound', () => {
    const result = enrichSfxPrompt('click', 'Button_Click', mockStore());
    expect(result).toContain('UI sound');
  });

  it('includes genre context', () => {
    const store = mockStore({
      nodes: {
        'e1': { entityId: 'e1', name: 'Spaceship', parentId: null, children: [], components: [], visible: true },
      },
    });
    const result = enrichSfxPrompt('laser', 'Laser', store);
    expect(result).toContain('space game');
  });
});

describe('enrichMusicPrompt', () => {
  it('adds loopable game soundtrack context', () => {
    const result = enrichMusicPrompt('epic battle', mockStore());
    expect(result).toContain('game soundtrack');
    expect(result).toContain('loopable');
    expect(result).toContain('epic battle');
  });

  it('includes scene name', () => {
    const result = enrichMusicPrompt('calm', mockStore({ sceneName: 'Village' }));
    expect(result).toContain('scene "Village"');
  });
});

describe('enrichVoiceStyle', () => {
  it('returns base style when no speaker', () => {
    expect(enrichVoiceStyle(undefined, 'neutral')).toBe('neutral');
  });

  it('maps villain speaker to sinister', () => {
    expect(enrichVoiceStyle('Dark Villain', 'neutral')).toBe('sinister');
  });

  it('maps hero speaker to excited', () => {
    expect(enrichVoiceStyle('Brave Hero', 'neutral')).toBe('excited');
  });

  it('maps elder speaker to calm', () => {
    expect(enrichVoiceStyle('Wise Elder', 'neutral')).toBe('calm');
  });

  it('maps child speaker to friendly', () => {
    expect(enrichVoiceStyle('Child NPC', 'neutral')).toBe('friendly');
  });

  it('preserves base style for unknown speakers', () => {
    expect(enrichVoiceStyle('Bob', 'excited')).toBe('excited');
  });
});
