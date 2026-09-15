/**
 * Scene management handlers — save/load scene, input bindings, multi-scene,
 * scene transitions, templates, quality presets, and documentation tools.
 */

import { z } from 'zod';
import type { ToolHandler, ExecutionResult, InputBinding } from './types';
import { parseArgs } from './types';
import { captureActiveScene, type SceneCapture } from '@/lib/scenes/captureScene';
import { requestSceneExport } from '@/stores/slices/sceneSlice';
import { isValidSceneFile } from '@/lib/scenes/sceneValidation';

/**
 * Read the live scene back out of the engine before a mutation moves off it
 * (PF-1100). `unavailable` means there is no engine and so no live scene to
 * lose; `failed` means one exists and could not be read, which must abort the
 * mutation rather than persist a stale copy over it.
 */
async function captureBeforeMutating(): Promise<SceneCapture> {
  return captureActiveScene(requestSceneExport);
}

function captureFailure(capture: SceneCapture, action: string): ExecutionResult | null {
  if (capture.status !== 'failed') return null;
  return { success: false, error: `Could not ${action}: ${capture.reason}` };
}

export const sceneManagementHandlers: Record<string, ToolHandler> = {
  validate_scene: async (args): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ json: z.string().min(1).max(50 * 1024 * 1024) }), args);
    if (p.error) return p.error;
    try {
      if (isValidSceneFile(JSON.parse(p.data.json))) {
        return { success: true, result: { valid: true } };
      }
    } catch {
      return { success: false, error: 'Scene JSON is malformed.' };
    }
    return { success: false, error: 'Scene validation failed or the engine is unavailable.' };
  },

  export_scene: async (_args, ctx): Promise<ExecutionResult> => {
    ctx.store.saveScene();
    return { success: true, result: { message: 'Scene export triggered' } };
  },

  load_scene: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ json: z.string().min(1) }), args);
    if (p.error) return p.error;
    ctx.store.loadScene(p.data.json);
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
    const p = parseArgs(z.object({
      actionName: z.string().min(1),
      actionType: z.enum(['digital', 'axis']).optional(),
      sources: z.array(z.string()).optional(),
      positiveKeys: z.array(z.string()).optional(),
      negativeKeys: z.array(z.string()).optional(),
      deadZone: z.number().optional(),
      // Local-player slot (0 = primary). Non-negative integer; the AI path and
      // the manual panel produce identical InputMap mutations for the same slot.
      player: z.number().int().min(0).optional(),
    }), args);
    if (p.error) return p.error;
    const binding: InputBinding = {
      actionName: p.data.actionName,
      actionType: p.data.actionType ?? 'digital',
      sources: p.data.sources ?? [],
      positiveKeys: p.data.positiveKeys,
      negativeKeys: p.data.negativeKeys,
      deadZone: p.data.deadZone,
      player: p.data.player,
    };
    ctx.store.setInputBinding(binding);
    const who = binding.player ? ` (player ${binding.player + 1})` : '';
    return { success: true, result: { message: `Set binding: ${binding.actionName}${who}` } };
  },

  remove_input_binding: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      actionName: z.string().min(1),
      player: z.number().int().min(0).optional(),
    }), args);
    if (p.error) return p.error;
    ctx.store.removeInputBinding(p.data.actionName, p.data.player);
    return { success: true, result: { message: `Removed binding: ${p.data.actionName}` } };
  },

  set_input_preset: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      preset: z.enum(['fps', 'platformer', 'topdown', 'racing']),
      player: z.number().int().min(0).optional(),
    }), args);
    if (p.error) return p.error;
    ctx.store.setInputPreset(p.data.preset, p.data.player);
    return { success: true, result: { message: `Applied input preset: ${p.data.preset}` } };
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
    return {
      success: true,
      result: {
        message: 'Input state is only available during Play mode',
        mode: ctx.store.engineMode,
      },
    };
  },

  create_scene: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ name: z.string().min(1) }), args);
    if (p.error) return p.error;
    const { createScene, loadProjectScenes, saveProjectScenes } = await import('@/lib/scenes/sceneManager');
    const project = loadProjectScenes(ctx.store.projectId);
    const result = createScene(project, p.data.name);
    saveProjectScenes(result.project, ctx.store.projectId);
    ctx.store.setScenes(
      result.project.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
      result.project.activeSceneId
    );
    return { success: true, result: { sceneId: result.sceneId, message: `Created scene "${p.data.name}"` } };
  },

  switch_scene: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ sceneId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const { switchScene, loadProjectScenes, saveProjectScenes, getSceneByName, saveCurrentSceneData } = await import('@/lib/scenes/sceneManager');
    const capture = await captureBeforeMutating();
    const failure = captureFailure(capture, 'switch scenes');
    if (failure) return failure;

    let project = loadProjectScenes(ctx.store.projectId);
    if (capture.status === 'captured') project = saveCurrentSceneData(project, capture.data);
    let targetId = p.data.sceneId;
    const byName = getSceneByName(project, p.data.sceneId);
    if (byName) targetId = byName.id;

    const result = switchScene(project, targetId);
    if ('error' in result) return { success: false, error: result.error };

    saveProjectScenes(result.project, ctx.store.projectId);
    ctx.store.setScenes(
      result.project.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
      result.project.activeSceneId
    );
    if (result.sceneToLoad) {
      ctx.store.loadScene(JSON.stringify(result.sceneToLoad));
    } else {
      ctx.store.newScene();
    }
    return { success: true, result: { message: `Switched to scene` } };
  },

  duplicate_scene: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ sceneId: z.string().min(1), name: z.string().optional() }), args);
    if (p.error) return p.error;
    const { duplicateScene, loadProjectScenes, saveProjectScenes, getSceneByName, saveCurrentSceneData } = await import('@/lib/scenes/sceneManager');
    const capture = await captureBeforeMutating();
    const failure = captureFailure(capture, 'duplicate the scene');
    if (failure) return failure;

    let project = loadProjectScenes(ctx.store.projectId);
    if (capture.status === 'captured') project = saveCurrentSceneData(project, capture.data);
    let targetId = p.data.sceneId;
    const byName = getSceneByName(project, p.data.sceneId);
    if (byName) targetId = byName.id;

    const result = duplicateScene(project, targetId, p.data.name);
    if ('error' in result) return { success: false, error: result.error };

    saveProjectScenes(result.project, ctx.store.projectId);
    ctx.store.setScenes(
      result.project.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
      result.project.activeSceneId
    );
    return { success: true, result: { sceneId: result.newSceneId, message: `Duplicated scene` } };
  },

  delete_scene: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ sceneId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const { deleteScene, loadProjectScenes, saveProjectScenes, getSceneByName } = await import('@/lib/scenes/sceneManager');
    const project = loadProjectScenes(ctx.store.projectId);
    let targetId = p.data.sceneId;
    const byName = getSceneByName(project, p.data.sceneId);
    if (byName) targetId = byName.id;

    const result = deleteScene(project, targetId);
    if (result.error) return { success: false, error: result.error };

    saveProjectScenes(result.project, ctx.store.projectId);
    ctx.store.setScenes(
      result.project.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
      result.project.activeSceneId
    );
    return { success: true, result: { message: 'Scene deleted' } };
  },

  rename_scene: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ sceneId: z.string().min(1), name: z.string().min(1) }), args);
    if (p.error) return p.error;
    const { renameScene, loadProjectScenes, saveProjectScenes, getSceneByName } = await import('@/lib/scenes/sceneManager');
    const project = loadProjectScenes(ctx.store.projectId);
    let targetId = p.data.sceneId;
    const byName = getSceneByName(project, p.data.sceneId);
    if (byName) targetId = byName.id;

    const updated = renameScene(project, targetId, p.data.name);
    saveProjectScenes(updated, ctx.store.projectId);
    ctx.store.setScenes(
      updated.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
      updated.activeSceneId
    );
    return { success: true, result: { message: `Renamed scene to "${p.data.name}"` } };
  },

  set_start_scene: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ sceneId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const { setStartScene, loadProjectScenes, saveProjectScenes, getSceneByName } = await import('@/lib/scenes/sceneManager');
    const project = loadProjectScenes(ctx.store.projectId);
    let targetId = p.data.sceneId;
    const byName = getSceneByName(project, p.data.sceneId);
    if (byName) targetId = byName.id;

    const updated = setStartScene(project, targetId);
    saveProjectScenes(updated, ctx.store.projectId);
    ctx.store.setScenes(
      updated.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
      updated.activeSceneId
    );
    return { success: true, result: { message: 'Start scene updated' } };
  },

  list_scenes: async (_args, ctx): Promise<ExecutionResult> => {
    const { loadProjectScenes } = await import('@/lib/scenes/sceneManager');
    const project = loadProjectScenes(ctx.store.projectId);
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

  // -------------------------------------------------------------------------
  // Recovery checkpoints (scene.FR-3.OP-02)
  //
  // These drive the exact same sceneManager functions the manual Scene Browser
  // controls use (`ctx.store.createCheckpoint` / `restoreCheckpoint` /
  // `listCheckpoints` / `deleteCheckpoint`), so the AI and manual paths persist
  // identical state — every manual checkpoint operation has an AI equal (F2).
  // -------------------------------------------------------------------------

  create_checkpoint: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ label: z.string().optional() }), args);
    if (p.error) return p.error;
    const checkpoint = await ctx.store.createCheckpoint(p.data.label);
    if (!checkpoint) return { success: false, error: 'The checkpoint could not be captured or saved. Check the Scene Browser error and retry after the engine is ready.' };
    return {
      success: true,
      result: { checkpointId: checkpoint.id, label: checkpoint.label, count: ctx.store.listCheckpoints().length, message: `Created checkpoint "${checkpoint.label}"` },
    };
  },

  list_checkpoints: async (_args, ctx): Promise<ExecutionResult> => {
    const checkpoints = ctx.store.listCheckpoints();
    return {
      success: true,
      result: {
        checkpoints: checkpoints.map((c) => ({
          id: c.id, label: c.label, createdAt: c.createdAt, sceneCount: c.snapshot.scenes.length,
        })),
        count: checkpoints.length,
      },
    };
  },

  restore_checkpoint: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ checkpointId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const restored = await ctx.store.restoreCheckpoint(p.data.checkpointId);
    return restored
      ? { success: true, result: { message: 'Restored checkpoint' } }
      : { success: false, error: 'The checkpoint restore failed. The previous save is intact; check the Scene Browser error before editing.' };
  },

  delete_checkpoint: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ checkpointId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const remaining = ctx.store.deleteCheckpoint(p.data.checkpointId);
    if (remaining.some((checkpoint) => checkpoint.id === p.data.checkpointId)) {
      return { success: false, error: 'The checkpoint could not be deleted. Wait for any recovery operation to finish and try again.' };
    }
    return { success: true, result: { message: 'Deleted checkpoint', count: remaining.length } };
  },

  load_scene_with_transition: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      sceneName: z.string().min(1),
      transitionType: z.enum(['fade', 'wipe', 'instant']).optional(),
      duration: z.number().optional(),
      color: z.string().optional(),
      direction: z.enum(['left', 'right', 'up', 'down']).optional(),
    }), args);
    if (p.error) return p.error;
    await ctx.store.startSceneTransition(p.data.sceneName, {
      type: p.data.transitionType || 'fade',
      duration: p.data.duration ?? 500,
      color: p.data.color || '#000000',
      direction: p.data.direction || 'left',
    });
    return {
      success: true,
      result: { message: `Loaded scene "${p.data.sceneName}" with ${p.data.transitionType || 'fade'} transition` },
    };
  },

  set_default_transition: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      transitionType: z.enum(['fade', 'wipe', 'instant']).optional(),
      duration: z.number().optional(),
      color: z.string().optional(),
      direction: z.enum(['left', 'right', 'up', 'down']).optional(),
      easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']).optional(),
    }), args);
    if (p.error) return p.error;
    ctx.store.setDefaultTransition({
      ...(p.data.transitionType ? { type: p.data.transitionType } : {}),
      ...(p.data.duration !== undefined ? { duration: p.data.duration } : {}),
      ...(p.data.color ? { color: p.data.color } : {}),
      ...(p.data.direction ? { direction: p.data.direction } : {}),
      ...(p.data.easing ? { easing: p.data.easing } : {}),
    });
    return {
      success: true,
      result: { message: `Default transition set to ${p.data.transitionType || 'updated'}` },
    };
  },

  list_templates: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ category: z.string().optional() }), args);
    if (p.error) return p.error;
    const { TEMPLATE_REGISTRY } = await import('@/data/templates');
    const templates = p.data.category
      ? TEMPLATE_REGISTRY.filter((t) => t.category === p.data.category)
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
    const p = parseArgs(z.object({ templateId: z.string().min(1) }), args);
    if (p.error) return p.error;
    // `loadTemplate` resolves only once the entities are in the scene graph, and
    // reports the ways a load can fail silently: an unknown id, an engine that
    // is not attached yet, and a scene the engine acknowledged but never
    // applied. Anything short of an explicit success is a failure here — this
    // handler used to discard the result and report success unconditionally.
    const result = await ctx.store.loadTemplate(p.data.templateId);
    if (!result?.success) {
      return { success: false, error: result?.error ?? `Failed to load template: ${p.data.templateId}` };
    }
    const skipped = result.skippedEntityIds.length;
    return {
      success: true,
      result: {
        message: `Loaded template: ${p.data.templateId} (${result.entityCount} entities${
          skipped > 0 ? `, ${skipped} unsupported entities skipped` : ''
        })`,
        entityCount: result.entityCount,
        skippedEntityIds: result.skippedEntityIds,
      },
    };
  },

  get_template_info: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ templateId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const { getTemplateInfo } = await import('@/data/templates');
    const info = getTemplateInfo(p.data.templateId);
    if (!info) return { success: false, error: `Template not found: ${p.data.templateId}` };
    return { success: true, result: info };
  },

  set_quality_preset: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ preset: z.string().min(1) }), args);
    if (p.error) return p.error;
    ctx.store.setQualityPreset(p.data.preset as import('@/stores/editorStore').QualityPreset);
    return { success: true, result: `Quality preset set to ${p.data.preset}` };
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
