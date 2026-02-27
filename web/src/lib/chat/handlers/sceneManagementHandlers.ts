/**
 * Scene management handlers — save/load scene, input bindings, multi-scene,
 * scene transitions, templates, quality presets, and documentation tools.
 */

import type { ToolHandler, ExecutionResult, InputBinding } from './types';

export const sceneManagementHandlers: Record<string, ToolHandler> = {
  export_scene: async (_args, ctx): Promise<ExecutionResult> => {
    ctx.store.saveScene();
    return { success: true, result: { message: 'Scene export triggered' } };
  },

  load_scene: async (args, ctx): Promise<ExecutionResult> => {
    const json = args.json as string;
    if (!json) return { success: false, error: 'Missing json parameter' };
    ctx.store.loadScene(json);
    return { success: true, result: { message: 'Scene load triggered' } };
  },

  new_scene: async (_args, ctx): Promise<ExecutionResult> => {
    ctx.store.newScene();
    return { success: true, result: { message: 'New scene created' } };
  },

  get_scene_name: async (_args, ctx): Promise<ExecutionResult> => {
    return {
      success: true,
      result: { sceneName: ctx.store.sceneName, modified: ctx.store.sceneModified },
    };
  },

  set_input_binding: async (args, ctx): Promise<ExecutionResult> => {
    const binding: InputBinding = {
      actionName: args.actionName as string,
      actionType: (args.actionType as 'digital' | 'axis') ?? 'digital',
      sources: (args.sources as string[]) ?? [],
      positiveKeys: args.positiveKeys as string[] | undefined,
      negativeKeys: args.negativeKeys as string[] | undefined,
      deadZone: args.deadZone as number | undefined,
    };
    ctx.store.setInputBinding(binding);
    return { success: true, result: { message: `Set binding: ${binding.actionName}` } };
  },

  remove_input_binding: async (args, ctx): Promise<ExecutionResult> => {
    ctx.store.removeInputBinding(args.actionName as string);
    return { success: true, result: { message: `Removed binding: ${args.actionName}` } };
  },

  set_input_preset: async (args, ctx): Promise<ExecutionResult> => {
    ctx.store.setInputPreset(args.preset as 'fps' | 'platformer' | 'topdown' | 'racing');
    return { success: true, result: { message: `Applied input preset: ${args.preset}` } };
  },

  get_input_bindings: async (_args, ctx): Promise<ExecutionResult> => {
    return {
      success: true,
      result: {
        bindings: ctx.store.inputBindings,
        preset: ctx.store.inputPreset,
        count: ctx.store.inputBindings.length,
      },
    };
  },

  get_input_state: async (_args, ctx): Promise<ExecutionResult> => {
    // Input state is transient and only meaningful during Play mode
    return {
      success: true,
      result: {
        message: 'Input state is only available during Play mode',
        mode: ctx.store.engineMode,
      },
    };
  },

  create_scene: async (args, ctx): Promise<ExecutionResult> => {
    const { createScene, loadProjectScenes, saveProjectScenes } = await import('@/lib/scenes/sceneManager');
    const project = loadProjectScenes();
    const result = createScene(project, args.name as string);
    saveProjectScenes(result.project);
    ctx.store.setScenes(
      result.project.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
      result.project.activeSceneId
    );
    return { success: true, result: { sceneId: result.sceneId, message: `Created scene "${args.name}"` } };
  },

  switch_scene: async (args, ctx): Promise<ExecutionResult> => {
    const { switchScene, loadProjectScenes, saveProjectScenes, getSceneByName } = await import('@/lib/scenes/sceneManager');
    const project = loadProjectScenes();
    const sceneIdInput = args.sceneId as string;
    // Try by ID first, then by name
    let targetId = sceneIdInput;
    const byName = getSceneByName(project, sceneIdInput);
    if (byName) targetId = byName.id;

    const result = switchScene(project, targetId);
    if ('error' in result) return { success: false, error: result.error };

    saveProjectScenes(result.project);
    ctx.store.setScenes(
      result.project.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
      result.project.activeSceneId
    );
    // Load the scene data into the engine
    if (result.sceneToLoad) {
      ctx.store.loadScene(JSON.stringify(result.sceneToLoad));
    } else {
      ctx.store.newScene();
    }
    return { success: true, result: { message: `Switched to scene` } };
  },

  duplicate_scene: async (args, ctx): Promise<ExecutionResult> => {
    const { duplicateScene, loadProjectScenes, saveProjectScenes, getSceneByName } = await import('@/lib/scenes/sceneManager');
    const project = loadProjectScenes();
    const sceneIdInput = args.sceneId as string;
    let targetId = sceneIdInput;
    const byName = getSceneByName(project, sceneIdInput);
    if (byName) targetId = byName.id;

    const result = duplicateScene(project, targetId, args.name as string | undefined);
    if ('error' in result) return { success: false, error: result.error };

    saveProjectScenes(result.project);
    ctx.store.setScenes(
      result.project.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
      result.project.activeSceneId
    );
    return { success: true, result: { sceneId: result.newSceneId, message: `Duplicated scene` } };
  },

  delete_scene: async (args, ctx): Promise<ExecutionResult> => {
    const { deleteScene, loadProjectScenes, saveProjectScenes, getSceneByName } = await import('@/lib/scenes/sceneManager');
    const project = loadProjectScenes();
    const sceneIdInput = args.sceneId as string;
    let targetId = sceneIdInput;
    const byName = getSceneByName(project, sceneIdInput);
    if (byName) targetId = byName.id;

    const result = deleteScene(project, targetId);
    if (result.error) return { success: false, error: result.error };

    saveProjectScenes(result.project);
    ctx.store.setScenes(
      result.project.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
      result.project.activeSceneId
    );
    return { success: true, result: { message: 'Scene deleted' } };
  },

  rename_scene: async (args, ctx): Promise<ExecutionResult> => {
    const { renameScene, loadProjectScenes, saveProjectScenes, getSceneByName } = await import('@/lib/scenes/sceneManager');
    const project = loadProjectScenes();
    const sceneIdInput = args.sceneId as string;
    let targetId = sceneIdInput;
    const byName = getSceneByName(project, sceneIdInput);
    if (byName) targetId = byName.id;

    const updated = renameScene(project, targetId, args.name as string);
    saveProjectScenes(updated);
    ctx.store.setScenes(
      updated.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
      updated.activeSceneId
    );
    return { success: true, result: { message: `Renamed scene to "${args.name}"` } };
  },

  set_start_scene: async (args, ctx): Promise<ExecutionResult> => {
    const { setStartScene, loadProjectScenes, saveProjectScenes, getSceneByName } = await import('@/lib/scenes/sceneManager');
    const project = loadProjectScenes();
    const sceneIdInput = args.sceneId as string;
    let targetId = sceneIdInput;
    const byName = getSceneByName(project, sceneIdInput);
    if (byName) targetId = byName.id;

    const updated = setStartScene(project, targetId);
    saveProjectScenes(updated);
    ctx.store.setScenes(
      updated.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
      updated.activeSceneId
    );
    return { success: true, result: { message: 'Start scene updated' } };
  },

  list_scenes: async (_args, _ctx): Promise<ExecutionResult> => {
    const { loadProjectScenes } = await import('@/lib/scenes/sceneManager');
    const project = loadProjectScenes();
    return {
      success: true,
      result: {
        scenes: project.scenes.map((s) => ({
          id: s.id,
          name: s.name,
          isStartScene: s.isStartScene,
          isActive: s.id === project.activeSceneId,
        })),
        activeSceneId: project.activeSceneId,
      },
    };
  },

  load_scene_with_transition: async (args, ctx): Promise<ExecutionResult> => {
    const { sceneName, transitionType, duration, color, direction } = args as {
      sceneName: string;
      transitionType?: string;
      duration?: number;
      color?: string;
      direction?: string;
    };
    await ctx.store.startSceneTransition(sceneName, {
      type: (transitionType as 'fade' | 'wipe' | 'instant') || 'fade',
      duration: duration || 500,
      color: color || '#000000',
      direction: (direction as 'left' | 'right' | 'up' | 'down') || 'left',
    });
    return {
      success: true,
      result: { message: `Loaded scene "${sceneName}" with ${transitionType || 'fade'} transition` },
    };
  },

  set_default_transition: async (args, ctx): Promise<ExecutionResult> => {
    const { transitionType, duration, color, direction, easing } = args as {
      transitionType?: string;
      duration?: number;
      color?: string;
      direction?: string;
      easing?: string;
    };
    ctx.store.setDefaultTransition({
      ...(transitionType ? { type: transitionType as 'fade' | 'wipe' | 'instant' } : {}),
      ...(duration !== undefined ? { duration } : {}),
      ...(color ? { color } : {}),
      ...(direction ? { direction: direction as 'left' | 'right' | 'up' | 'down' } : {}),
      ...(easing ? { easing: easing as 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' } : {}),
    });
    return {
      success: true,
      result: { message: `Default transition set to ${transitionType || 'updated'}` },
    };
  },

  list_templates: async (args, _ctx): Promise<ExecutionResult> => {
    const { TEMPLATE_REGISTRY } = await import('@/data/templates');
    const category = args.category as string | undefined;
    const templates = category
      ? TEMPLATE_REGISTRY.filter((t) => t.category === category)
      : TEMPLATE_REGISTRY;
    return {
      success: true,
      result: templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        difficulty: t.difficulty,
        entityCount: t.entityCount,
        tags: t.tags,
      })),
    };
  },

  load_template: async (args, ctx): Promise<ExecutionResult> => {
    const templateId = args.templateId as string;
    if (!templateId) return { success: false, error: 'Missing templateId' };
    await ctx.store.loadTemplate(templateId);
    return { success: true, result: { message: `Loaded template: ${templateId}` } };
  },

  get_template_info: async (args, _ctx): Promise<ExecutionResult> => {
    const { getTemplateInfo } = await import('@/data/templates');
    const info = getTemplateInfo(args.templateId as string);
    if (!info) return { success: false, error: `Template not found: ${args.templateId}` };
    return { success: true, result: info };
  },

  set_quality_preset: async (args, ctx): Promise<ExecutionResult> => {
    const preset = args.preset as string;
    if (!preset) return { success: false, error: 'preset is required' };
    ctx.store.setQualityPreset(preset as import('@/stores/editorStore').QualityPreset);
    return { success: true, result: `Quality preset set to ${preset}` };
  },

  get_quality_settings: async (_args, ctx): Promise<ExecutionResult> => {
    return { success: true, result: { preset: ctx.store.qualityPreset } };
  },

  search_docs: async (_args, _ctx): Promise<ExecutionResult> => {
    return {
      success: true,
      result: { message: `Documentation tool "search_docs" is handled by the MCP server` },
    };
  },

  get_doc: async (_args, _ctx): Promise<ExecutionResult> => {
    return {
      success: true,
      result: { message: `Documentation tool "get_doc" is handled by the MCP server` },
    };
  },

  list_doc_topics: async (_args, _ctx): Promise<ExecutionResult> => {
    return {
      success: true,
      result: { message: `Documentation tool "list_doc_topics" is handled by the MCP server` },
    };
  },
};
