import { describe, it, expect, vi } from 'vitest';
import {
  analyzeSaveNeeds,
  validateSaveSystemConfig,
  validateCheckpoint,
  saveSystemToScript,
  generateSaveSystem,
  generateDefaultUISpecs,
  SAVE_SYSTEM_PROMPT,
  type SaveSystem,
  type SaveSystemConfig,
  type CheckpointConfig,
  type PersistedField,
} from '../saveSystemGenerator';
import type { SceneGraph } from '@/stores/slices/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGraph(
  nodes: Array<{ id: string; name: string; components?: string[] }>,
): SceneGraph {
  const result: SceneGraph = { nodes: {}, rootIds: [] };
  for (const n of nodes) {
    result.nodes[n.id] = {
      entityId: n.id,
      name: n.name,
      parentId: null,
      children: [],
      components: n.components ?? [],
      visible: true,
    };
    result.rootIds.push(n.id);
  }
  return result;
}

function makeConfig(overrides?: Partial<SaveSystemConfig>): SaveSystemConfig {
  return {
    saveSlots: 3,
    autoSaveInterval: 60,
    checkpointTriggers: ['manual'],
    persistedData: [{ path: 'player.position', type: 'position' }],
    compression: false,
    ...overrides,
  };
}

function makeSystem(overrides?: Partial<SaveSystem>): SaveSystem {
  return {
    config: makeConfig(),
    checkpoints: [
      {
        id: 'cp1',
        name: 'Start',
        trigger: 'manual',
        position: { x: 0, y: 0, z: 0 },
      },
    ],
    script: '',
    uiComponents: generateDefaultUISpecs(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('analyzeSaveNeeds', () => {
  it('detects player entity as position field', () => {
    const graph = makeGraph([{ id: '1', name: 'Player' }]);
    const fields = analyzeSaveNeeds(graph);
    expect(fields.some((f) => f.type === 'position')).toBe(true);
  });

  it('detects collectible entity as score field', () => {
    const graph = makeGraph([{ id: '1', name: 'Coin' }]);
    const fields = analyzeSaveNeeds(graph);
    expect(fields.some((f) => f.type === 'score')).toBe(true);
  });

  it('detects health component', () => {
    const graph = makeGraph([
      { id: '1', name: 'Enemy', components: ['Health'] },
    ]);
    const fields = analyzeSaveNeeds(graph);
    expect(fields.some((f) => f.type === 'health')).toBe(true);
  });

  it('detects checkpoint component as level field', () => {
    const graph = makeGraph([
      { id: '1', name: 'Zone1', components: ['Checkpoint'] },
    ]);
    const fields = analyzeSaveNeeds(graph);
    expect(fields.some((f) => f.type === 'level')).toBe(true);
  });

  it('detects inventory-related entity names', () => {
    const graph = makeGraph([{ id: '1', name: 'Weapon_Sword' }]);
    const fields = analyzeSaveNeeds(graph);
    expect(fields.some((f) => f.type === 'inventory')).toBe(true);
  });

  it('deduplicates fields with same path and type', () => {
    const graph = makeGraph([
      { id: '1', name: 'Player', components: ['CharacterController'] },
    ]);
    const fields = analyzeSaveNeeds(graph);
    const positionFields = fields.filter((f) => f.type === 'position');
    // "Player" name match + CharacterController component — both yield position for same entity
    expect(positionFields.length).toBe(1);
  });

  it('returns empty array for scene with no relevant entities', () => {
    const graph = makeGraph([
      { id: '1', name: 'Ground', components: ['Mesh3d'] },
    ]);
    const fields = analyzeSaveNeeds(graph);
    expect(fields).toEqual([]);
  });

  it('uses game components when provided', () => {
    const graph = makeGraph([{ id: '1', name: 'Box' }]);
    const gameComponents = {
      '1': [{ type: 'health' }],
    };
    const fields = analyzeSaveNeeds(graph, gameComponents);
    expect(fields.some((f) => f.type === 'health')).toBe(true);
  });
});

describe('validateSaveSystemConfig', () => {
  it('returns no errors for valid config', () => {
    expect(validateSaveSystemConfig(makeConfig())).toEqual([]);
  });

  it('rejects saveSlots below 1', () => {
    const errors = validateSaveSystemConfig(makeConfig({ saveSlots: 0 }));
    expect(errors).toContainEqual(expect.stringContaining('saveSlots'));
  });

  it('rejects saveSlots above 20', () => {
    const errors = validateSaveSystemConfig(makeConfig({ saveSlots: 25 }));
    expect(errors).toContainEqual(expect.stringContaining('saveSlots'));
  });

  it('rejects negative autoSaveInterval', () => {
    const errors = validateSaveSystemConfig(
      makeConfig({ autoSaveInterval: -5 }),
    );
    expect(errors).toContainEqual(expect.stringContaining('autoSaveInterval'));
  });

  it('rejects invalid field type', () => {
    const errors = validateSaveSystemConfig(
      makeConfig({
        persistedData: [
          { path: 'x', type: 'bogus' as PersistedField['type'] },
        ],
      }),
    );
    expect(errors).toContainEqual(expect.stringContaining('Invalid field type'));
  });

  it('rejects empty field path', () => {
    const errors = validateSaveSystemConfig(
      makeConfig({
        persistedData: [{ path: '', type: 'score' }],
      }),
    );
    expect(errors).toContainEqual(expect.stringContaining('path must not be empty'));
  });

  it('rejects invalid checkpoint trigger', () => {
    const errors = validateSaveSystemConfig(
      makeConfig({ checkpointTriggers: ['invalid_trigger'] }),
    );
    expect(errors).toContainEqual(
      expect.stringContaining('Invalid checkpoint trigger'),
    );
  });
});

describe('validateCheckpoint', () => {
  it('returns no errors for valid checkpoint', () => {
    const cp: CheckpointConfig = {
      id: 'cp1',
      name: 'Start',
      trigger: 'zone_enter',
      position: { x: 0, y: 0, z: 0 },
    };
    expect(validateCheckpoint(cp)).toEqual([]);
  });

  it('rejects empty id', () => {
    const cp: CheckpointConfig = {
      id: '',
      name: 'Start',
      trigger: 'zone_enter',
      position: { x: 0, y: 0, z: 0 },
    };
    expect(validateCheckpoint(cp)).toContainEqual(
      expect.stringContaining('id must not be empty'),
    );
  });

  it('rejects empty name', () => {
    const cp: CheckpointConfig = {
      id: 'cp1',
      name: '',
      trigger: 'manual',
      position: { x: 0, y: 0, z: 0 },
    };
    expect(validateCheckpoint(cp)).toContainEqual(
      expect.stringContaining('name must not be empty'),
    );
  });
});

describe('saveSystemToScript', () => {
  it('generates script with localStorage calls', () => {
    const system = makeSystem();
    const script = saveSystemToScript(system);
    expect(script).toContain('localStorage.setItem');
    expect(script).toContain('localStorage.getItem');
    expect(script).toContain('localStorage.removeItem');
  });

  it('includes slot count constant', () => {
    const system = makeSystem({ config: makeConfig({ saveSlots: 5 }) });
    const script = saveSystemToScript(system);
    expect(script).toContain('SLOT_COUNT = 5');
  });

  it('includes auto-save interval', () => {
    const system = makeSystem({
      config: makeConfig({ autoSaveInterval: 120 }),
    });
    const script = saveSystemToScript(system);
    expect(script).toContain('AUTO_SAVE_INTERVAL = 120');
  });

  it('includes compression when enabled', () => {
    const system = makeSystem({
      config: makeConfig({ compression: true }),
    });
    const script = saveSystemToScript(system);
    expect(script).toContain('btoa');
    expect(script).toContain('atob');
  });

  it('omits compression when disabled', () => {
    const system = makeSystem({
      config: makeConfig({ compression: false }),
    });
    const script = saveSystemToScript(system);
    expect(script).not.toContain('btoa');
    expect(script).not.toContain('atob');
  });

  it('includes checkpoint data', () => {
    const system = makeSystem({
      checkpoints: [
        {
          id: 'cp_boss',
          name: 'Boss Room',
          trigger: 'zone_enter',
          position: { x: 10, y: 0, z: 20 },
        },
      ],
    });
    const script = saveSystemToScript(system);
    expect(script).toContain('cp_boss');
    expect(script).toContain('Boss Room');
  });

  it('includes persisted field entries', () => {
    const system = makeSystem({
      config: makeConfig({
        persistedData: [
          { path: 'player.pos', type: 'position' },
          { path: 'player.hp', type: 'health' },
        ],
      }),
    });
    const script = saveSystemToScript(system);
    expect(script).toContain('player.pos');
    expect(script).toContain('player.hp');
  });

  it('exposes forge.state save/load API', () => {
    const script = saveSystemToScript(makeSystem());
    expect(script).toContain("forge.state.set('save'");
    expect(script).toContain("forge.state.set('load'");
    expect(script).toContain("forge.state.set('deleteSave'");
    expect(script).toContain("forge.state.set('listSaves'");
  });
});

describe('generateDefaultUISpecs', () => {
  it('returns three UI components', () => {
    const specs = generateDefaultUISpecs();
    expect(specs).toHaveLength(3);
  });

  it('includes save_indicator, slot_picker, and checkpoint_notification', () => {
    const specs = generateDefaultUISpecs();
    const types = specs.map((s) => s.type);
    expect(types).toContain('save_indicator');
    expect(types).toContain('slot_picker');
    expect(types).toContain('checkpoint_notification');
  });
});

describe('SAVE_SYSTEM_PROMPT', () => {
  it('is a non-empty string', () => {
    expect(SAVE_SYSTEM_PROMPT.length).toBeGreaterThan(50);
  });

  it('mentions save slots and checkpoints', () => {
    expect(SAVE_SYSTEM_PROMPT).toContain('save');
    expect(SAVE_SYSTEM_PROMPT).toContain('checkpoint');
  });
});

describe('generateSaveSystem', () => {
  it('generates default system without AI', async () => {
    const system = await generateSaveSystem({
      description: 'A simple platformer',
      fields: [{ path: 'player.position', type: 'position' }],
    });

    expect(system.config.saveSlots).toBe(3);
    expect(system.config.autoSaveInterval).toBe(60);
    expect(system.checkpoints.length).toBeGreaterThan(0);
    expect(system.script.length).toBeGreaterThan(0);
    expect(system.uiComponents.length).toBe(3);
  });

  it('uses AI response when aiComplete is provided', async () => {
    const aiResponse = JSON.stringify({
      config: {
        saveSlots: 5,
        autoSaveInterval: 30,
        checkpointTriggers: ['zone_enter'],
        persistedData: [{ path: 'hero.pos', type: 'position' }],
        compression: true,
      },
      checkpoints: [
        {
          id: 'cp1',
          name: 'Village',
          trigger: 'zone_enter',
          position: { x: 1, y: 2, z: 3 },
        },
      ],
    });

    const mockAI = vi.fn().mockResolvedValue(aiResponse);
    const system = await generateSaveSystem({
      description: 'RPG',
      fields: [],
      aiComplete: mockAI,
    });

    expect(mockAI).toHaveBeenCalledOnce();
    expect(system.config.saveSlots).toBe(5);
    expect(system.config.compression).toBe(true);
    expect(system.checkpoints[0].name).toBe('Village');
  });

  it('handles AI response wrapped in markdown code fence', async () => {
    const aiResponse = '```json\n{"config":{"saveSlots":2,"autoSaveInterval":0,"checkpointTriggers":["manual"],"persistedData":[],"compression":false},"checkpoints":[]}\n```';
    const mockAI = vi.fn().mockResolvedValue(aiResponse);
    const system = await generateSaveSystem({
      description: 'Puzzle',
      fields: [],
      aiComplete: mockAI,
    });
    expect(system.config.saveSlots).toBe(2);
  });

  it('clamps saveSlots to valid range from AI response', async () => {
    const aiResponse = JSON.stringify({
      config: {
        saveSlots: 999,
        autoSaveInterval: 60,
        checkpointTriggers: [],
        persistedData: [],
        compression: false,
      },
      checkpoints: [],
    });
    const mockAI = vi.fn().mockResolvedValue(aiResponse);
    const system = await generateSaveSystem({
      description: 'test',
      fields: [],
      aiComplete: mockAI,
    });
    expect(system.config.saveSlots).toBe(20);
  });

  it('throws on unparseable AI response', async () => {
    const mockAI = vi.fn().mockResolvedValue('Sorry, I cannot help.');
    await expect(
      generateSaveSystem({
        description: 'test',
        fields: [],
        aiComplete: mockAI,
      }),
    ).rejects.toThrow();
  });
});
