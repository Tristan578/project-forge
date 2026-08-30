import { z } from 'zod';
import type { ExecutorDefinition, ExecutorContext, ExecutorResult } from '../types';
import { makeStepError, successResult, failResult } from './shared';
import { waitForEngineFrame } from './engineDispatch';
import { createScene, loadProjectScenes, saveProjectScenes } from '@/lib/scenes/sceneManager';

/**
 * World configuration used to live here and no longer does — it moved to the
 * `world_build` executor in PF-1138. `worldType`/`worldConfig` were parsed here
 * and then dropped, because there was no scene-level world build command to
 * send them to, so every generated game was an empty room.
 *
 * Camera configuration used to live here and no longer does — it moved to the
 * `camera_setup` executor in PF-1125.
 *
 * The camera branch could never work from here. Scene creation runs before any entity is
 * spawned, so there is no camera entity to configure, and the branch was gated on
 * a `cameraConfig.entityId` the GDD has no way to supply. The directive was
 * normalized, filtered, and returned as `pendingCameraConfig` for a downstream
 * consumer that was never written.
 *
 * All four fields are gone from the schema below rather than left as ignored
 * fields, deliberately: `z.object` strips unknown keys silently, so an
 * accepted-but-unused field is the exact shape of the silent-drop defect this
 * campaign exists to close. Removing them makes a mis-pointed camera step a
 * visible no-op in the step input instead of a value that vanishes mid-pipeline.
 */
const inputSchema = z.object({
  name: z.string().min(1).max(200).optional().default('Untitled Scene'),
  purpose: z.string().max(500).optional().default(''),
});

export const sceneCreateExecutor: ExecutorDefinition = {
  name: 'scene_create',
  inputSchema,
  userFacingErrorMessage: 'Could not create the scene. Please try again.',

  async execute(
    input: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<ExecutorResult> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return failResult(
        makeStepError(
          'INVALID_INPUT',
          parsed.error.message,
          this.userFacingErrorMessage,
        ),
      );
    }

    if (ctx.signal.aborted) {
      return failResult(
        makeStepError(
          'ABORTED',
          'Executor was aborted before running',
          this.userFacingErrorMessage,
        ),
      );
    }

    const { name } = parsed.data;

    // `create_scene` is an engine stub that rejects by design — scenes live
    // JS-side in `lib/scenes/sceneManager` — and because single dispatch returns
    // void, the rejection was unobservable and this step was a silent no-op that
    // still reported success (PF-1097).
    //
    // There is no longer a "config overlay" mode. The world system's step used
    // to land here carrying `worldType`/`worldConfig` with no scene name, which
    // is why creation was conditional; it now plans a `world_build` step that
    // spawns real geometry, so every step reaching this executor is a real scene
    // creation (PF-1138).
    const project = loadProjectScenes();
    const { project: withScene, sceneId } = createScene(project, name);
    saveProjectScenes({ ...withScene, activeSceneId: sceneId });
    ctx.getStore().setScenes(
      withScene.scenes.map((s) => ({ id: s.id, name: s.name, isStartScene: s.isStartScene })),
      sceneId,
    );
    // Clear the starter scene (Ground/Player/Sun from the engine's Startup
    // `setup_scene`) so the generated game is not stacked on top of it.
    // `new_scene` despawns deletable entities and resets editor state; it does
    // not re-run `setup_scene`.
    //
    // Through the store, not `dispatchCommand`: `sceneSlice.newScene` also drops
    // any scene audio staged by a `loadScene` the engine never confirmed
    // (`clearStagedSceneAudio`). A raw dispatch skips that, and the stash would
    // then be adopted by the SCENE_LOADED this very command emits — attaching the
    // old scene's sounds to the generated game's fresh entity ids. Both paths
    // reach the same `_dispatchCommand`, so the engine sees no difference.
    //
    // Phase 1 runs before Phase 3, so this despawn cannot wipe the world
    // geometry `world_build` spawns — that ordering is why the geometry is a
    // separate step rather than part of this one.
    ctx.getStore().newScene();

    // The step must not return until the engine has actually applied the
    // despawn, because JS step order is not engine frame order. `new_scene` and
    // every `spawn_entity` dispatched before the next frame land in the SAME
    // engine frame, and `apply_new_scene` despawns
    // `Query<Entity, (With<EntityId>, Without<Undeletable>)>` — every entity the
    // pipeline has spawned so far. Which of the two wins is decided by Bevy's
    // ambiguous `Update` ordering, so it is not stable across unrelated schedule
    // changes: adding one system to any unordered `Update` tuple reshuffles it.
    //
    // That is not hypothetical. It flipped on #9493 (one system added to the
    // 13-system `skeleton2d` tuple), and the live engine smoke gate went from
    // green to a scene graph holding the nine `world_build` entities plus the
    // engine's `Undeletable` Main Camera and NOTHING ELSE — all five
    // `entity_setup` spawns despawned, so the first `game_component` step failed
    // `ENTITY_NOT_FOUND`. `world_build` survived only because
    // `worldBuildExecutor` already awaits a frame; this await gives the
    // `entity_setup` cohort the same guarantee.
    await waitForEngineFrame();

    // `pendingCameraConfig` used to be returned here, described as something
    // `auto_polish` would apply "once a camera entity exists". Nothing ever read
    // it — the comment was aspirational, not a description — so it was a
    // sanitized value with no consumer, i.e. a drop with extra steps. The camera
    // directive now reaches the engine through `camera_setup`.
    return successResult({ sceneName: name });
  },
};
