import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { sceneManagementHandlers } from '../sceneManagementHandlers';

// ---------------------------------------------------------------------------
// Module mocks for dynamic imports inside the handlers
// ---------------------------------------------------------------------------

const mockLoadProjectScenes = vi.fn();
const mockSaveProjectScenes = vi.fn();
const mockCreateScene = vi.fn();
const mockSwitchScene = vi.fn();
const mockDuplicateScene = vi.fn();
const mockDeleteScene = vi.fn();
const mockRenameScene = vi.fn();
const mockSetStartScene = vi.fn();
const mockGetSceneByName = vi.fn();

vi.mock('@/lib/scenes/sceneManager', () => ({
  loadProjectScenes: (...args: unknown[]) => mockLoadProjectScenes(...args),
  saveProjectScenes: (...args: unknown[]) => mockSaveProjectScenes(...args),
  createScene: (...args: unknown[]) => mockCreateScene(...args),
  switchScene: (...args: unknown[]) => mockSwitchScene(...args),
  duplicateScene: (...args: unknown[]) => mockDuplicateScene(...args),
  deleteScene: (...args: unknown[]) => mockDeleteScene(...args),
  renameScene: (...args: unknown[]) => mockRenameScene(...args),
  setStartScene: (...args: unknown[]) => mockSetStartScene(...args),
  getSceneByName: (...args: unknown[]) => mockGetSceneByName(...args),
}));

const mockTemplateRegistry = [
  {
    id: 'platformer',
    name: '3D Platformer',
    description: 'Jump between floating platforms.',
    category: 'platformer',
    difficulty: 'beginner',
    entityCount: 32,
    tags: ['3d', 'platformer'],
  },
  {
    id: 'runner',
    name: 'Endless Runner',
    description: 'Auto-run forward, dodge obstacles.',
    category: 'runner',
    difficulty: 'beginner',
    entityCount: 18,
    tags: ['3d', 'runner'],
  },
];

const mockGetTemplateInfo = vi.fn();

vi.mock('@/data/templates', () => ({
  TEMPLATE_REGISTRY: mockTemplateRegistry,
  getTemplateInfo: (...args: unknown[]) => mockGetTemplateInfo(...args),
}));

// ---------------------------------------------------------------------------
// Shared project fixture
// ---------------------------------------------------------------------------

const baseProject = {
  version: '1.0',
  activeSceneId: 'scene_1',
  scenes: [
    { id: 'scene_1', name: 'Main', isStartScene: true, data: null, createdAt: '', updatedAt: '' },
    { id: 'scene_2', name: 'Level 2', isStartScene: false, data: null, createdAt: '', updatedAt: '' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: return a stable project from storage
  mockLoadProjectScenes.mockReturnValue(baseProject);
  // Default: getSceneByName returns undefined (ID lookups pass through)
  mockGetSceneByName.mockReturnValue(undefined);
});

// ---------------------------------------------------------------------------
// export_scene
// ---------------------------------------------------------------------------

describe('export_scene', () => {
  it('calls saveScene on the store and returns success message', async () => {
    const { result, store } = await invokeHandler(sceneManagementHandlers, 'export_scene');
    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).message).toBe('Scene export triggered');
    expect(store.saveScene).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// load_scene
// ---------------------------------------------------------------------------

describe('load_scene', () => {
  it('calls loadScene with provided json and returns success message', async () => {
    const json = JSON.stringify({ entities: [] });
    const { result, store } = await invokeHandler(sceneManagementHandlers, 'load_scene', { json });
    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).message).toBe('Scene load triggered');
    expect(store.loadScene).toHaveBeenCalledWith(json);
  });

  it('returns failure when json parameter is missing', async () => {
    const { result } = await invokeHandler(sceneManagementHandlers, 'load_scene', {});
    expect(result.success).toBe(false);
    expect(result.error).not.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// new_scene
// ---------------------------------------------------------------------------

describe('new_scene', () => {
  it('calls newScene on the store and returns success message', async () => {
    const { result, store } = await invokeHandler(sceneManagementHandlers, 'new_scene');
    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).message).toBe('New scene created');
    expect(store.newScene).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// get_scene_name
// ---------------------------------------------------------------------------

describe('get_scene_name', () => {
  it('returns sceneName and modified flag from the store', async () => {
    const { result } = await invokeHandler(
      sceneManagementHandlers,
      'get_scene_name',
      {},
      { sceneName: 'MyScene', sceneModified: true }
    );
    expect(result.success).toBe(true);
    const payload = result.result as Record<string, unknown>;
    expect(payload.sceneName).toBe('MyScene');
    expect(payload.modified).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// set_input_binding
// ---------------------------------------------------------------------------

describe('set_input_binding', () => {
  it('calls setInputBinding with the full binding object', async () => {
    const args = {
      actionName: 'jump',
      actionType: 'digital',
      sources: ['keyboard'],
      positiveKeys: ['Space'],
      negativeKeys: undefined,
      deadZone: 0.1,
    };
    const { result, store } = await invokeHandler(sceneManagementHandlers, 'set_input_binding', args);
    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).message).toBe('Set binding: jump');
    expect(store.setInputBinding).toHaveBeenCalledWith({
      actionName: 'jump',
      actionType: 'digital',
      sources: ['keyboard'],
      positiveKeys: ['Space'],
      negativeKeys: undefined,
      deadZone: 0.1,
    });
  });

  it('uses default actionType "digital" when not provided', async () => {
    const { result, store } = await invokeHandler(sceneManagementHandlers, 'set_input_binding', {
      actionName: 'fire',
      sources: ['mouse'],
    });
    expect(result.success).toBe(true);
    expect(store.setInputBinding).toHaveBeenCalledWith(
      expect.objectContaining({ actionName: 'fire', actionType: 'digital' })
    );
  });

  it('uses default empty sources array when not provided', async () => {
    const { result, store } = await invokeHandler(sceneManagementHandlers, 'set_input_binding', {
      actionName: 'dash',
    });
    expect(result.success).toBe(true);
    expect(store.setInputBinding).toHaveBeenCalledWith(
      expect.objectContaining({ actionName: 'dash', sources: [] })
    );
  });
});

// ---------------------------------------------------------------------------
// remove_input_binding
// ---------------------------------------------------------------------------

describe('remove_input_binding', () => {
  it('calls removeInputBinding with the action name and returns success message', async () => {
    const { result, store } = await invokeHandler(
      sceneManagementHandlers,
      'remove_input_binding',
      { actionName: 'jump' }
    );
    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).message).toBe('Removed binding: jump');
    expect(store.removeInputBinding).toHaveBeenCalledWith('jump');
  });
});

// ---------------------------------------------------------------------------
// set_input_preset
// ---------------------------------------------------------------------------

describe('set_input_preset', () => {
  it('calls setInputPreset with the provided preset and returns success message', async () => {
    const { result, store } = await invokeHandler(
      sceneManagementHandlers,
      'set_input_preset',
      { preset: 'platformer' }
    );
    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).message).toBe('Applied input preset: platformer');
    expect(store.setInputPreset).toHaveBeenCalledWith('platformer');
  });
});

// ---------------------------------------------------------------------------
// get_input_bindings
// ---------------------------------------------------------------------------

describe('get_input_bindings', () => {
  it('returns bindings, preset, and count from the store', async () => {
    const bindings = [
      { actionName: 'jump', actionType: 'digital' as const, sources: ['Space'] },
    ];
    const { result } = await invokeHandler(
      sceneManagementHandlers,
      'get_input_bindings',
      {},
      { inputBindings: bindings, inputPreset: 'platformer' }
    );
    expect(result.success).toBe(true);
    const payload = result.result as Record<string, unknown>;
    expect(payload.bindings).toEqual(bindings);
    expect(payload.preset).toBe('platformer');
    expect(payload.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// get_input_state
// ---------------------------------------------------------------------------

describe('get_input_state', () => {
  it('returns the engine mode and a guidance message', async () => {
    const { result } = await invokeHandler(
      sceneManagementHandlers,
      'get_input_state',
      {},
      { engineMode: 'play' }
    );
    expect(result.success).toBe(true);
    const payload = result.result as Record<string, unknown>;
    expect(payload.mode).toBe('play');
    expect(typeof payload.message).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// set_quality_preset
// ---------------------------------------------------------------------------

describe('set_quality_preset', () => {
  it('calls setQualityPreset and returns success with preset name', async () => {
    const { result, store } = await invokeHandler(
      sceneManagementHandlers,
      'set_quality_preset',
      { preset: 'high' }
    );
    expect(result.success).toBe(true);
    expect(result.result).toContain('high');
    expect(store.setQualityPreset).toHaveBeenCalledWith('high');
  });

  it('returns failure when preset parameter is missing', async () => {
    const { result } = await invokeHandler(sceneManagementHandlers, 'set_quality_preset', {});
    expect(result.success).toBe(false);
    expect(result.error).not.toBeUndefined();
  });

  it('forwards "low" preset to setQualityPreset', async () => {
    const { result, store } = await invokeHandler(
      sceneManagementHandlers,
      'set_quality_preset',
      { preset: 'low' }
    );
    expect(result.success).toBe(true);
    expect(store.setQualityPreset).toHaveBeenCalledWith('low');
  });

  it('forwards "ultra" preset to setQualityPreset', async () => {
    const { store } = await invokeHandler(
      sceneManagementHandlers,
      'set_quality_preset',
      { preset: 'ultra' }
    );
    expect(store.setQualityPreset).toHaveBeenCalledWith('ultra');
  });
});

// ---------------------------------------------------------------------------
// get_quality_settings
// ---------------------------------------------------------------------------

describe('get_quality_settings', () => {
  it('returns the current quality preset from the store', async () => {
    const { result } = await invokeHandler(
      sceneManagementHandlers,
      'get_quality_settings',
      {},
      { qualityPreset: 'ultra' }
    );
    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).preset).toBe('ultra');
  });
});

// ---------------------------------------------------------------------------
// create_scene
// ---------------------------------------------------------------------------

describe('create_scene', () => {
  it('creates a scene, persists it, and updates the store', async () => {
    const newSceneId = 'scene_new_123';
    const updatedProject = {
      ...baseProject,
      scenes: [
        ...baseProject.scenes,
        { id: newSceneId, name: 'Boss Fight', isStartScene: false, data: null, createdAt: '', updatedAt: '' },
      ],
    };
    mockCreateScene.mockReturnValue({ project: updatedProject, sceneId: newSceneId });

    const { result, store } = await invokeHandler(
      sceneManagementHandlers,
      'create_scene',
      { name: 'Boss Fight' }
    );

    expect(result.success).toBe(true);
    const payload = result.result as Record<string, unknown>;
    expect(payload.sceneId).toBe(newSceneId);
    expect((payload.message as string)).toContain('Boss Fight');

    expect(mockLoadProjectScenes).toHaveBeenCalled();
    expect(mockCreateScene).toHaveBeenCalledWith(baseProject, 'Boss Fight');
    expect(mockSaveProjectScenes).toHaveBeenCalledWith(updatedProject);
    expect(store.setScenes).toHaveBeenCalledWith(
      updatedProject.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
      updatedProject.activeSceneId
    );
  });
});

// ---------------------------------------------------------------------------
// switch_scene
// ---------------------------------------------------------------------------

describe('switch_scene', () => {
  it('switches by ID when no name match exists, loads scene data, and updates the store', async () => {
    const updatedProject = { ...baseProject, activeSceneId: 'scene_2' };
    const sceneData = { formatVersion: 1, sceneName: 'Level 2', entities: [] };
    mockSwitchScene.mockReturnValue({ project: updatedProject, sceneToLoad: sceneData });

    const { result, store } = await invokeHandler(
      sceneManagementHandlers,
      'switch_scene',
      { sceneId: 'scene_2' }
    );

    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).message).toContain('Switched');
    expect(mockSwitchScene).toHaveBeenCalledWith(baseProject, 'scene_2');
    expect(store.loadScene).toHaveBeenCalledWith(JSON.stringify(sceneData));
    expect(store.setScenes).toHaveBeenCalled();
  });

  it('resolves scene by name when getSceneByName returns a match', async () => {
    mockGetSceneByName.mockReturnValue(baseProject.scenes[1]);
    const updatedProject = { ...baseProject, activeSceneId: 'scene_2' };
    mockSwitchScene.mockReturnValue({ project: updatedProject, sceneToLoad: null });

    const { result, store } = await invokeHandler(
      sceneManagementHandlers,
      'switch_scene',
      { sceneId: 'Level 2' }
    );

    expect(result.success).toBe(true);
    // When sceneToLoad is null, newScene should be called instead of loadScene
    expect(store.newScene).toHaveBeenCalled();
    expect(mockSwitchScene).toHaveBeenCalledWith(baseProject, 'scene_2');
  });

  it('returns failure when switchScene returns an error', async () => {
    mockSwitchScene.mockReturnValue({ error: 'Scene not found' });

    const { result } = await invokeHandler(
      sceneManagementHandlers,
      'switch_scene',
      { sceneId: 'nonexistent_id' }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Scene not found');
  });

  it('calls newScene when sceneToLoad is null', async () => {
    const updatedProject = { ...baseProject, activeSceneId: 'scene_2' };
    mockSwitchScene.mockReturnValue({ project: updatedProject, sceneToLoad: null });

    const { store } = await invokeHandler(
      sceneManagementHandlers,
      'switch_scene',
      { sceneId: 'scene_2' }
    );

    expect(store.newScene).toHaveBeenCalled();
    expect(store.loadScene).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// duplicate_scene
// ---------------------------------------------------------------------------

describe('duplicate_scene', () => {
  it('duplicates a scene and updates the store', async () => {
    const newSceneId = 'scene_copy_abc';
    const updatedProject = {
      ...baseProject,
      scenes: [
        ...baseProject.scenes,
        { id: newSceneId, name: 'Main Copy', isStartScene: false, data: null, createdAt: '', updatedAt: '' },
      ],
    };
    mockDuplicateScene.mockReturnValue({ project: updatedProject, newSceneId });

    const { result, store } = await invokeHandler(
      sceneManagementHandlers,
      'duplicate_scene',
      { sceneId: 'scene_1' }
    );

    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).sceneId).toBe(newSceneId);
    expect(mockDuplicateScene).toHaveBeenCalledWith(baseProject, 'scene_1', undefined);
    expect(store.setScenes).toHaveBeenCalled();
  });

  it('passes optional name to duplicateScene', async () => {
    const newSceneId = 'scene_dup_xyz';
    mockDuplicateScene.mockReturnValue({
      project: baseProject,
      newSceneId,
    });

    await invokeHandler(sceneManagementHandlers, 'duplicate_scene', {
      sceneId: 'scene_1',
      name: 'Custom Copy',
    });

    expect(mockDuplicateScene).toHaveBeenCalledWith(baseProject, 'scene_1', 'Custom Copy');
  });

  it('returns failure when duplicateScene returns an error', async () => {
    mockDuplicateScene.mockReturnValue({ error: 'Scene not found' });

    const { result } = await invokeHandler(
      sceneManagementHandlers,
      'duplicate_scene',
      { sceneId: 'bad_id' }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Scene not found');
  });
});

// ---------------------------------------------------------------------------
// delete_scene
// ---------------------------------------------------------------------------

describe('delete_scene', () => {
  it('deletes a scene and updates the store', async () => {
    const trimmedProject = {
      ...baseProject,
      scenes: [baseProject.scenes[0]],
    };
    mockDeleteScene.mockReturnValue({ project: trimmedProject });

    const { result, store } = await invokeHandler(
      sceneManagementHandlers,
      'delete_scene',
      { sceneId: 'scene_2' }
    );

    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).message).toBe('Scene deleted');
    expect(mockDeleteScene).toHaveBeenCalledWith(baseProject, 'scene_2');
    expect(store.setScenes).toHaveBeenCalled();
  });

  it('returns failure when deleteScene returns an error', async () => {
    mockDeleteScene.mockReturnValue({ project: baseProject, error: 'Cannot delete the last scene' });

    const { result } = await invokeHandler(
      sceneManagementHandlers,
      'delete_scene',
      { sceneId: 'scene_1' }
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Cannot delete the last scene');
  });
});

// ---------------------------------------------------------------------------
// rename_scene
// ---------------------------------------------------------------------------

describe('rename_scene', () => {
  it('renames a scene and updates the store', async () => {
    const updatedProject = {
      ...baseProject,
      scenes: [
        { ...baseProject.scenes[0], name: 'Intro' },
        baseProject.scenes[1],
      ],
    };
    mockRenameScene.mockReturnValue(updatedProject);

    const { result, store } = await invokeHandler(
      sceneManagementHandlers,
      'rename_scene',
      { sceneId: 'scene_1', name: 'Intro' }
    );

    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).message).toContain('Intro');
    expect(mockRenameScene).toHaveBeenCalledWith(baseProject, 'scene_1', 'Intro');
    expect(store.setScenes).toHaveBeenCalledWith(
      updatedProject.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
      updatedProject.activeSceneId
    );
  });
});

// ---------------------------------------------------------------------------
// set_start_scene
// ---------------------------------------------------------------------------

describe('set_start_scene', () => {
  it('sets the start scene and updates the store', async () => {
    const updatedProject = {
      ...baseProject,
      scenes: [
        { ...baseProject.scenes[0], isStartScene: false },
        { ...baseProject.scenes[1], isStartScene: true },
      ],
    };
    mockSetStartScene.mockReturnValue(updatedProject);

    const { result, store } = await invokeHandler(
      sceneManagementHandlers,
      'set_start_scene',
      { sceneId: 'scene_2' }
    );

    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).message).toBe('Start scene updated');
    expect(mockSetStartScene).toHaveBeenCalledWith(baseProject, 'scene_2');
    expect(store.setScenes).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// list_scenes
// ---------------------------------------------------------------------------

describe('list_scenes', () => {
  it('lists all scenes with active flag derived from activeSceneId', async () => {
    const { result } = await invokeHandler(sceneManagementHandlers, 'list_scenes');

    expect(result.success).toBe(true);
    const payload = result.result as Record<string, unknown>;
    expect(payload.activeSceneId).toBe('scene_1');
    const scenes = payload.scenes as Array<Record<string, unknown>>;
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({ id: 'scene_1', name: 'Main', isStartScene: true, isActive: true });
    expect(scenes[1]).toMatchObject({ id: 'scene_2', name: 'Level 2', isStartScene: false, isActive: false });
  });
});

// ---------------------------------------------------------------------------
// load_scene_with_transition
// ---------------------------------------------------------------------------

describe('load_scene_with_transition', () => {
  it('calls startSceneTransition with defaults when optional params are omitted', async () => {
    const { result, store } = await invokeHandler(
      sceneManagementHandlers,
      'load_scene_with_transition',
      { sceneName: 'Level 3' }
    );

    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).message).toContain('Level 3');
    expect(store.startSceneTransition).toHaveBeenCalledWith('Level 3', {
      type: 'fade',
      duration: 500,
      color: '#000000',
      direction: 'left',
    });
  });

  it('passes explicit transition config to startSceneTransition', async () => {
    const { store } = await invokeHandler(
      sceneManagementHandlers,
      'load_scene_with_transition',
      {
        sceneName: 'Boss',
        transitionType: 'wipe',
        duration: 750,
        color: '#ffffff',
        direction: 'right',
      }
    );

    expect(store.startSceneTransition).toHaveBeenCalledWith('Boss', {
      type: 'wipe',
      duration: 750,
      color: '#ffffff',
      direction: 'right',
    });
  });
});

// ---------------------------------------------------------------------------
// set_default_transition
// ---------------------------------------------------------------------------

describe('set_default_transition', () => {
  it('calls setDefaultTransition with provided fields only', async () => {
    const { result, store } = await invokeHandler(
      sceneManagementHandlers,
      'set_default_transition',
      { transitionType: 'wipe', duration: 300 }
    );

    expect(result.success).toBe(true);
    expect(store.setDefaultTransition).toHaveBeenCalledWith({ type: 'wipe', duration: 300 });
  });

  it('omits fields that were not provided in args', async () => {
    const { store } = await invokeHandler(
      sceneManagementHandlers,
      'set_default_transition',
      { color: '#ff0000' }
    );

    const call = (store.setDefaultTransition as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(call.color).toBe('#ff0000');
    expect(call.type).toBeUndefined();
    expect(call.duration).toBeUndefined();
  });

  it('uses "updated" wording in message when transitionType is absent', async () => {
    const { result } = await invokeHandler(
      sceneManagementHandlers,
      'set_default_transition',
      { duration: 200 }
    );
    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).message).toContain('updated');
  });
});

// ---------------------------------------------------------------------------
// list_templates
// ---------------------------------------------------------------------------

describe('list_templates', () => {
  it('returns all templates when no category filter is provided', async () => {
    const { result } = await invokeHandler(sceneManagementHandlers, 'list_templates');

    expect(result.success).toBe(true);
    const templates = result.result as Array<Record<string, unknown>>;
    expect(templates).toHaveLength(2);
    expect(templates[0]).toMatchObject({ id: 'platformer', category: 'platformer' });
    expect(templates[1]).toMatchObject({ id: 'runner', category: 'runner' });
  });

  it('filters templates by category', async () => {
    const { result } = await invokeHandler(
      sceneManagementHandlers,
      'list_templates',
      { category: 'runner' }
    );

    const templates = result.result as Array<Record<string, unknown>>;
    expect(templates).toHaveLength(1);
    expect(templates[0].id).toBe('runner');
  });

  it('returns empty array for an unmatched category', async () => {
    const { result } = await invokeHandler(
      sceneManagementHandlers,
      'list_templates',
      { category: 'nonexistent' }
    );

    const templates = result.result as Array<Record<string, unknown>>;
    expect(templates).toHaveLength(0);
  });

  it('exposes the expected template fields', async () => {
    const { result } = await invokeHandler(sceneManagementHandlers, 'list_templates');
    const first = (result.result as Array<Record<string, unknown>>)[0];
    expect(Object.keys(first)).toEqual(
      expect.arrayContaining(['id', 'name', 'description', 'category', 'difficulty', 'entityCount', 'tags'])
    );
  });
});

// ---------------------------------------------------------------------------
// load_template
// ---------------------------------------------------------------------------

describe('load_template', () => {
  it('calls loadTemplate on the store with the templateId and returns success', async () => {
    const { result, store } = await invokeHandler(
      sceneManagementHandlers,
      'load_template',
      { templateId: 'platformer' }
    );

    expect(result.success).toBe(true);
    expect((result.result as Record<string, unknown>).message).toContain('platformer');
    expect(store.loadTemplate).toHaveBeenCalledWith('platformer');
  });

  it('returns failure when templateId is missing', async () => {
    const { result } = await invokeHandler(sceneManagementHandlers, 'load_template', {});

    expect(result.success).toBe(false);
    expect(result.error).not.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// get_template_info
// ---------------------------------------------------------------------------

describe('get_template_info', () => {
  it('returns template info when the template exists', async () => {
    const info = { id: 'platformer', name: '3D Platformer', description: 'Jump and run.' };
    mockGetTemplateInfo.mockReturnValue(info);

    const { result } = await invokeHandler(
      sceneManagementHandlers,
      'get_template_info',
      { templateId: 'platformer' }
    );

    expect(result.success).toBe(true);
    expect(result.result).toEqual(info);
    expect(mockGetTemplateInfo).toHaveBeenCalledWith('platformer');
  });

  it('returns failure when the template is not found', async () => {
    mockGetTemplateInfo.mockReturnValue(null);

    const { result } = await invokeHandler(
      sceneManagementHandlers,
      'get_template_info',
      { templateId: 'missing_template' }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('missing_template');
  });
});

// ---------------------------------------------------------------------------
// Documentation stub handlers
// ---------------------------------------------------------------------------

describe('search_docs', () => {
  it('returns success with an MCP server delegation message', async () => {
    const { result } = await invokeHandler(sceneManagementHandlers, 'search_docs');
    expect(result.success).toBe(true);
    expect(((result.result as Record<string, unknown>).message as string)).toContain('MCP server');
  });
});

describe('get_doc', () => {
  it('returns success with an MCP server delegation message', async () => {
    const { result } = await invokeHandler(sceneManagementHandlers, 'get_doc');
    expect(result.success).toBe(true);
    expect(((result.result as Record<string, unknown>).message as string)).toContain('MCP server');
  });
});

describe('list_doc_topics', () => {
  it('returns success with an MCP server delegation message', async () => {
    const { result } = await invokeHandler(sceneManagementHandlers, 'list_doc_topics');
    expect(result.success).toBe(true);
    expect(((result.result as Record<string, unknown>).message as string)).toContain('MCP server');
  });
});
