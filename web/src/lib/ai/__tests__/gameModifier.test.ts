/**
 * Tests for the game modification engine (PF-576).
 * Covers plan generation, parsing, execution, scope filtering,
 * and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseModificationPlan,
  executeModificationPlan,
  planModification,
  buildModificationPrompt,
  filterEntitiesByScope,
  MODIFIER_SYSTEM_PROMPT,
  type ModificationPlan,
  type ModificationStep,
  type ModificationRequest,
} from '../gameModifier';
import { buildSceneContext, type SceneContext, type SceneContextStore } from '../sceneContext';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createMockSceneContext(overrides?: Partial<SceneContext>): SceneContext {
  return {
    entities: [
      { id: 'e1', name: 'Player', type: 'mesh', components: ['Mesh3d', 'Transform'], visible: true, parentId: null },
      { id: 'e2', name: 'Enemy', type: 'mesh', components: ['Mesh3d', 'Transform'], visible: true, parentId: null },
      { id: 'e3', name: 'Sun', type: 'directional_light', components: ['DirectionalLight'], visible: true, parentId: null },
    ],
    selectedIds: ['e1'],
    sceneSettings: {
      ambientLight: { color: [1, 1, 1], brightness: 0.3 },
      environment: { clearColor: [0.1, 0.1, 0.1], fogEnabled: false, skyboxPreset: null },
      engineMode: 'edit',
    },
    ...overrides,
  };
}

function createValidPlanJSON(overrides?: Partial<ModificationPlan>): string {
  const plan: ModificationPlan = {
    steps: [
      {
        action: 'update',
        entityId: 'e2',
        component: 'physics',
        changes: { gravityScale: 2.0 },
        command: 'set_physics',
      },
    ],
    affectedEntities: ['e2'],
    summary: 'Increased enemy gravity scale',
    confidence: 0.9,
    ...overrides,
  };
  return JSON.stringify(plan);
}

// ---------------------------------------------------------------------------
// parseModificationPlan
// ---------------------------------------------------------------------------

describe('parseModificationPlan', () => {
  it('parses a valid JSON plan', () => {
    const plan = parseModificationPlan(createValidPlanJSON());
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].action).toBe('update');
    expect(plan.steps[0].entityId).toBe('e2');
    expect(plan.steps[0].command).toBe('set_physics');
    expect(plan.affectedEntities).toEqual(['e2']);
    expect(plan.summary).toBe('Increased enemy gravity scale');
    expect(plan.confidence).toBe(0.9);
  });

  it('handles markdown code fences', () => {
    const wrapped = '```json\n' + createValidPlanJSON() + '\n```';
    const plan = parseModificationPlan(wrapped);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].command).toBe('set_physics');
  });

  it('handles code fences without language tag', () => {
    const wrapped = '```\n' + createValidPlanJSON() + '\n```';
    const plan = parseModificationPlan(wrapped);
    expect(plan.steps).toHaveLength(1);
  });

  it('clamps confidence to [0, 1]', () => {
    const plan = parseModificationPlan(createValidPlanJSON({ confidence: 5.0 }));
    expect(plan.confidence).toBe(1);

    const plan2 = parseModificationPlan(createValidPlanJSON({ confidence: -2 }));
    expect(plan2.confidence).toBe(0);
  });

  it('defaults confidence to 0.5 if missing', () => {
    const json = JSON.stringify({
      steps: [{ action: 'update', entityId: 'e1', component: 'transform', changes: {}, command: 'set_transform' }],
      affectedEntities: ['e1'],
      summary: 'test',
    });
    const plan = parseModificationPlan(json);
    expect(plan.confidence).toBe(0.5);
  });

  it('derives affectedEntities from steps when missing', () => {
    const json = JSON.stringify({
      steps: [
        { action: 'update', entityId: 'e1', component: 'material', changes: {}, command: 'set_material' },
        { action: 'update', entityId: 'e2', component: 'material', changes: {}, command: 'set_material' },
      ],
      summary: 'changed materials',
    });
    const plan = parseModificationPlan(json);
    expect(plan.affectedEntities).toEqual(['e1', 'e2']);
  });

  it('generates default summary when missing', () => {
    const json = JSON.stringify({
      steps: [{ action: 'add', component: 'transform', changes: {}, command: 'spawn_entity' }],
    });
    const plan = parseModificationPlan(json);
    expect(plan.summary).toBe('1 modification step(s) planned');
  });

  it('skips steps with invalid action', () => {
    const json = JSON.stringify({
      steps: [
        { action: 'update', entityId: 'e1', component: 'material', changes: {}, command: 'set_material' },
        { action: 'invalid_action', entityId: 'e2', component: 'x', changes: {}, command: 'x' },
      ],
      affectedEntities: ['e1'],
      summary: 'test',
      confidence: 0.8,
    });
    const plan = parseModificationPlan(json);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].entityId).toBe('e1');
  });

  it('throws on non-JSON input', () => {
    expect(() => parseModificationPlan('not json at all')).toThrow('Failed to parse AI response as JSON');
  });

  it('throws on non-object response', () => {
    expect(() => parseModificationPlan('"just a string"')).toThrow('AI response is not an object');
  });

  it('throws when steps array is missing', () => {
    expect(() => parseModificationPlan(JSON.stringify({ summary: 'no steps' }))).toThrow('missing "steps" array');
  });

  it('handles steps with missing optional fields gracefully', () => {
    const json = JSON.stringify({
      steps: [{ action: 'add', component: 'transform', command: 'spawn_entity' }],
      summary: 'spawn',
      confidence: 0.7,
    });
    const plan = parseModificationPlan(json);
    expect(plan.steps[0].entityId).toBeUndefined();
    expect(plan.steps[0].changes).toEqual({});
  });

  it('handles multi-step plans', () => {
    const json = JSON.stringify({
      steps: [
        { action: 'update', entityId: 'e1', component: 'transform', changes: { position: [0, 5, 0] }, command: 'set_transform' },
        { action: 'update', entityId: 'e2', component: 'material', changes: { baseColor: [1, 0, 0, 1] }, command: 'set_material' },
        { action: 'update', entityId: 'e3', component: 'light', changes: { intensity: 5.0 }, command: 'set_light' },
      ],
      affectedEntities: ['e1', 'e2', 'e3'],
      summary: 'Multiple entity updates',
      confidence: 0.85,
    });
    const plan = parseModificationPlan(json);
    expect(plan.steps).toHaveLength(3);
    expect(plan.affectedEntities).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// executeModificationPlan
// ---------------------------------------------------------------------------

describe('executeModificationPlan', () => {
  let dispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dispatch = vi.fn();
  });

  it('dispatches correct commands for each step', () => {
    const plan: ModificationPlan = {
      steps: [
        { action: 'update', entityId: 'e1', component: 'transform', changes: { position: [0, 5, 0] }, command: 'set_transform' },
        { action: 'update', entityId: 'e2', component: 'material', changes: { baseColor: [1, 0, 0, 1] }, command: 'set_material' },
      ],
      affectedEntities: ['e1', 'e2'],
      summary: 'test',
      confidence: 0.9,
    };

    const results = executeModificationPlan(plan, dispatch);

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledWith('set_transform', { entityId: 'e1', position: [0, 5, 0] });
    expect(dispatch).toHaveBeenCalledWith('set_material', { entityId: 'e2', baseColor: [1, 0, 0, 1] });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('includes entityId in payload when present', () => {
    const plan: ModificationPlan = {
      steps: [{ action: 'update', entityId: 'e5', component: 'physics', changes: { gravityScale: 0 }, command: 'set_physics' }],
      affectedEntities: ['e5'],
      summary: 'test',
      confidence: 0.8,
    };

    executeModificationPlan(plan, dispatch);
    expect(dispatch).toHaveBeenCalledWith('set_physics', { entityId: 'e5', gravityScale: 0 });
  });

  it('omits entityId from payload when not present (e.g. environment changes)', () => {
    const plan: ModificationPlan = {
      steps: [{ action: 'update', component: 'environment', changes: { clearColor: [0.5, 0.3, 0.1] }, command: 'set_environment' }],
      affectedEntities: [],
      summary: 'test',
      confidence: 0.9,
    };

    executeModificationPlan(plan, dispatch);
    expect(dispatch).toHaveBeenCalledWith('set_environment', { clearColor: [0.5, 0.3, 0.1] });
  });

  it('reports error when command is missing', () => {
    const plan: ModificationPlan = {
      steps: [{ action: 'update', entityId: 'e1', component: 'x', changes: {}, command: '' }],
      affectedEntities: ['e1'],
      summary: 'test',
      confidence: 0.5,
    };

    const results = executeModificationPlan(plan, dispatch);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Missing command name');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('catches dispatch errors and reports them', () => {
    dispatch.mockImplementation(() => { throw new Error('Engine error'); });

    const plan: ModificationPlan = {
      steps: [{ action: 'update', entityId: 'e1', component: 'material', changes: {}, command: 'set_material' }],
      affectedEntities: ['e1'],
      summary: 'test',
      confidence: 0.9,
    };

    const results = executeModificationPlan(plan, dispatch);
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Engine error');
  });

  it('handles empty plan gracefully', () => {
    const plan: ModificationPlan = {
      steps: [],
      affectedEntities: [],
      summary: 'nothing',
      confidence: 1,
    };

    const results = executeModificationPlan(plan, dispatch);
    expect(results).toHaveLength(0);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// filterEntitiesByScope
// ---------------------------------------------------------------------------

describe('filterEntitiesByScope', () => {
  const entities = [
    { id: 'e1', name: 'Player', type: 'mesh', components: ['Mesh3d'], visible: true, parentId: null },
    { id: 'e2', name: 'Enemy', type: 'mesh', components: ['Mesh3d'], visible: true, parentId: null },
    { id: 'e3', name: 'Light', type: 'point_light', components: ['PointLight'], visible: true, parentId: null },
  ];

  it('returns only selected entities for "selected" scope', () => {
    const result = filterEntitiesByScope(entities, ['e1'], 'selected');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e1');
  });

  it('returns all entities for "selected" scope when no selection', () => {
    const result = filterEntitiesByScope(entities, [], 'selected');
    expect(result).toHaveLength(3);
  });

  it('returns all entities for "scene" scope', () => {
    const result = filterEntitiesByScope(entities, ['e1'], 'scene');
    expect(result).toHaveLength(3);
  });

  it('returns all entities for "all" scope', () => {
    const result = filterEntitiesByScope(entities, [], 'all');
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// buildModificationPrompt
// ---------------------------------------------------------------------------

describe('buildModificationPrompt', () => {
  it('includes the user description', () => {
    const ctx = createMockSceneContext();
    const prompt = buildModificationPrompt({ description: 'make enemies faster' }, ctx);
    expect(prompt).toContain('make enemies faster');
  });

  it('includes entity list', () => {
    const ctx = createMockSceneContext();
    const prompt = buildModificationPrompt({ description: 'test' }, ctx);
    expect(prompt).toContain('Player');
    expect(prompt).toContain('Enemy');
    expect(prompt).toContain('Sun');
  });

  it('shows scope', () => {
    const ctx = createMockSceneContext();
    const prompt = buildModificationPrompt({ description: 'test', scope: 'selected' }, ctx);
    expect(prompt).toContain('Scope: selected');
  });

  it('filters entities by selected scope', () => {
    const ctx = createMockSceneContext({ selectedIds: ['e1'] });
    const prompt = buildModificationPrompt({ description: 'test', scope: 'selected' }, ctx);
    expect(prompt).toContain('Player');
    expect(prompt).not.toContain('"Enemy"');
  });

  it('handles empty scene', () => {
    const ctx = createMockSceneContext({ entities: [] });
    const prompt = buildModificationPrompt({ description: 'test' }, ctx);
    expect(prompt).toContain('(empty scene)');
  });
});

// ---------------------------------------------------------------------------
// buildSceneContext
// ---------------------------------------------------------------------------

describe('buildSceneContext', () => {
  it('extracts entities from scene graph', () => {
    const store: SceneContextStore = {
      sceneGraph: {
        nodes: {
          'e1': { entityId: 'e1', name: 'Cube', parentId: null, children: [], components: ['Mesh3d', 'Transform'], visible: true },
          'e2': { entityId: 'e2', name: 'Light', parentId: null, children: [], components: ['PointLight'], visible: false },
        },
        rootIds: ['e1', 'e2'],
      },
      selectedIds: new Set(['e1']),
      ambientLight: { color: [1, 1, 1], brightness: 0.5 },
      environment: { clearColor: [0, 0, 0], fogEnabled: false, skyboxPreset: null },
      engineMode: 'edit',
    };

    const ctx = buildSceneContext(store);
    expect(ctx.entities).toHaveLength(2);
    expect(ctx.entities[0].name).toBe('Cube');
    expect(ctx.entities[0].type).toBe('mesh');
    expect(ctx.entities[1].name).toBe('Light');
    expect(ctx.entities[1].type).toBe('point_light');
    expect(ctx.entities[1].visible).toBe(false);
    expect(ctx.selectedIds).toEqual(['e1']);
    expect(ctx.sceneSettings).toHaveProperty('ambientLight');
    expect(ctx.sceneSettings).toHaveProperty('environment');
  });

  it('handles empty scene', () => {
    const store: SceneContextStore = {
      sceneGraph: { nodes: {}, rootIds: [] },
      selectedIds: new Set(),
      ambientLight: { color: [1, 1, 1], brightness: 0.3 },
      environment: { clearColor: [0, 0, 0], fogEnabled: false, skyboxPreset: null },
      engineMode: 'edit',
    };

    const ctx = buildSceneContext(store);
    expect(ctx.entities).toHaveLength(0);
    expect(ctx.selectedIds).toHaveLength(0);
  });

  it('infers entity types correctly', () => {
    const store: SceneContextStore = {
      sceneGraph: {
        nodes: {
          'a': { entityId: 'a', name: 'Terrain', parentId: null, children: [], components: ['TerrainEnabled', 'Mesh3d'], visible: true },
          'b': { entityId: 'b', name: 'DLight', parentId: null, children: [], components: ['DirectionalLight'], visible: true },
          'c': { entityId: 'c', name: 'SLight', parentId: null, children: [], components: ['SpotLight'], visible: true },
          'd': { entityId: 'd', name: 'Spr', parentId: null, children: [], components: ['SpriteData'], visible: true },
          'e': { entityId: 'e', name: 'Empty', parentId: null, children: [], components: ['Transform'], visible: true },
        },
        rootIds: ['a', 'b', 'c', 'd', 'e'],
      },
      selectedIds: new Set(),
      ambientLight: { color: [1, 1, 1], brightness: 0.3 },
      environment: { clearColor: [0, 0, 0], fogEnabled: false, skyboxPreset: null },
      engineMode: 'edit',
    };

    const ctx = buildSceneContext(store);
    const typeMap = Object.fromEntries(ctx.entities.map((e) => [e.name, e.type]));
    expect(typeMap['Terrain']).toBe('terrain');
    expect(typeMap['DLight']).toBe('directional_light');
    expect(typeMap['SLight']).toBe('spot_light');
    expect(typeMap['Spr']).toBe('sprite');
    expect(typeMap['Empty']).toBe('entity');
  });
});

// ---------------------------------------------------------------------------
// planModification (with mocked fetch)
// ---------------------------------------------------------------------------

describe('planModification', () => {
  it('calls the AI API and returns a parsed plan', async () => {
    const mockResponse = createValidPlanJSON();
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: mockResponse }),
    });

    const ctx = createMockSceneContext();
    const plan = await planModification(
      { description: 'make enemies faster' },
      ctx,
      { fetchFn },
    );

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(plan.steps).toHaveLength(1);
    expect(plan.confidence).toBe(0.9);
  });

  it('handles text field in response', async () => {
    const mockResponse = createValidPlanJSON();
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: mockResponse }),
    });

    const ctx = createMockSceneContext();
    const plan = await planModification({ description: 'test' }, ctx, { fetchFn });
    expect(plan.steps).toHaveLength(1);
  });

  it('handles choices format in response', async () => {
    const mockResponse = createValidPlanJSON();
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: mockResponse } }] }),
    });

    const ctx = createMockSceneContext();
    const plan = await planModification({ description: 'test' }, ctx, { fetchFn });
    expect(plan.steps).toHaveLength(1);
  });

  it('throws on non-OK response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const ctx = createMockSceneContext();
    await expect(
      planModification({ description: 'test' }, ctx, { fetchFn }),
    ).rejects.toThrow('AI API returned 500');
  });

  it('throws on empty response', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const ctx = createMockSceneContext();
    await expect(
      planModification({ description: 'test' }, ctx, { fetchFn }),
    ).rejects.toThrow('AI API returned empty response');
  });

  it('sends system prompt and user prompt in request body', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: createValidPlanJSON() }),
    });

    const ctx = createMockSceneContext();
    await planModification({ description: 'make it red' }, ctx, { fetchFn });

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.system).toBe(MODIFIER_SYSTEM_PROMPT);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toContain('make it red');
  });
});

// ---------------------------------------------------------------------------
// MODIFIER_SYSTEM_PROMPT
// ---------------------------------------------------------------------------

describe('MODIFIER_SYSTEM_PROMPT', () => {
  it('mentions key engine commands', () => {
    expect(MODIFIER_SYSTEM_PROMPT).toContain('set_transform');
    expect(MODIFIER_SYSTEM_PROMPT).toContain('set_material');
    expect(MODIFIER_SYSTEM_PROMPT).toContain('spawn_entity');
    expect(MODIFIER_SYSTEM_PROMPT).toContain('set_skybox');
  });

  it('mentions scope handling', () => {
    expect(MODIFIER_SYSTEM_PROMPT).toContain('selected');
    expect(MODIFIER_SYSTEM_PROMPT).toContain('scene');
  });
});
