/**
 * Scene management handlers — save/load scene, input bindings, multi-scene,
 * scene transitions, templates, quality presets, and documentation tools.
 */

import { z } from 'zod';
import type { ToolHandler, ExecutionResult, InputBinding } from './types';
import { parseArgs } from './types';
import { captureActiveScene, type SceneCapture } from '@/lib/scenes/captureScene';
import { newSceneExportRequestId } from '@/lib/engine/sceneExportWire';
import { requestSceneExport } from '@/stores/slices/sceneSlice';
import { isValidSceneFile } from '@/lib/scenes/sceneValidation';
import { COMPLETION_MODE_INFO } from '@/lib/playMode/completionMode';

/**
 * Read the live scene back out of the engine before a mutation moves off it
 * (PF-1100). `unavailable` means there is no engine and so no live scene to
 * lose; `failed` means one exists and could not be read, which must abort the
 * mutation rather than persist a stale copy over it.
 *
 * The prefab-instance registry is folded in by the SCENE_EXPORTED handler
 * (`hooks/events/transformEvents.ts`), which consumes the snapshot staged
 * below. Staging at REQUEST time is what makes the instances and their
 * transitive definitions ONE read: this used to ask with no request id and then
 * fold a second time on the way out, and an instance created during the engine
 * round trip then reached `prefabInstances` without its definition reaching
 * `prefabDefinitions`. Mirrors `sceneSlice.capturePrefabAwareScene` so the AI
 * and Scene Browser paths persist identical state (scene.FR-1 N1).
 */
async function captureBeforeMutating(): Promise<SceneCapture> {
  const { loadPrefabInstances, stagePrefabInstancesForExport, discardStagedPrefabInstancesForExport } =
    await import('@/lib/prefabs/prefabStore');
  const requestId = newSceneExportRequestId();
  stagePrefabInstancesForExport(requestId, loadPrefabInstances());
  const capture = await captureActiveScene(() => requestSceneExport(requestId));
  // Unconditional and a no-op once the fold has taken it — see the twin's
  // comment in `sceneSlice.ts` for why that ordering holds.
  discardStagedPrefabInstancesForExport(requestId);
  return capture;
}

function captureFailure(capture: SceneCapture, action: string): ExecutionResult | null {
  if (capture.status !== 'failed') return null;
  return { success: false, error: `Could not ${action}: ${capture.reason}` };
}

/** AI tool handlers that validate arguments and delegate scene operations to the editor store. */
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
    // `saveScene` refuses while a scene load stands rejected (#10056). Reporting
    // success for a refusal would have the assistant tell the user their work is
    // saved when nothing was even asked of the engine.
    if (ctx.store.sceneLoadError) {
      return { success: false, error: `${ctx.store.sceneLoadError.reason} Nothing was exported.` };
    }
    ctx.store.saveScene();
    return { success: true, result: { message: 'Scene export triggered' } };
  },

  load_scene: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ json: z.string().min(1) }), args);
    if (p.error) return p.error;
    // The scene currently on screen is untouched when the load is rejected, so
    // this must not strand the editor: the failure is reported back to the
    // assistant below and saving of the current scene stays enabled (#10056).
    if (ctx.store.loadScene(p.data.json, { rejectionStrandsEditor: false }) === false) {
      return { success: false, error: 'The scene was not loaded. Check its prefab metadata and engine readiness, then try again.' };
    }
    return { success: true, result: { message: 'Scene load triggered' } };
  },

  new_scene: async (_args, ctx): Promise<ExecutionResult> => {
    if (ctx.store.newScene() === false) {
      return { success: false, error: 'The engine did not accept a new scene. The current scene is unchanged.' };
    }
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
    // A rejected scene load leaves the engine holding something that is NOT
    // this project's scene. Capturing here would export that non-project scene
    // and `saveCurrentSceneData` it over the OUTGOING scene's stored data — the
    // exact overwrite the store's own `switchScene` refuses (sceneSlice.ts) and
    // that `export_scene` above refuses too. Refuse before `captureBeforeMutating`
    // so the manual and AI paths stay at parity (#10056).
    if (ctx.store.sceneLoadError) {
      return { success: false, error: `${ctx.store.sceneLoadError.reason} The scene was not switched and your saved project was left untouched.` };
    }
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

    // `rejectionStrandsEditor: false`: a rejected TARGET leaves the OUTGOING
    // scene on screen and unchanged, so a failed switch must not lock its saves
    // behind `sceneLoadError` — the failure is returned to the assistant below,
    // parity with the store's own `switchScene` (#10056). `strandOnThrow: true`
    // (the default, restated): a THROWN dispatch can have wrecked the outgoing
    // scene mid-apply, so it DOES set `sceneLoadError(ENGINE_LOAD_THREW)` and
    // lock saving, and the message below tells the user to reload rather than
    // claiming the scene is unchanged (#10079), parity with the store. When
    // `sceneToLoad` is null the fallback `newScene()` throw sets the same
    // lockout itself (#10079 follow-up, Sentry), so both branches lock saving
    // identically.
    let accepted: boolean;
    try {
      accepted = result.sceneToLoad
        ? ctx.store.loadScene(JSON.stringify(result.sceneToLoad), { rejectionStrandsEditor: false, strandOnThrow: true })
        : ctx.store.newScene();
    } catch (error) {
      // `loadScene`/`newScene` attempt audio and best-effort prefab registry
      // rollback before rethrowing, but not this handler's captured
      // `project` — without persisting it here, a thrown dispatch error
      // skips both `saveProjectScenes` calls below and silently discards the
      // outgoing scene's unsaved work, parity with the store's `switchScene`.
      // The persist writes the already-captured outgoing data, not a fresh
      // export of the wrecked engine scene, so it is safe under the lockout
      // both `loadScene` and `newScene` have by now set.
      saveProjectScenes(project, ctx.store.projectId);
      return {
        success: false,
        error: `The scene could not be opened due to an engine error (${error instanceof Error ? error.message : String(error)}). Reload the editor before continuing — the viewport can no longer be trusted and saving is locked to protect your stored scene.`,
      };
    }
    if (accepted === false) {
      saveProjectScenes(project, ctx.store.projectId);
      return { success: false, error: 'The engine rejected the scene switch. The current scene is unchanged.' };
    }
    saveProjectScenes(result.project, ctx.store.projectId);
    ctx.store.setScenes(
      result.project.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
      result.project.activeSceneId
    );
    return { success: true, result: { message: `Switched to scene` } };
  },

  duplicate_scene: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ sceneId: z.string().min(1), name: z.string().optional() }), args);
    if (p.error) return p.error;
    // Same refusal as `switch_scene` and the store's own `duplicateScene`: a
    // rejected load means the engine scene is not this project's, so capturing
    // and folding it here would overwrite the outgoing scene's stored data and
    // copy from stale data (#10056).
    if (ctx.store.sceneLoadError) {
      return { success: false, error: `${ctx.store.sceneLoadError.reason} The scene was not duplicated and your saved project was left untouched.` };
    }
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
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- a blank transition type is not a member of the transition enum; treated as unset
      type: p.data.transitionType || 'fade',
      duration: p.data.duration ?? 500,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- a blank transition color is unset; falls back to the default swatch
      color: p.data.color || '#000000',
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- a blank direction is not a member of the direction enum; treated as unset
      direction: p.data.direction || 'left',
    });
    return {
      success: true,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- a blank transition type is not a member of the transition enum; treated as unset
      result: { message: `Loaded scene "${p.data.sceneName}" with ${p.data.transitionType || 'fade'} transition` },
    };
  },

  /**
   * The typed in-app AI operation for the scene's completion mode
   * (idea.FR-1.OP-04, #9998).
   *
   * Deliberately NOT a `z.enum` here: the raw `mode` goes straight to
   * `setCompletionMode`, the store action the manual picker calls, which owns
   * validation. So the tool and the picker accept the same values and refuse
   * the rest with the same words — parity by construction, not by two schemas
   * agreeing. The change is recorded in the picker's undo history, so a mode
   * the AI chose is one Undo away, and a later targeted AI edit to entities
   * never touches it.
   */
  set_completion_mode: async (args, ctx): Promise<ExecutionResult> => {
    const result = ctx.store.setCompletionMode(args.mode);
    if (!result.ok) return { success: false, error: result.error };
    const info = COMPLETION_MODE_INFO[result.mode];
    return {
      success: true,
      result: {
        mode: result.mode,
        changed: result.changed,
        message: result.changed
          ? `Completion mode set to ${info.label}. ${info.description}`
          : `Completion mode is already ${info.label}.`,
      },
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
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- a blank transition type is not a member of the transition enum; treated as unset
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
