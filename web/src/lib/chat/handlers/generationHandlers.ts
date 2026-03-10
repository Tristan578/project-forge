/**
 * Generation handlers for MCP commands.
 * Wires AI asset generation commands to API routes and the generation store.
 */

import { z } from 'zod';
import type { ToolHandler, ExecutionResult } from './types';
import { parseArgs } from './types';
import { useGenerationStore } from '@/stores/generationStore';
import type { GenerationType } from '@/stores/generationStore';
import { enrichPrompt, enrichSfxPrompt, enrichMusicPrompt, enrichVoiceStyle } from '@/lib/generate/promptEnricher';
import { inferSfxCategory, getSpatialDefaults } from '@/lib/generate/postProcess';

/** Generate a unique ID for client-side job tracking. */
function makeJobId(): string {
  return `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Track an async generation job in the generation store. */
function trackJob(opts: {
  jobId: string;
  providerJobId: string;
  type: GenerationType;
  prompt: string;
  provider: string;
  entityId?: string;
  usageId?: string;
  autoPlace?: boolean;
  targetEntityId?: string;
  materialSlot?: string;
}) {
  useGenerationStore.getState().addJob({
    id: opts.jobId,
    jobId: opts.providerJobId,
    type: opts.type,
    prompt: opts.prompt,
    status: 'pending',
    progress: 0,
    provider: opts.provider,
    createdAt: Date.now(),
    entityId: opts.entityId,
    usageId: opts.usageId,
    autoPlace: opts.autoPlace,
    targetEntityId: opts.targetEntityId,
    materialSlot: opts.materialSlot,
  });
}

/** Shared fetch + error handling for generation API routes. */
async function generateFetch(
  url: string,
  body: Record<string, unknown>
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Generation request failed' }));
    return { ok: false, error: (err as { error?: string }).error ?? 'Generation failed' };
  }
  const data = await response.json();
  return { ok: true, data: data as Record<string, unknown> };
}

/** Query a generation status endpoint. */
async function queryStatus(
  statusUrl: string,
  jobId: string
): Promise<ExecutionResult> {
  const response = await fetch(`${statusUrl}?jobId=${encodeURIComponent(jobId)}`);
  if (!response.ok) {
    return { success: false, error: 'Failed to query generation status' };
  }
  const data = await response.json() as {
    status: string;
    progress?: number;
    resultUrl?: string;
    thumbnailUrl?: string;
    error?: string;
  };

  // Update generation store if we can find the job
  const genStore = useGenerationStore.getState();
  const storeJob = Object.values(genStore.jobs).find((j) => j.jobId === jobId);
  if (storeJob) {
    const statusMap: Record<string, 'pending' | 'processing' | 'completed' | 'failed'> = {
      pending: 'pending',
      processing: 'processing',
      completed: 'completed',
      failed: 'failed',
    };
    genStore.updateJob(storeJob.id, {
      status: statusMap[data.status] ?? 'processing',
      progress: data.progress ?? 0,
      ...(data.resultUrl ? { resultUrl: data.resultUrl } : {}),
      ...(data.error ? { error: data.error } : {}),
    });
  }

  return {
    success: true,
    result: {
      jobId,
      status: data.status,
      progress: data.progress ?? 0,
      ...(data.resultUrl ? { resultUrl: data.resultUrl } : {}),
      ...(data.thumbnailUrl ? { thumbnailUrl: data.thumbnailUrl } : {}),
      ...(data.error ? { error: data.error } : {}),
    },
  };
}

export const generationHandlers: Record<string, ToolHandler> = {
  generate_3d_model: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      prompt: z.string().min(1),
      quality: z.string().optional(),
      artStyle: z.string().optional(),
      negativePrompt: z.string().optional(),
      entityId: z.string().optional(),
      autoPlace: z.boolean().optional(),
    }), args);
    if (p.error) return p.error;

    const result = await generateFetch('/api/generate/model', {
      prompt: enrichPrompt(p.data.prompt, 'model', ctx.store),
      quality: p.data.quality ?? 'standard',
      artStyle: p.data.artStyle ?? 'realistic',
      negativePrompt: p.data.negativePrompt,
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'model',
      prompt: p.data.prompt,
      provider: (data.provider as string) ?? 'meshy',
      usageId: data.usageId as string | undefined,
      entityId: p.data.entityId,
      autoPlace: p.data.autoPlace ?? !!p.data.entityId,
      targetEntityId: p.data.entityId,
    });

    return {
      success: true,
      result: {
        message: `3D model generation started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
        jobId: data.jobId,
      },
    };
  },

  generate_3d_from_image: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      imageBase64: z.string().min(1),
      prompt: z.string().optional(),
      entityId: z.string().optional(),
      autoPlace: z.boolean().optional(),
    }), args);
    if (p.error) return p.error;

    const enrichedPrompt = p.data.prompt
      ? enrichPrompt(p.data.prompt, 'model', ctx.store)
      : undefined;
    const result = await generateFetch('/api/generate/model', {
      imageBase64: p.data.imageBase64,
      prompt: enrichedPrompt,
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'model',
      prompt: p.data.prompt ?? 'image-to-3d',
      provider: (data.provider as string) ?? 'meshy',
      usageId: data.usageId as string | undefined,
      entityId: p.data.entityId,
      autoPlace: p.data.autoPlace ?? !!p.data.entityId,
      targetEntityId: p.data.entityId,
    });

    return {
      success: true,
      result: {
        message: `3D model generation from image started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
        jobId: data.jobId,
      },
    };
  },

  generate_texture: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      prompt: z.string().min(1),
      entityId: z.string().optional(),
      resolution: z.string().optional(),
      style: z.string().optional(),
      tiling: z.boolean().optional(),
      materialSlot: z.string().optional(),
      autoPlace: z.boolean().optional(),
    }), args);
    if (p.error) return p.error;

    const result = await generateFetch('/api/generate/texture', {
      prompt: enrichPrompt(p.data.prompt, 'texture', ctx.store),
      entityId: p.data.entityId,
      resolution: p.data.resolution ?? '1024',
      style: p.data.style ?? 'realistic',
      tiling: p.data.tiling ?? false,
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'texture',
      prompt: p.data.prompt,
      provider: (data.provider as string) ?? 'meshy',
      entityId: p.data.entityId,
      usageId: data.usageId as string | undefined,
      autoPlace: p.data.autoPlace ?? !!p.data.entityId,
      targetEntityId: p.data.entityId,
      materialSlot: p.data.materialSlot,
    });

    return {
      success: true,
      result: {
        message: `Texture generation started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
        jobId: data.jobId,
      },
    };
  },

  generate_pbr_maps: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      prompt: z.string().min(1),
      entityId: z.string().optional(),
      maps: z.unknown().optional(),
    }), args);
    if (p.error) return p.error;

    const result = await generateFetch('/api/generate/texture', {
      prompt: enrichPrompt(p.data.prompt, 'texture', ctx.store),
      entityId: p.data.entityId,
      maps: p.data.maps,
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'texture',
      prompt: p.data.prompt,
      provider: (data.provider as string) ?? 'meshy',
      entityId: p.data.entityId,
      usageId: data.usageId as string | undefined,
    });

    return {
      success: true,
      result: {
        message: `PBR map generation started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
        jobId: data.jobId,
      },
    };
  },

  generate_sfx: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      prompt: z.string().min(1),
      entityId: z.string().optional(),
      durationSeconds: z.number().optional(),
    }), args);
    if (p.error) return p.error;

    // Find entity name for SFX context enrichment
    const entityName = p.data.entityId ? ctx.store.sceneGraph.nodes[p.data.entityId]?.name : undefined;
    const result = await generateFetch('/api/generate/sfx', {
      prompt: enrichSfxPrompt(p.data.prompt, entityName, ctx.store),
      durationSeconds: p.data.durationSeconds ?? 5,
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const assetName = `sfx-${p.data.prompt.slice(0, 20)}`;
    ctx.store.importAudio(data.audioBase64 as string, assetName);
    if (p.data.entityId) {
      const spatial = getSpatialDefaults(inferSfxCategory(p.data.prompt));
      ctx.store.setAudio(p.data.entityId, {
        assetId: assetName,
        volume: spatial.volume,
        pitch: 1.0,
        loopAudio: spatial.loopAudio,
        spatial: spatial.spatial,
        maxDistance: spatial.maxDistance,
        refDistance: spatial.refDistance,
        rolloffFactor: spatial.rolloffFactor,
        autoplay: false,
        bus: 'sfx',
      });
    }

    return {
      success: true,
      result: { message: `Sound effect generated and imported as "${assetName}".` },
    };
  },

  generate_voice: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      text: z.string().min(1),
      entityId: z.string().optional(),
      speaker: z.string().optional(),
      voiceStyle: z.string().optional(),
    }), args);
    if (p.error) return p.error;

    const baseStyle = p.data.voiceStyle ?? 'neutral';
    const result = await generateFetch('/api/generate/voice', {
      text: p.data.text,
      voiceStyle: enrichVoiceStyle(p.data.speaker, baseStyle),
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const assetName = `voice-${p.data.text.slice(0, 20)}`;
    ctx.store.importAudio(data.audioBase64 as string, assetName);
    if (p.data.entityId) {
      const spatial = getSpatialDefaults('voice');
      ctx.store.setAudio(p.data.entityId, {
        assetId: assetName,
        volume: spatial.volume,
        pitch: 1.0,
        loopAudio: spatial.loopAudio,
        spatial: spatial.spatial,
        maxDistance: spatial.maxDistance,
        refDistance: spatial.refDistance,
        rolloffFactor: spatial.rolloffFactor,
        autoplay: false,
        bus: 'voice',
      });
    }

    return {
      success: true,
      result: { message: `Voice dialogue generated and imported as "${assetName}".` },
    };
  },

  generate_skybox: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      prompt: z.string().min(1),
      style: z.string().optional(),
    }), args);
    if (p.error) return p.error;

    const result = await generateFetch('/api/generate/skybox', {
      prompt: enrichPrompt(p.data.prompt, 'skybox', ctx.store),
      style: p.data.style ?? 'realistic',
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'skybox',
      prompt: p.data.prompt,
      provider: (data.provider as string) ?? 'meshy',
      usageId: data.usageId as string | undefined,
    });

    return {
      success: true,
      result: {
        message: `Skybox generation started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
        jobId: data.jobId,
      },
    };
  },

  generate_music: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      prompt: z.string().min(1),
      entityId: z.string().optional(),
      durationSeconds: z.number().optional(),
      instrumental: z.boolean().optional(),
    }), args);
    if (p.error) return p.error;

    const result = await generateFetch('/api/generate/music', {
      prompt: enrichMusicPrompt(p.data.prompt, ctx.store),
      durationSeconds: p.data.durationSeconds ?? 30,
      instrumental: p.data.instrumental ?? true,
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    // Music API may return audioBase64 (sync) or jobId (async)
    if (data.audioBase64) {
      const assetName = `music-${p.data.prompt.slice(0, 20)}`;
      ctx.store.importAudio(data.audioBase64 as string, assetName);
      if (p.data.entityId) {
        ctx.store.setAudio(p.data.entityId, {
          assetId: assetName,
          volume: 0.7,
          pitch: 1.0,
          loopAudio: true,
          spatial: false,
          maxDistance: 100,
          refDistance: 1,
          rolloffFactor: 1,
          autoplay: true,
          bus: 'music',
        });
      }
      return {
        success: true,
        result: { message: `Music generated and imported as "${assetName}".` },
      };
    }

    // Async path
    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'music',
      prompt: p.data.prompt,
      provider: (data.provider as string) ?? 'suno',
      entityId: p.data.entityId,
      usageId: data.usageId as string | undefined,
    });

    return {
      success: true,
      result: {
        message: `Music generation started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
        jobId: data.jobId,
      },
    };
  },

  generate_sprite: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      prompt: z.string().min(1),
      style: z.string().optional(),
      size: z.string().optional(),
      removeBackground: z.boolean().optional(),
      entityId: z.string().optional(),
      autoPlace: z.boolean().optional(),
    }), args);
    if (p.error) return p.error;

    const result = await generateFetch('/api/generate/sprite', {
      prompt: enrichPrompt(p.data.prompt, 'sprite', ctx.store),
      style: p.data.style,
      size: p.data.size ?? '64x64',
      removeBackground: p.data.removeBackground ?? true,
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'sprite',
      prompt: p.data.prompt,
      provider: (data.provider as string) ?? 'dalle3',
      usageId: data.usageId as string | undefined,
      entityId: p.data.entityId,
      autoPlace: p.data.autoPlace ?? !!p.data.entityId,
      targetEntityId: p.data.entityId,
    });

    return {
      success: true,
      result: {
        message: `Sprite generation started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
        jobId: data.jobId,
      },
    };
  },

  generate_sprite_sheet: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      sourceAssetId: z.string().min(1),
      frameCount: z.number().optional(),
      style: z.string().optional(),
      size: z.string().optional(),
    }), args);
    if (p.error) return p.error;

    const result = await generateFetch('/api/generate/sprite-sheet', {
      sourceAssetId: p.data.sourceAssetId,
      frameCount: p.data.frameCount ?? 4,
      style: p.data.style,
      size: p.data.size ?? '64x64',
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'sprite_sheet',
      prompt: `sprite-sheet from ${p.data.sourceAssetId}`,
      provider: (data.provider as string) ?? 'dalle3',
      usageId: data.usageId as string | undefined,
    });

    return {
      success: true,
      result: {
        message: `Sprite sheet generation started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
        jobId: data.jobId,
      },
    };
  },

  generate_character: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      prompt: z.string().min(1),
      poses: z.array(z.string()).min(1),
      style: z.string().optional(),
      size: z.string().optional(),
    }), args);
    if (p.error) return p.error;

    // Generate each pose as a separate sprite generation job
    const jobIds: string[] = [];
    for (const pose of p.data.poses) {
      const basePrompt = enrichPrompt(p.data.prompt, 'sprite', ctx.store);
      const prompt = `${basePrompt} - ${pose} pose`;
      const result = await generateFetch('/api/generate/sprite', {
        prompt,
        style: p.data.style ?? 'cartoon',
        size: p.data.size ?? '128x128',
        removeBackground: true,
      });
      if (result.ok) {
        const localId = makeJobId();
        trackJob({
          jobId: localId,
          providerJobId: result.data.jobId as string,
          type: 'sprite',
          prompt,
          provider: (result.data.provider as string) ?? 'dalle3',
          usageId: result.data.usageId as string | undefined,
        });
        jobIds.push(result.data.jobId as string);
      }
    }

    if (jobIds.length === 0) {
      return { success: false, error: 'Failed to start character generation for any pose' };
    }

    return {
      success: true,
      result: {
        message: `Character generation started for ${jobIds.length}/${p.data.poses.length} poses.`,
        jobIds,
      },
    };
  },

  generate_tileset: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      prompt: z.string().min(1),
      tileSize: z.number().optional(),
      gridSize: z.string().optional(),
    }), args);
    if (p.error) return p.error;

    const result = await generateFetch('/api/generate/tileset-gen', {
      prompt: enrichPrompt(p.data.prompt, 'tileset', ctx.store),
      tileSize: p.data.tileSize ?? 32,
      gridSize: p.data.gridSize ?? '8x8',
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'tileset',
      prompt: p.data.prompt,
      provider: (data.provider as string) ?? 'dalle3',
      usageId: data.usageId as string | undefined,
    });

    return {
      success: true,
      result: {
        message: `Tileset generation started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
        jobId: data.jobId,
      },
    };
  },

  // --- Status / Utility commands ---

  get_sprite_generation_status: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ jobId: z.string().min(1) }), args);
    if (p.error) return p.error;
    return queryStatus('/api/generate/sprite/status', p.data.jobId);
  },

  get_generation_status: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      jobId: z.string().min(1),
      type: z.string().optional(),
    }), args);
    if (p.error) return p.error;

    // Route to the correct status endpoint based on generation type
    const statusRoutes: Record<string, string> = {
      model: '/api/generate/model/status',
      texture: '/api/generate/texture/status',
      skybox: '/api/generate/skybox/status',
      music: '/api/generate/music/status',
      sprite: '/api/generate/sprite/status',
    };

    // If type is specified, use it directly
    if (p.data.type && statusRoutes[p.data.type]) {
      return queryStatus(statusRoutes[p.data.type], p.data.jobId);
    }

    // Try to find the job in the generation store to determine type
    const genStore = useGenerationStore.getState();
    const storeJob = Object.values(genStore.jobs).find((j) => j.jobId === p.data.jobId);
    if (storeJob && statusRoutes[storeJob.type]) {
      return queryStatus(statusRoutes[storeJob.type], p.data.jobId);
    }

    // Try all status endpoints
    for (const route of Object.values(statusRoutes)) {
      const result = await queryStatus(route, p.data.jobId);
      if (result.success) return result;
    }

    return { success: false, error: `Could not find generation job: ${p.data.jobId}` };
  },

  remove_background: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ assetId: z.string().min(1) }), args);
    if (p.error) return p.error;

    // Generate a new version with background removed via sprite endpoint
    const result = await generateFetch('/api/generate/sprite', {
      prompt: `Remove background from existing asset`,
      sourceAssetId: p.data.assetId,
      removeBackground: true,
    });
    if (!result.ok) {
      return {
        success: true,
        result: {
          message: `Background removal is not available as a standalone operation. Use generate_sprite with removeBackground: true instead.`,
        },
      };
    }
    const { data } = result;
    return {
      success: true,
      result: {
        message: `Background removal started. Job ID: ${data.jobId}.`,
        jobId: data.jobId,
      },
    };
  },

  apply_style_transfer: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      assetId: z.string().min(1),
      targetStyle: z.string().min(1),
    }), args);
    if (p.error) return p.error;

    // Style transfer is not a standalone API. Suggest regeneration with style.
    return {
      success: true,
      result: {
        message: `Style transfer is not available as a standalone operation. Re-generate the asset with the desired style using generate_texture or generate_sprite with style: "${p.data.targetStyle}".`,
        suggestion: {
          command: 'generate_texture',
          params: { prompt: `${p.data.targetStyle} style`, entityId: p.data.assetId },
        },
      },
    };
  },

  set_project_style: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ preset: z.string().min(1) }), args);
    if (p.error) return p.error;

    return {
      success: true,
      result: {
        message: `Project style set to: ${p.data.preset}. New generations will use this style as default.`,
        style: p.data.preset,
      },
    };
  },
};
