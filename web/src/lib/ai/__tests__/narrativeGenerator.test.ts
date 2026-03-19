import { describe, it, expect } from 'vitest';
import {
  NARRATIVE_PRESETS,
  parseNarrativeResponse,
  validateNarrativeArc,
  narrativeToDialogueTree,
  buildNarrativePrompt,
  generateNarrative,
  findDeadEnds,
  buildSceneGraph,
  getAllSceneIds,
} from '../narrativeGenerator';
import type { NarrativeArc } from '../narrativeGenerator';

// ============================================================================
// Fixtures
// ============================================================================

function makeValidArc(overrides?: Partial<NarrativeArc>): NarrativeArc {
  return {
    title: 'The Lost Crown',
    genre: 'Fantasy',
    themes: ['courage', 'sacrifice'],
    acts: [
      {
        number: 1,
        name: 'The Call',
        scenes: [
          {
            id: 'scene_1_1',
            name: 'Village Awakening',
            description: 'The hero wakes in a quiet village.',
            dialogue: [
              { speaker: 'Elder', text: 'The crown has been stolen.', emotion: 'grave' },
              { speaker: 'Hero', text: 'I will find it.' },
            ],
            choices: [
              {
                text: 'Head to the forest',
                consequence: 'Enter dangerous territory',
                nextSceneId: 'scene_1_2',
                affectsEnding: 'ending_good',
              },
              {
                text: 'Visit the tavern',
                consequence: 'Gather information first',
                nextSceneId: 'scene_2_1',
              },
            ],
          },
          {
            id: 'scene_1_2',
            name: 'Dark Forest',
            description: 'A foreboding path through ancient trees.',
            dialogue: [
              { speaker: 'Hero', text: 'Something lurks here.' },
            ],
            nextSceneId: 'scene_2_1',
          },
        ],
        turningPoint: 'The hero discovers the crown was taken by the king himself.',
      },
      {
        number: 2,
        name: 'The Trials',
        scenes: [
          {
            id: 'scene_2_1',
            name: 'The Crossroads',
            description: 'A fork in the road.',
            dialogue: [
              { speaker: 'Stranger', text: 'Choose wisely.' },
            ],
            choices: [
              {
                text: 'Confront the king',
                consequence: 'Direct confrontation',
                nextSceneId: 'scene_2_2',
                affectsEnding: 'ending_good',
              },
              {
                text: 'Flee the kingdom',
                consequence: 'Abandon the quest',
                nextSceneId: 'scene_2_2',
                affectsEnding: 'ending_bad',
              },
            ],
          },
          {
            id: 'scene_2_2',
            name: 'The Throne Room',
            description: 'Final confrontation.',
            dialogue: [
              { speaker: 'King', text: 'You dare challenge me?' },
              { speaker: 'Hero', text: 'The crown belongs to the people.' },
            ],
          },
        ],
        turningPoint: 'The hero must decide the fate of the kingdom.',
      },
    ],
    characters: [
      {
        name: 'Hero',
        role: 'protagonist',
        description: 'A brave villager.',
        motivation: 'Restore justice',
      },
      {
        name: 'King',
        role: 'antagonist',
        description: 'The corrupt ruler.',
        motivation: 'Hold power',
      },
    ],
    endings: [
      {
        id: 'ending_good',
        name: 'Crown Restored',
        type: 'good',
        description: 'The crown is returned to the people.',
        conditions: ['Confront the king', 'Survive the trials'],
      },
      {
        id: 'ending_bad',
        name: 'Kingdom Falls',
        type: 'bad',
        description: 'The kingdom collapses into tyranny.',
        conditions: ['Flee the kingdom'],
      },
    ],
    ...overrides,
  };
}

function makeValidArcJson(overrides?: Partial<NarrativeArc>): string {
  return JSON.stringify(makeValidArc(overrides));
}

// ============================================================================
// Preset Tests
// ============================================================================

describe('NARRATIVE_PRESETS', () => {
  it('should have 4 presets', () => {
    expect(Object.keys(NARRATIVE_PRESETS)).toHaveLength(4);
  });

  it.each(Object.entries(NARRATIVE_PRESETS))(
    'preset "%s" should have valid structure',
    (_key, preset) => {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.actStructure.length).toBeGreaterThanOrEqual(2);
      expect(preset.suggestedCharacterRoles.length).toBeGreaterThanOrEqual(2);
      expect(preset.endingTypes.length).toBeGreaterThanOrEqual(2);

      for (const act of preset.actStructure) {
        expect(act.name).toBeTruthy();
        expect(act.purpose).toBeTruthy();
      }
    },
  );

  it('each preset should have unique IDs', () => {
    const ids = Object.values(NARRATIVE_PRESETS).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ============================================================================
// Parsing Tests
// ============================================================================

describe('parseNarrativeResponse', () => {
  it('should parse valid JSON', () => {
    const arc = parseNarrativeResponse(makeValidArcJson());
    expect(arc.title).toBe('The Lost Crown');
    expect(arc.acts).toHaveLength(2);
  });

  it('should strip markdown code fences', () => {
    const wrapped = '```json\n' + makeValidArcJson() + '\n```';
    const arc = parseNarrativeResponse(wrapped);
    expect(arc.title).toBe('The Lost Crown');
  });

  it('should throw on invalid JSON', () => {
    expect(() => parseNarrativeResponse('not json')).toThrow(
      'Failed to parse narrative response as JSON',
    );
  });

  it('should throw on empty string', () => {
    expect(() => parseNarrativeResponse('')).toThrow();
  });
});

// ============================================================================
// Validation Tests
// ============================================================================

describe('validateNarrativeArc', () => {
  it('should accept a valid arc', () => {
    const arc = validateNarrativeArc(makeValidArc());
    expect(arc.title).toBe('The Lost Crown');
  });

  it('should reject non-object input', () => {
    expect(() => validateNarrativeArc('string')).toThrow('must be a JSON object');
    expect(() => validateNarrativeArc(null)).toThrow('must be a JSON object');
    expect(() => validateNarrativeArc([])).toThrow('must be a JSON object');
  });

  it('should reject missing title', () => {
    expect(() => validateNarrativeArc({ ...makeValidArc(), title: '' })).toThrow(
      'non-empty title',
    );
  });

  it('should reject missing genre', () => {
    expect(() => validateNarrativeArc({ ...makeValidArc(), genre: '' })).toThrow(
      'non-empty genre',
    );
  });

  it('should reject empty themes', () => {
    expect(() => validateNarrativeArc({ ...makeValidArc(), themes: [] })).toThrow(
      'at least one theme',
    );
  });

  it('should reject empty acts', () => {
    expect(() => validateNarrativeArc({ ...makeValidArc(), acts: [] })).toThrow(
      'at least one act',
    );
  });

  it('should reject fewer than 2 characters', () => {
    const arc = makeValidArc();
    arc.characters = [arc.characters[0]];
    expect(() => validateNarrativeArc(arc)).toThrow('at least 2 characters');
  });

  it('should reject fewer than 2 endings', () => {
    const arc = makeValidArc();
    arc.endings = [arc.endings[0]];
    expect(() => validateNarrativeArc(arc)).toThrow('at least 2 endings');
  });

  it('should reject invalid character role', () => {
    const arc = makeValidArc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (arc.characters[0] as any).role = 'villain';
    expect(() => validateNarrativeArc(arc)).toThrow('Character role must be one of');
  });

  it('should reject invalid ending type', () => {
    const arc = makeValidArc();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (arc.endings[0] as any).type = 'epic';
    expect(() => validateNarrativeArc(arc)).toThrow('Ending type must be one of');
  });

  it('should reject duplicate scene IDs', () => {
    const arc = makeValidArc();
    arc.acts[1].scenes[0].id = 'scene_1_1'; // duplicate
    expect(() => validateNarrativeArc(arc)).toThrow('Duplicate scene ID');
  });

  it('should reject invalid scene references in choices', () => {
    const arc = makeValidArc();
    arc.acts[0].scenes[0].choices![0].nextSceneId = 'nonexistent';
    expect(() => validateNarrativeArc(arc)).toThrow('references unknown nextSceneId');
  });

  it('should reject invalid nextSceneId on linear scenes', () => {
    const arc = makeValidArc();
    arc.acts[0].scenes[1].nextSceneId = 'nonexistent';
    expect(() => validateNarrativeArc(arc)).toThrow('references unknown nextSceneId');
  });
});

// ============================================================================
// Dead End Detection
// ============================================================================

describe('findDeadEnds', () => {
  it('should detect terminal scenes without choices or nextSceneId', () => {
    const arc = makeValidArc();
    const deadEnds = findDeadEnds(arc);
    // scene_2_2 has no choices and no nextSceneId
    expect(deadEnds).toContain('scene_2_2');
  });

  it('should not flag scenes with choices', () => {
    const arc = makeValidArc();
    const deadEnds = findDeadEnds(arc);
    expect(deadEnds).not.toContain('scene_1_1');
    expect(deadEnds).not.toContain('scene_2_1');
  });

  it('should not flag scenes with nextSceneId', () => {
    const arc = makeValidArc();
    const deadEnds = findDeadEnds(arc);
    expect(deadEnds).not.toContain('scene_1_2');
  });
});

// ============================================================================
// Dialogue Tree Export
// ============================================================================

describe('narrativeToDialogueTree', () => {
  it('should produce a valid DialogueTree', () => {
    const arc = makeValidArc();
    const tree = narrativeToDialogueTree(arc);

    expect(tree.id).toContain('narrative_');
    expect(tree.name).toBe('The Lost Crown');
    expect(tree.startNodeId).toBe('scene_1_1_d0');
    expect(tree.nodes.length).toBeGreaterThan(0);
  });

  it('should create text nodes for each dialogue line', () => {
    const arc = makeValidArc();
    const tree = narrativeToDialogueTree(arc);

    const textNodes = tree.nodes.filter((n) => n.type === 'text');
    // 2 lines in scene_1_1, 1 in scene_1_2, 1 in scene_2_1, 2 in scene_2_2 = 6
    expect(textNodes).toHaveLength(6);
  });

  it('should create choice nodes for scenes with choices', () => {
    const arc = makeValidArc();
    const tree = narrativeToDialogueTree(arc);

    const choiceNodes = tree.nodes.filter((n) => n.type === 'choice');
    // scene_1_1 and scene_2_1 have choices
    expect(choiceNodes).toHaveLength(2);
  });

  it('should create end nodes for terminal scenes', () => {
    const arc = makeValidArc();
    const tree = narrativeToDialogueTree(arc);

    const endNodes = tree.nodes.filter((n) => n.type === 'end');
    // scene_2_2 is terminal
    expect(endNodes).toHaveLength(1);
  });

  it('should chain text nodes within a scene', () => {
    const arc = makeValidArc();
    const tree = narrativeToDialogueTree(arc);

    const node0 = tree.nodes.find((n) => n.id === 'scene_1_1_d0');
    expect(node0).toBeDefined();
    expect(node0!.type).toBe('text');
    if (node0!.type === 'text') {
      expect(node0!.next).toBe('scene_1_1_d1');
    }
  });

  it('should link last text node to choice node when choices exist', () => {
    const arc = makeValidArc();
    const tree = narrativeToDialogueTree(arc);

    const lastTextInScene1 = tree.nodes.find((n) => n.id === 'scene_1_1_d1');
    expect(lastTextInScene1).toBeDefined();
    if (lastTextInScene1!.type === 'text') {
      expect(lastTextInScene1!.next).toBe('scene_1_1_choices');
    }
  });

  it('should map choice nextSceneIds to dialogue node IDs', () => {
    const arc = makeValidArc();
    const tree = narrativeToDialogueTree(arc);

    const choiceNode = tree.nodes.find((n) => n.id === 'scene_1_1_choices');
    expect(choiceNode).toBeDefined();
    if (choiceNode!.type === 'choice') {
      // First choice -> scene_1_2 -> scene_1_2_d0
      expect(choiceNode!.choices[0].nextNodeId).toBe('scene_1_2_d0');
      // Second choice -> scene_2_1 -> scene_2_1_d0
      expect(choiceNode!.choices[1].nextNodeId).toBe('scene_2_1_d0');
    }
  });

  it('should link linear scenes via nextSceneId', () => {
    const arc = makeValidArc();
    const tree = narrativeToDialogueTree(arc);

    // scene_1_2 has one dialogue line and nextSceneId -> scene_2_1
    const lastInScene12 = tree.nodes.find((n) => n.id === 'scene_1_2_d0');
    expect(lastInScene12).toBeDefined();
    if (lastInScene12!.type === 'text') {
      expect(lastInScene12!.next).toBe('scene_2_1_d0');
    }
  });

  it('should sanitize title for tree ID', () => {
    const arc = makeValidArc({ title: 'A Hero\'s Journey!!!' });
    const tree = narrativeToDialogueTree(arc);
    expect(tree.id).toBe('narrative_a_hero_s_journey_');
  });
});

// ============================================================================
// Prompt Building
// ============================================================================

describe('buildNarrativePrompt', () => {
  it('should include the premise', () => {
    const prompt = buildNarrativePrompt('A dragon protects a library');
    expect(prompt).toContain('A dragon protects a library');
  });

  it('should default to 3 acts without preset', () => {
    const prompt = buildNarrativePrompt('test', {});
    expect(prompt).toContain('Number of acts: 3');
  });

  it('should use preset act count when preset is specified', () => {
    const prompt = buildNarrativePrompt('test', { preset: 'hero_journey' });
    expect(prompt).toContain('Number of acts: 3');
    expect(prompt).toContain("Hero's Journey");
  });

  it('should override act count with explicit option', () => {
    const prompt = buildNarrativePrompt('test', { preset: 'mystery', actCount: 5 });
    expect(prompt).toContain('Number of acts: 5');
  });

  it('should include JSON schema in output', () => {
    const prompt = buildNarrativePrompt('test');
    expect(prompt).toContain('"title"');
    expect(prompt).toContain('"acts"');
    expect(prompt).toContain('"endings"');
  });
});

// ============================================================================
// generateNarrative (integration with fetchFn)
// ============================================================================

describe('generateNarrative', () => {
  it('should call fetchFn with built prompt and return parsed arc', async () => {
    const mockFetch = async (_prompt: string) => makeValidArcJson();

    const arc = await generateNarrative('A dragon guards a library', mockFetch);
    expect(arc.title).toBe('The Lost Crown');
    expect(arc.acts).toHaveLength(2);
  });

  it('should pass preset option to prompt builder', async () => {
    let capturedPrompt = '';
    const mockFetch = async (prompt: string) => {
      capturedPrompt = prompt;
      return makeValidArcJson();
    };

    await generateNarrative('test', mockFetch, { preset: 'mystery' });
    expect(capturedPrompt).toContain('Mystery');
  });

  it('should throw on invalid response', async () => {
    const mockFetch = async () => 'not json';
    await expect(generateNarrative('test', mockFetch)).rejects.toThrow();
  });
});

// ============================================================================
// Scene Graph
// ============================================================================

describe('buildSceneGraph', () => {
  it('should build adjacency list from narrative', () => {
    const arc = makeValidArc();
    const graph = buildSceneGraph(arc);

    expect(graph.size).toBe(4);
    expect(graph.get('scene_1_1')!.targets).toContain('scene_1_2');
    expect(graph.get('scene_1_1')!.targets).toContain('scene_2_1');
    expect(graph.get('scene_1_2')!.targets).toEqual(['scene_2_1']);
    expect(graph.get('scene_2_2')!.targets).toEqual([]);
  });

  it('should include scene names', () => {
    const arc = makeValidArc();
    const graph = buildSceneGraph(arc);
    expect(graph.get('scene_1_1')!.sceneName).toBe('Village Awakening');
  });
});

describe('getAllSceneIds', () => {
  it('should return all scene IDs in order', () => {
    const arc = makeValidArc();
    const ids = getAllSceneIds(arc);
    expect(ids).toEqual(['scene_1_1', 'scene_1_2', 'scene_2_1', 'scene_2_2']);
  });
});
