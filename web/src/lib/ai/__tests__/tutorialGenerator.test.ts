import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectMechanics,
  parseTutorialResponse,
  buildTutorialPrompt,
  tutorialPlanToScript,
  generateTutorialPlan,
  TUTORIAL_SYSTEM_PROMPT,
  type SceneEntityContext,
  type GameMechanic,
  type TutorialPlan,
} from '../tutorialGenerator';

vi.mock('@/lib/ai/client', () => ({
  fetchAI: vi.fn(),
  streamAI: vi.fn(),
}));

// ---------------------------------------------------------------------------
// detectMechanics
// ---------------------------------------------------------------------------

describe('detectMechanics', () => {
  it('detects character controller as Movement mechanic', () => {
    const entities: SceneEntityContext[] = [
      {
        entityId: 'e1',
        name: 'Player',
        components: ['Mesh3d'],
        gameComponents: [{ type: 'characterController' }],
      },
    ];
    const result = detectMechanics(entities);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Movement');
    expect(result[0].complexity).toBe(1);
  });

  it('detects multiple mechanics from different entities', () => {
    const entities: SceneEntityContext[] = [
      {
        entityId: 'e1',
        name: 'Player',
        components: ['Mesh3d'],
        gameComponents: [{ type: 'characterController' }, { type: 'health' }],
      },
      {
        entityId: 'e2',
        name: 'Coin',
        components: ['Mesh3d'],
        gameComponents: [{ type: 'collectible' }],
      },
      {
        entityId: 'e3',
        name: 'Spike',
        components: ['Mesh3d'],
        gameComponents: [{ type: 'damageZone' }],
      },
    ];
    const result = detectMechanics(entities);
    expect(result.length).toBe(4);
    const names = result.map((m) => m.name);
    expect(names).toContain('Movement');
    expect(names).toContain('Health & Damage');
    expect(names).toContain('Collecting Items');
    expect(names).toContain('Damage Zones');
  });

  it('sorts mechanics by complexity ascending', () => {
    const entities: SceneEntityContext[] = [
      {
        entityId: 'e1',
        name: 'Spawner',
        components: [],
        gameComponents: [{ type: 'spawner' }],
      },
      {
        entityId: 'e2',
        name: 'Player',
        components: [],
        gameComponents: [{ type: 'characterController' }],
      },
      {
        entityId: 'e3',
        name: 'Platform',
        components: [],
        gameComponents: [{ type: 'movingPlatform' }],
      },
    ];
    const result = detectMechanics(entities);
    expect(result.length).toBe(3);
    // Movement (1) < Moving Platforms (4) < Enemy Spawners (5)
    expect(result[0].name).toBe('Movement');
    expect(result[1].name).toBe('Moving Platforms');
    expect(result[2].name).toBe('Enemy Spawners');
  });

  it('returns empty array for scene with no game components', () => {
    const entities: SceneEntityContext[] = [
      { entityId: 'e1', name: 'Cube', components: ['Mesh3d'] },
      { entityId: 'e2', name: 'Light', components: ['PointLight'] },
    ];
    const result = detectMechanics(entities);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty entity list', () => {
    const result = detectMechanics([]);
    expect(result).toHaveLength(0);
  });

  it('deduplicates mechanics across multiple entities with same component', () => {
    const entities: SceneEntityContext[] = [
      {
        entityId: 'e1',
        name: 'Coin1',
        components: [],
        gameComponents: [{ type: 'collectible' }],
      },
      {
        entityId: 'e2',
        name: 'Coin2',
        components: [],
        gameComponents: [{ type: 'collectible' }],
      },
    ];
    const result = detectMechanics(entities);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Collecting Items');
  });

  it('detects physics interaction for non-character physics entities', () => {
    const entities: SceneEntityContext[] = [
      {
        entityId: 'e1',
        name: 'Crate',
        components: ['Mesh3d'],
        hasPhysics: true,
      },
    ];
    const result = detectMechanics(entities);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Physics Interaction');
  });

  it('does not detect physics interaction for character controller entities', () => {
    const entities: SceneEntityContext[] = [
      {
        entityId: 'e1',
        name: 'Player',
        components: ['Mesh3d'],
        hasPhysics: true,
        gameComponents: [{ type: 'characterController' }],
      },
    ];
    const result = detectMechanics(entities);
    // Should detect Movement but NOT Physics Interaction
    const names = result.map((m) => m.name);
    expect(names).toContain('Movement');
    expect(names).not.toContain('Physics Interaction');
  });

  it('detects scripted behavior', () => {
    const entities: SceneEntityContext[] = [
      {
        entityId: 'e1',
        name: 'Door',
        components: ['Mesh3d'],
        hasScript: true,
      },
    ];
    const result = detectMechanics(entities);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Scripted Behavior');
  });

  it('detects all 13 game component mechanic types', () => {
    const componentTypes = [
      'characterController', 'collectible', 'health', 'damageZone',
      'checkpoint', 'teleporter', 'movingPlatform', 'triggerZone',
      'spawner', 'follower', 'projectile', 'winCondition', 'dialogueTrigger',
    ];
    const entities: SceneEntityContext[] = componentTypes.map((type, i) => ({
      entityId: `e${i}`,
      name: `Entity${i}`,
      components: [],
      gameComponents: [{ type }],
    }));
    const result = detectMechanics(entities);
    // 13 game component types -> 13 mechanics
    expect(result.length).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// parseTutorialResponse
// ---------------------------------------------------------------------------

describe('parseTutorialResponse', () => {
  const validResponse: TutorialPlan = {
    steps: [
      {
        order: 1,
        mechanic: 'Movement',
        instruction: 'Use WASD to move your character around.',
        triggerCondition: 'Game starts',
        completionCondition: 'Player moves 5 units',
        hint: 'Try pressing W to move forward',
      },
      {
        order: 2,
        mechanic: 'Collecting Items',
        instruction: 'Walk into the glowing coins to collect them.',
        triggerCondition: 'Previous step completed',
        completionCondition: 'Player collects 3 coins',
      },
    ],
    estimatedDuration: '2-3 minutes',
    difficulty: 'beginner',
    introText: 'Welcome! Let\'s learn the basics.',
    completionText: 'Great job! You\'re ready to play.',
  };

  it('parses a valid JSON response', () => {
    const result = parseTutorialResponse(JSON.stringify(validResponse));
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].mechanic).toBe('Movement');
    expect(result.steps[1].mechanic).toBe('Collecting Items');
    expect(result.difficulty).toBe('beginner');
    expect(result.introText).toBe('Welcome! Let\'s learn the basics.');
  });

  it('handles markdown code fences', () => {
    const wrapped = '```json\n' + JSON.stringify(validResponse) + '\n```';
    const result = parseTutorialResponse(wrapped);
    expect(result.steps).toHaveLength(2);
  });

  it('handles code fences without json label', () => {
    const wrapped = '```\n' + JSON.stringify(validResponse) + '\n```';
    const result = parseTutorialResponse(wrapped);
    expect(result.steps).toHaveLength(2);
  });

  it('throws on non-JSON input', () => {
    expect(() => parseTutorialResponse('not json')).toThrow(
      'Failed to parse tutorial response as JSON',
    );
  });

  it('throws on non-object JSON', () => {
    expect(() => parseTutorialResponse('[1,2,3]')).toThrow(
      'Tutorial response is not a JSON object',
    );
  });

  it('throws when steps array is empty', () => {
    expect(() =>
      parseTutorialResponse(JSON.stringify({ steps: [] })),
    ).toThrow('Tutorial plan contains no valid steps');
  });

  it('throws when steps array contains no valid steps', () => {
    expect(() =>
      parseTutorialResponse(JSON.stringify({ steps: [{ invalid: true }] })),
    ).toThrow('Tutorial plan contains no valid steps');
  });

  it('provides default values for missing optional fields', () => {
    const minimal = {
      steps: [
        {
          mechanic: 'Movement',
          instruction: 'Move around.',
        },
      ],
    };
    const result = parseTutorialResponse(JSON.stringify(minimal));
    expect(result.steps[0].order).toBe(1);
    expect(result.steps[0].triggerCondition).toBe('Previous step completed');
    expect(result.steps[0].completionCondition).toBe('Complete the action');
    expect(result.steps[0].hint).toBeUndefined();
    expect(result.difficulty).toBe('beginner');
    expect(result.introText).toContain('Welcome');
    expect(result.completionText).toContain('tutorial');
  });

  it('sorts steps by order', () => {
    const unordered = {
      steps: [
        { order: 3, mechanic: 'C', instruction: 'Third' },
        { order: 1, mechanic: 'A', instruction: 'First' },
        { order: 2, mechanic: 'B', instruction: 'Second' },
      ],
      difficulty: 'intermediate',
      introText: 'Hello',
      completionText: 'Done',
      estimatedDuration: '5 min',
    };
    const result = parseTutorialResponse(JSON.stringify(unordered));
    expect(result.steps[0].mechanic).toBe('A');
    expect(result.steps[1].mechanic).toBe('B');
    expect(result.steps[2].mechanic).toBe('C');
  });

  it('defaults invalid difficulty to beginner', () => {
    const plan = {
      steps: [{ mechanic: 'X', instruction: 'Do stuff' }],
      difficulty: 'expert',
    };
    const result = parseTutorialResponse(JSON.stringify(plan));
    expect(result.difficulty).toBe('beginner');
  });
});

// ---------------------------------------------------------------------------
// buildTutorialPrompt
// ---------------------------------------------------------------------------

describe('buildTutorialPrompt', () => {
  it('includes all mechanic names and complexity', () => {
    const mechanics: GameMechanic[] = [
      { name: 'Movement', description: 'Move around', inputRequired: 'WASD', complexity: 1 },
      { name: 'Collecting Items', description: 'Pick up items', inputRequired: 'Walk into', complexity: 2 },
    ];
    const prompt = buildTutorialPrompt(mechanics);
    expect(prompt).toContain('Movement');
    expect(prompt).toContain('complexity: 1/5');
    expect(prompt).toContain('Collecting Items');
    expect(prompt).toContain('complexity: 2/5');
  });

  it('includes maxSteps when provided', () => {
    const mechanics: GameMechanic[] = [
      { name: 'Movement', description: 'Move', inputRequired: 'WASD', complexity: 1 },
    ];
    const prompt = buildTutorialPrompt(mechanics, { maxSteps: 5 });
    expect(prompt).toContain('Maximum tutorial steps: 5');
  });

  it('omits maxSteps when not provided', () => {
    const mechanics: GameMechanic[] = [
      { name: 'Movement', description: 'Move', inputRequired: 'WASD', complexity: 1 },
    ];
    const prompt = buildTutorialPrompt(mechanics);
    expect(prompt).not.toContain('Maximum tutorial steps');
  });
});

// ---------------------------------------------------------------------------
// tutorialPlanToScript
// ---------------------------------------------------------------------------

describe('tutorialPlanToScript', () => {
  it('generates valid script with plan data', () => {
    const plan: TutorialPlan = {
      steps: [
        {
          order: 1,
          mechanic: 'Movement',
          instruction: 'Use WASD to move.',
          triggerCondition: 'Game starts',
          completionCondition: 'Move 5 units',
          hint: 'Press W',
        },
      ],
      estimatedDuration: '1 minute',
      difficulty: 'beginner',
      introText: 'Welcome!',
      completionText: 'Well done!',
    };
    const script = tutorialPlanToScript(plan);
    expect(script).toContain('TUTORIAL_STEPS');
    expect(script).toContain('Movement');
    expect(script).toContain('Use WASD to move.');
    expect(script).toContain('Welcome!');
    expect(script).toContain('Well done!');
    expect(script).toContain('function onStart');
    expect(script).toContain('1 minute');
    expect(script).toContain('beginner');
  });

  it('includes hint in step data', () => {
    const plan: TutorialPlan = {
      steps: [
        {
          order: 1,
          mechanic: 'Test',
          instruction: 'Do thing',
          triggerCondition: 'start',
          completionCondition: 'done',
          hint: 'Try this',
        },
      ],
      estimatedDuration: '1 min',
      difficulty: 'beginner',
      introText: 'Hi',
      completionText: 'Bye',
    };
    const script = tutorialPlanToScript(plan);
    expect(script).toContain('Try this');
  });
});

// ---------------------------------------------------------------------------
// TUTORIAL_SYSTEM_PROMPT
// ---------------------------------------------------------------------------

describe('TUTORIAL_SYSTEM_PROMPT', () => {
  it('contains key design principles', () => {
    expect(TUTORIAL_SYSTEM_PROMPT).toContain('PROGRESSIVE DISCLOSURE');
    expect(TUTORIAL_SYSTEM_PROMPT).toContain('SAFE LEARNING');
    expect(TUTORIAL_SYSTEM_PROMPT).toContain('CLEAR FEEDBACK');
    expect(TUTORIAL_SYSTEM_PROMPT).toContain('JSON');
  });
});

// ---------------------------------------------------------------------------
// generateTutorialPlan (API integration — mocked fetchAI)
// ---------------------------------------------------------------------------

describe('generateTutorialPlan', () => {
  let fetchAIMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    const client = await import('@/lib/ai/client');
    fetchAIMock = vi.mocked(client.fetchAI);
  });

  it('throws when no mechanics provided', async () => {
    await expect(generateTutorialPlan([])).rejects.toThrow(
      'No game mechanics detected',
    );
  });

  it('throws on non-ok response', async () => {
    fetchAIMock.mockRejectedValue(new Error('AI service error — the request failed on the server. Please try again.'));

    const mechanics: GameMechanic[] = [
      { name: 'Movement', description: 'Move', inputRequired: 'WASD', complexity: 1 },
    ];

    await expect(generateTutorialPlan(mechanics)).rejects.toThrow(/service error/i);
  });

  it('throws on AI returned empty response', async () => {
    fetchAIMock.mockResolvedValue('');

    const mechanics: GameMechanic[] = [
      { name: 'Movement', description: 'Move', inputRequired: 'WASD', complexity: 1 },
    ];

    await expect(generateTutorialPlan(mechanics)).rejects.toThrow('AI returned an empty response');
  });

  it('parses SSE stream and returns tutorial plan', async () => {
    const plan: TutorialPlan = {
      steps: [
        {
          order: 1,
          mechanic: 'Movement',
          instruction: 'Move around.',
          triggerCondition: 'Game starts',
          completionCondition: 'Move 5 units',
        },
      ],
      estimatedDuration: '1 min',
      difficulty: 'beginner',
      introText: 'Welcome!',
      completionText: 'Done!',
    };

    fetchAIMock.mockResolvedValue(JSON.stringify(plan));

    const mechanics: GameMechanic[] = [
      { name: 'Movement', description: 'Move', inputRequired: 'WASD', complexity: 1 },
    ];

    const result = await generateTutorialPlan(mechanics);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].mechanic).toBe('Movement');
    expect(result.introText).toBe('Welcome!');
  });

  it('sends correct request payload', async () => {
    const plan: TutorialPlan = {
      steps: [{ mechanic: 'X', instruction: 'Y', order: 1, triggerCondition: 'start', completionCondition: 'end' }],
      introText: 'A',
      completionText: 'B',
      estimatedDuration: '1m',
      difficulty: 'beginner',
    };
    fetchAIMock.mockResolvedValue(JSON.stringify(plan));

    const mechanics: GameMechanic[] = [
      { name: 'Movement', description: 'Move', inputRequired: 'WASD', complexity: 1 },
    ];

    await generateTutorialPlan(mechanics, { maxSteps: 3 });

    expect(fetchAIMock).toHaveBeenCalledOnce();
    const [prompt, options] = fetchAIMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(options.systemOverride).toBe(TUTORIAL_SYSTEM_PROMPT);
    expect(prompt).toContain('Movement');
    expect(prompt).toContain('Maximum tutorial steps: 3');
  });
});
