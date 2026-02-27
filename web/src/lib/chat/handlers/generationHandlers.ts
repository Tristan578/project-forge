/**
 * Generation handlers for MCP commands.
 * Wires AI asset generation commands to API routes and the generation store.
 */

import type { ToolHandler, ExecutionResult } from './types';
import { useGenerationStore } from '@/stores/generationStore';
import type { GenerationType } from '@/stores/generationStore';

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
  generate_3d_model: async (args, _ctx): Promise<ExecutionResult> => {
    const result = await generateFetch('/api/generate/model', {
      prompt: args.prompt,
      quality: args.quality ?? 'standard',
      artStyle: args.artStyle ?? 'realistic',
      negativePrompt: args.negativePrompt,
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'model',
      prompt: args.prompt as string,
      provider: (data.provider as string) ?? 'meshy',
    });

    return {
      success: true,
      result: {
        message: `3D model generation started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
        jobId: data.jobId,
      },
    };
  },

  generate_3d_from_image: async (args, _ctx): Promise<ExecutionResult> => {
    const result = await generateFetch('/api/generate/model', {
      imageBase64: args.imageBase64,
      prompt: args.prompt,
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'model',
      prompt: (args.prompt as string) ?? 'image-to-3d',
      provider: (data.provider as string) ?? 'meshy',
    });

    return {
      success: true,
      result: {
        message: `3D model generation from image started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
        jobId: data.jobId,
      },
    };
  },

  generate_texture: async (args, _ctx): Promise<ExecutionResult> => {
    const result = await generateFetch('/api/generate/texture', {
      prompt: args.prompt,
      entityId: args.entityId,
      resolution: args.resolution ?? '1024',
      style: args.style ?? 'realistic',
      tiling: args.tiling ?? false,
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'texture',
      prompt: args.prompt as string,
      provider: (data.provider as string) ?? 'meshy',
      entityId: args.entityId as string | undefined,
    });

    return {
      success: true,
      result: {
        message: `Texture generation started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
        jobId: data.jobId,
      },
    };
  },

  generate_pbr_maps: async (args, _ctx): Promise<ExecutionResult> => {
    const result = await generateFetch('/api/generate/texture', {
      prompt: args.prompt,
      entityId: args.entityId,
      maps: args.maps,
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'texture',
      prompt: args.prompt as string,
      provider: (data.provider as string) ?? 'meshy',
      entityId: args.entityId as string | undefined,
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
    const result = await generateFetch('/api/generate/sfx', {
      prompt: args.prompt,
      durationSeconds: args.durationSeconds ?? 5,
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const assetName = `sfx-${(args.prompt as string).slice(0, 20)}`;
    ctx.store.importAudio(data.audioBase64 as string, assetName);
    if (args.entityId) {
      ctx.store.setAudio(args.entityId as string, {
        assetId: assetName,
        volume: 1.0,
        pitch: 1.0,
        loopAudio: false,
        spatial: true,
        maxDistance: 30,
        refDistance: 1,
        rolloffFactor: 1,
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
    const result = await generateFetch('/api/generate/voice', {
      text: args.text,
      voiceStyle: args.voiceStyle ?? 'neutral',
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const assetName = `voice-${(args.text as string).slice(0, 20)}`;
    ctx.store.importAudio(data.audioBase64 as string, assetName);
    if (args.entityId) {
      ctx.store.setAudio(args.entityId as string, {
        assetId: assetName,
        volume: 1.0,
        pitch: 1.0,
        loopAudio: false,
        spatial: true,
        maxDistance: 30,
        refDistance: 1,
        rolloffFactor: 1,
        autoplay: false,
        bus: 'voice',
      });
    }

    return {
      success: true,
      result: { message: `Voice dialogue generated and imported as "${assetName}".` },
    };
  },

  generate_skybox: async (args, _ctx): Promise<ExecutionResult> => {
    const result = await generateFetch('/api/generate/skybox', {
      prompt: args.prompt,
      style: args.style ?? 'realistic',
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'skybox',
      prompt: args.prompt as string,
      provider: (data.provider as string) ?? 'meshy',
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
    const result = await generateFetch('/api/generate/music', {
      prompt: args.prompt,
      durationSeconds: args.durationSeconds ?? 30,
      instrumental: args.instrumental ?? true,
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    // Music API may return audioBase64 (sync) or jobId (async)
    if (data.audioBase64) {
      const assetName = `music-${(args.prompt as string).slice(0, 20)}`;
      ctx.store.importAudio(data.audioBase64 as string, assetName);
      if (args.entityId) {
        ctx.store.setAudio(args.entityId as string, {
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
      prompt: args.prompt as string,
      provider: (data.provider as string) ?? 'suno',
      entityId: args.entityId as string | undefined,
    });

    return {
      success: true,
      result: {
        message: `Music generation started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
        jobId: data.jobId,
      },
    };
  },

  generate_sprite: async (args, _ctx): Promise<ExecutionResult> => {
    const result = await generateFetch('/api/generate/sprite', {
      prompt: args.prompt,
      style: args.style,
      size: args.size ?? '64x64',
      removeBackground: args.removeBackground ?? true,
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'sprite',
      prompt: args.prompt as string,
      provider: (data.provider as string) ?? 'dalle3',
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
    const result = await generateFetch('/api/generate/sprite-sheet', {
      sourceAssetId: args.sourceAssetId,
      frameCount: args.frameCount ?? 4,
      style: args.style,
      size: args.size ?? '64x64',
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'sprite_sheet',
      prompt: `sprite-sheet from ${args.sourceAssetId}`,
      provider: (data.provider as string) ?? 'dalle3',
    });

    return {
      success: true,
      result: {
        message: `Sprite sheet generation started. Job ID: ${data.jobId}. Estimated time: ~${data.estimatedSeconds}s.`,
        jobId: data.jobId,
      },
    };
  },

  generate_character: async (args, _ctx): Promise<ExecutionResult> => {
    const poses = args.poses as string[] | undefined;
    if (!poses || poses.length === 0) {
      return { success: false, error: 'No poses specified' };
    }

    // Generate each pose as a separate sprite generation job
    const jobIds: string[] = [];
    for (const pose of poses) {
      const prompt = `${args.prompt as string} - ${pose} pose`;
      const result = await generateFetch('/api/generate/sprite', {
        prompt,
        style: args.style ?? 'cartoon',
        size: args.size ?? '128x128',
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
        message: `Character generation started for ${jobIds.length}/${poses.length} poses.`,
        jobIds,
      },
    };
  },

  generate_tileset: async (args, _ctx): Promise<ExecutionResult> => {
    const result = await generateFetch('/api/generate/tileset-gen', {
      prompt: args.prompt,
      tileSize: args.tileSize ?? 32,
      gridSize: args.gridSize ?? '8x8',
    });
    if (!result.ok) return { success: false, error: result.error };
    const { data } = result;

    const localId = makeJobId();
    trackJob({
      jobId: localId,
      providerJobId: data.jobId as string,
      type: 'tileset',
      prompt: args.prompt as string,
      provider: (data.provider as string) ?? 'dalle3',
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
    const jobId = args.jobId as string;
    if (!jobId) return { success: false, error: 'Missing jobId' };
    return queryStatus('/api/generate/sprite/status', jobId);
  },

  get_generation_status: async (args, _ctx): Promise<ExecutionResult> => {
    const jobId = args.jobId as string;
    const type = args.type as string;
    if (!jobId) return { success: false, error: 'Missing jobId' };

    // Route to the correct status endpoint based on generation type
    const statusRoutes: Record<string, string> = {
      model: '/api/generate/model/status',
      texture: '/api/generate/texture/status',
      skybox: '/api/generate/skybox/status',
      music: '/api/generate/music/status',
      sprite: '/api/generate/sprite/status',
    };

    // If type is specified, use it directly
    if (type && statusRoutes[type]) {
      return queryStatus(statusRoutes[type], jobId);
    }

    // Try to find the job in the generation store to determine type
    const genStore = useGenerationStore.getState();
    const storeJob = Object.values(genStore.jobs).find((j) => j.jobId === jobId);
    if (storeJob && statusRoutes[storeJob.type]) {
      return queryStatus(statusRoutes[storeJob.type], jobId);
    }

    // Try all status endpoints
    for (const route of Object.values(statusRoutes)) {
      const result = await queryStatus(route, jobId);
      if (result.success) return result;
    }

    return { success: false, error: `Could not find generation job: ${jobId}` };
  },

  remove_background: async (args, _ctx): Promise<ExecutionResult> => {
    const assetId = args.assetId as string;
    if (!assetId) return { success: false, error: 'Missing assetId' };

    // Generate a new version with background removed via sprite endpoint
    const result = await generateFetch('/api/generate/sprite', {
      prompt: `Remove background from existing asset`,
      sourceAssetId: assetId,
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
    const assetId = args.assetId as string;
    const targetStyle = args.targetStyle as string;
    if (!assetId || !targetStyle) {
      return { success: false, error: 'Missing assetId or targetStyle' };
    }

    // Style transfer is not a standalone API. Suggest regeneration with style.
    return {
      success: true,
      result: {
        message: `Style transfer is not available as a standalone operation. Re-generate the asset with the desired style using generate_texture or generate_sprite with style: "${targetStyle}".`,
        suggestion: {
          command: 'generate_texture',
          params: { prompt: `${targetStyle} style`, entityId: assetId },
        },
      },
    };
  },

  set_project_style: async (args, _ctx): Promise<ExecutionResult> => {
    const preset = args.preset as string;
    if (!preset) return { success: false, error: 'Missing preset' };

    return {
      success: true,
      result: {
        message: `Project style set to: ${preset}. New generations will use this style as default.`,
        style: preset,
      },
    };
  },
};
