import { describe, it, expect } from 'vitest';
import {
  getEnrichmentContext,
  enrichPrompt,
  enrichVoiceStyle,
  enrichSfxPrompt,
  enrichMusicPrompt,
} from '../promptEnricher';
import type { EditorState } from '@/stores/editorStore';

function makeMockStore(overrides: Partial<EditorState> = {}): EditorState {
  return {
    projectType: '3d',
    sceneName: 'TestScene',
    sceneGraph: {
      nodes: {
        e1: { name: 'Player', entityId: 'e1', parentId: null, children: [], components: ['Transform'], visible: true },
        e2: { name: 'Platform', entityId: 'e2', parentId: null, children: [], components: ['Transform', 'Mesh3d'], visible: true },
        e3: { name: 'Camera', entityId: 'e3', parentId: null, children: [], components: ['Camera3d'], visible: true },
      },
      rootIds: ['e1', 'e2', 'e3'],
    },
    allGameComponents: {
      e1: [{ type: 'characterController', characterController: { speed: 5 } }],
    },
    ...overrides,
  } as unknown as EditorState;
}

describe('getEnrichmentContext', () => {
  it('should extract entity names (excluding Camera)', () => {
    const store = makeMockStore();
    const ctx = getEnrichmentContext(store);

    expect(ctx.entityNames).toContain('Player');
    expect(ctx.entityNames).toContain('Platform');
    expect(ctx.entityNames).not.toContain('Camera');
  });

  it('should count all entities', () => {
    const store = makeMockStore();
    const ctx = getEnrichmentContext(store);
    expect(ctx.entityCount).toBe(3);
  });

  it('should extract game component types', () => {
    const store = makeMockStore();
    const ctx = getEnrichmentContext(store);
    expect(ctx.gameComponentTypes).toContain('characterController');
  });

  it('should infer genre from components and names', () => {
    const store = makeMockStore({
      sceneGraph: {
        nodes: {
          e1: { name: 'Player', entityId: 'e1', parentId: null, children: [], components: [], visible: true },
          e2: { name: 'JumpPad', entityId: 'e2', parentId: null, children: [], components: [], visible: true },
        },
        rootIds: ['e1', 'e2'],
      } as never,
      allGameComponents: {
        e1: [{ type: 'characterController', characterController: { speed: 5 } } as never],
      },
    });
    const ctx = getEnrichmentContext(store);
    // "Jump" in entity name should trigger "platformer"
    expect(ctx.inferredGenre).toBe('platformer');
  });

  it('should return null genre when no pattern matches', () => {
    const store = makeMockStore({
      sceneGraph: {
        nodes: {
          e1: { name: 'EntityA', entityId: 'e1', parentId: null, children: [], components: [], visible: true },
        },
        rootIds: ['e1'],
      } as never,
      allGameComponents: {},
    });
    const ctx = getEnrichmentContext(store);
    expect(ctx.inferredGenre).toBeNull();
  });

  it('should report project type', () => {
    const store2d = makeMockStore({ projectType: '2d' } as never);
    expect(getEnrichmentContext(store2d).projectType).toBe('2d');

    const store3d = makeMockStore({ projectType: '3d' } as never);
    expect(getEnrichmentContext(store3d).projectType).toBe('3d');
  });

  it('should handle empty allGameComponents', () => {
    const store = makeMockStore({ allGameComponents: undefined as never });
    const ctx = getEnrichmentContext(store);
    expect(ctx.gameComponentTypes).toEqual([]);
  });
});

describe('enrichPrompt', () => {
  it('should enrich a model prompt with context', () => {
    const store = makeMockStore();
    const result = enrichPrompt('red dragon', 'model', store);

    expect(result).toContain('3D game asset');
    expect(result).toContain('real-time WebGPU');
    expect(result).toContain('game-ready 3D model');
    expect(result).toContain('red dragon');
  });

  it('should include scene name', () => {
    const store = makeMockStore({ sceneName: 'DungeonLevel' } as never);
    const result = enrichPrompt('torch', 'model', store);
    expect(result).toContain('DungeonLevel');
  });

  it('should skip scene name if Untitled', () => {
    const store = makeMockStore({ sceneName: 'Untitled' } as never);
    const result = enrichPrompt('cube', 'model', store);
    expect(result).not.toContain('Untitled');
  });

  it('should not enrich voice prompts', () => {
    const store = makeMockStore();
    const result = enrichPrompt('Hello world', 'voice', store);
    expect(result).toBe('Hello world');
  });

  it('should add 2D context for 2D projects', () => {
    const store = makeMockStore({ projectType: '2d' } as never);
    const result = enrichPrompt('character sprite', 'sprite', store);
    expect(result).toContain('2D game asset');
  });

  it('should add texture-specific hints', () => {
    const store = makeMockStore();
    const result = enrichPrompt('brick wall', 'texture', store);
    expect(result).toContain('PBR material texture');
    expect(result).toContain('seamless and tileable');
  });

  it('should handle skybox enrichment', () => {
    const store = makeMockStore({ sceneName: 'ForestLevel' } as never);
    const result = enrichPrompt('sunset panorama', 'skybox', store);
    expect(result).toContain('sunset panorama');
    expect(result).toContain('ForestLevel');
  });

  it('should include genre when inferred', () => {
    const store = makeMockStore({
      sceneGraph: {
        nodes: {
          e1: { name: 'Zombie', entityId: 'e1', parentId: null, children: [], components: [], visible: true },
        },
        rootIds: ['e1'],
      } as never,
      allGameComponents: {},
    });
    const result = enrichPrompt('dark corridor', 'model', store);
    expect(result).toContain('horror');
  });
});

describe('enrichVoiceStyle', () => {
  it('should return base style when no speaker', () => {
    expect(enrichVoiceStyle(undefined, 'neutral')).toBe('neutral');
  });

  it('should detect villain archetype', () => {
    expect(enrichVoiceStyle('Dark Villain', 'neutral')).toBe('sinister');
    expect(enrichVoiceStyle('Evil Lord', 'calm')).toBe('sinister');
  });

  it('should detect hero archetype', () => {
    expect(enrichVoiceStyle('Brave Hero', 'neutral')).toBe('excited');
    expect(enrichVoiceStyle('Knight Commander', 'calm')).toBe('excited');
  });

  it('should detect elder archetype', () => {
    expect(enrichVoiceStyle('Wise Elder', 'neutral')).toBe('calm');
    expect(enrichVoiceStyle('The Sage', 'excited')).toBe('calm');
  });

  it('should detect child archetype', () => {
    expect(enrichVoiceStyle('Young Child', 'neutral')).toBe('friendly');
  });

  it('should detect robot archetype', () => {
    expect(enrichVoiceStyle('AI Robot', 'calm')).toBe('neutral');
    expect(enrichVoiceStyle('Android Unit', 'excited')).toBe('neutral');
  });

  it('should fall back to base style for unknown characters', () => {
    expect(enrichVoiceStyle('Bob', 'excited')).toBe('excited');
    expect(enrichVoiceStyle('Merchant', 'calm')).toBe('calm');
  });
});

describe('enrichSfxPrompt', () => {
  it('should prepend game context', () => {
    const store = makeMockStore();
    const result = enrichSfxPrompt('swoosh sound', undefined, store);
    expect(result).toContain('game sound effect');
    expect(result).toContain('swoosh sound');
  });

  it('should include genre context', () => {
    const store = makeMockStore({
      sceneGraph: {
        nodes: {
          e1: { name: 'Zombie', entityId: 'e1', parentId: null, children: [], components: [], visible: true },
        },
        rootIds: ['e1'],
      } as never,
      allGameComponents: {},
    });
    const result = enrichSfxPrompt('door creak', undefined, store);
    expect(result).toContain('horror');
  });

  it('should infer category from entity name', () => {
    const store = makeMockStore();
    const result = enrichSfxPrompt('sound effect', 'ExplosionZone', store);
    expect(result).toContain('impact/explosion');
  });

  it('should handle UI entities', () => {
    const store = makeMockStore();
    const result = enrichSfxPrompt('click', 'MenuButton', store);
    expect(result).toContain('UI sound');
  });

  it('should handle collectible entities', () => {
    const store = makeMockStore();
    const result = enrichSfxPrompt('ding', 'CoinPickup', store);
    expect(result).toContain('collectible/pickup');
  });
});

describe('enrichMusicPrompt', () => {
  it('should prepend music context', () => {
    const store = makeMockStore();
    const result = enrichMusicPrompt('epic battle', store);
    expect(result).toContain('game soundtrack');
    expect(result).toContain('loopable');
    expect(result).toContain('epic battle');
  });

  it('should include scene name', () => {
    const store = makeMockStore({ sceneName: 'BossArena' } as never);
    const result = enrichMusicPrompt('intense music', store);
    expect(result).toContain('BossArena');
  });

  it('should skip Untitled scene name', () => {
    const store = makeMockStore({ sceneName: 'Untitled' } as never);
    const result = enrichMusicPrompt('calm music', store);
    expect(result).not.toContain('Untitled');
  });

  it('should include genre when inferred', () => {
    const store = makeMockStore({
      sceneGraph: {
        nodes: {
          e1: { name: 'SpaceShip', entityId: 'e1', parentId: null, children: [], components: [], visible: true },
        },
        rootIds: ['e1'],
      } as never,
      allGameComponents: {},
    });
    const result = enrichMusicPrompt('background music', store);
    expect(result).toContain('space');
  });
});
