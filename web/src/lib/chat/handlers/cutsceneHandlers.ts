/**
 * Cutscene MCP handlers.
 * Implements: generate_cutscene, play_cutscene, stop_cutscene,
 *             list_cutscenes, delete_cutscene
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { parseArgs } from './types';

export const cutsceneHandlers: Record<string, ToolHandler> = {
  generate_cutscene: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        prompt: z.string().min(1),
        duration: z.number().positive().max(60).optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const { generateCutscene } = await import('@/lib/ai/cutsceneGenerator');
    const { useCutsceneStore } = await import('@/stores/cutsceneStore');

    // Build entity refs from the current scene graph
    const sceneEntities = Object.entries(ctx.store.sceneGraph ?? {}).map(
      ([id, node]) => ({
        id,
        name: (node as { name?: string }).name ?? id,
        type: (node as { entityType?: string }).entityType ?? 'unknown',
      }),
    );

    try {
      const cutscene = await generateCutscene({
        prompt: p.data.prompt,
        sceneEntities,
        duration: p.data.duration,
      });

      useCutsceneStore.getState().addCutscene(cutscene);

      return {
        success: true,
        result: {
          cutsceneId: cutscene.id,
          name: cutscene.name,
          duration: cutscene.duration,
          trackCount: cutscene.tracks.length,
          message: `Generated cutscene "${cutscene.name}" (${cutscene.duration}s, ${cutscene.tracks.length} tracks)`,
        },
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to generate cutscene',
      };
    }
  },

  play_cutscene: async (args, ctx) => {
    const p = parseArgs(
      z.object({
        cutsceneId: z.string().min(1),
      }),
      args,
    );
    if (p.error) return p.error;

    const { useCutsceneStore } = await import('@/stores/cutsceneStore');
    const { CutscenePlayer } = await import('@/lib/cutscene/player');

    const cutscene = useCutsceneStore.getState().cutscenes[p.data.cutsceneId];
    if (!cutscene) {
      return { success: false, error: `Cutscene "${p.data.cutsceneId}" not found` };
    }

    // Enter play mode before starting the cutscene
    ctx.dispatchCommand('play', {});

    useCutsceneStore.getState().setActiveCutscene(p.data.cutsceneId);

    const player = new CutscenePlayer({
      dispatchCommand: ctx.dispatchCommand,
      onComplete: () => {
        useCutsceneStore.getState().setActiveCutscene(null);
        ctx.dispatchCommand('stop', {});
      },
      onStop: () => {
        useCutsceneStore.getState().setActiveCutscene(null);
      },
    });

    player.load(cutscene);
    player.play();

    return {
      success: true,
      result: {
        message: `Playing cutscene "${cutscene.name}"`,
        duration: cutscene.duration,
      },
    };
  },

  stop_cutscene: async (_args, ctx) => {
    const { useCutsceneStore } = await import('@/stores/cutsceneStore');
    const state = useCutsceneStore.getState();

    if (state.playbackState === 'idle' || state.playbackState === 'stopped') {
      return { success: false, error: 'No cutscene is currently playing' };
    }

    state.setPlaybackState('stopped');
    state.setActiveCutscene(null);
    state.setPlaybackTime(0);
    ctx.dispatchCommand('stop', {});

    return { success: true, result: { message: 'Cutscene stopped' } };
  },

  list_cutscenes: async (_args, _ctx) => {
    const { useCutsceneStore } = await import('@/stores/cutsceneStore');
    const cutscenes = Object.values(useCutsceneStore.getState().cutscenes).map((c) => ({
      id: c.id,
      name: c.name,
      duration: c.duration,
      trackCount: c.tracks.length,
    }));

    return {
      success: true,
      result: {
        cutscenes,
        count: cutscenes.length,
      },
    };
  },

  delete_cutscene: async (args, _ctx) => {
    const p = parseArgs(
      z.object({
        cutsceneId: z.string().min(1),
      }),
      args,
    );
    if (p.error) return p.error;

    const { useCutsceneStore } = await import('@/stores/cutsceneStore');
    const state = useCutsceneStore.getState();

    if (!state.cutscenes[p.data.cutsceneId]) {
      return { success: false, error: `Cutscene "${p.data.cutsceneId}" not found` };
    }

    state.deleteCutscene(p.data.cutsceneId);

    return {
      success: true,
      result: { message: `Deleted cutscene "${p.data.cutsceneId}"` },
    };
  },
};
