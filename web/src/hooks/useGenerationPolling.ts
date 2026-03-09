/**
 * Polls generation job status at 3-second intervals.
 * Auto-stops when job completes or fails.
 * Maximum poll duration: 5 minutes (100 polls).
 *
 * On completion:
 * - Downloads result from URL
 * - Converts to base64
 * - Dispatches appropriate import command
 * - Updates generation store
 *
 * On failure:
 * - Triggers token refund via /api/generate/refund
 * - Updates generation store with error
 */

'use client';

import { useEffect, useRef } from 'react';
import { useGenerationStore } from '@/stores/generationStore';
import { useEditorStore } from '@/stores/editorStore';
import { postProcess, inferSfxCategory } from '@/lib/generate/postProcess';
import { analyzeModelQuality } from '@/lib/generate/modelQuality';
import { detectGridDimensions, sliceSheet, buildSpriteSheetData } from '@/lib/sprites/sheetImporter';

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_COUNT = 100; // 5 minutes

interface StatusResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  resultUrl?: string;
  maps?: Record<string, string>;
  error?: string;
  durationSeconds?: number;
}

export function useGenerationPolling() {
  const jobs = useGenerationStore((s) => s.jobs);
  const updateJob = useGenerationStore((s) => s.updateJob);
  const pollCountsRef = useRef<Record<string, number>>({});
  const timersRef = useRef<Record<string, NodeJS.Timeout>>({});

  useEffect(() => {
    const activeJobs = Object.values(jobs).filter(
      (j) => j.status === 'pending' || j.status === 'processing'
    );

    for (const job of activeJobs) {
      // Skip if already polling
      if (timersRef.current[job.id]) continue;

      // Start polling for this job
      startPolling(job.id, job.jobId, job.type);
    }

    // Cleanup timers for jobs that are no longer active
    const activeJobIds = new Set(activeJobs.map((j) => j.id));
    for (const id of Object.keys(timersRef.current)) {
      if (!activeJobIds.has(id)) {
        clearInterval(timersRef.current[id]);
        delete timersRef.current[id];
        delete pollCountsRef.current[id];
      }
    }

    return () => {
      // Cleanup all timers on unmount
      for (const timer of Object.values(timersRef.current)) {
        clearInterval(timer);
      }
      timersRef.current = {};
      pollCountsRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  function startPolling(id: string, jobId: string, type: string) {
    pollCountsRef.current[id] = 0;

    const poll = async () => {
      pollCountsRef.current[id] = (pollCountsRef.current[id] || 0) + 1;

      // Timeout after max polls
      if (pollCountsRef.current[id] > MAX_POLL_COUNT) {
        await triggerRefund(id);
        updateJob(id, {
          status: 'failed',
          error: 'Generation timed out',
        });
        clearInterval(timersRef.current[id]);
        delete timersRef.current[id];
        return;
      }

      try {
        const endpoint = getStatusEndpoint(type);
        const response = await fetch(`${endpoint}?jobId=${jobId}`);

        if (!response.ok) {
          throw new Error(`Status check failed: ${response.status}`);
        }

        const data: StatusResponse = await response.json();

        if (data.status === 'completed') {
          updateJob(id, { status: 'downloading', progress: 100 });

          // Download and import result
          await handleCompletion(id, type, data);

          // Stop polling
          clearInterval(timersRef.current[id]);
          delete timersRef.current[id];
        } else if (data.status === 'failed') {
          await triggerRefund(id);
          updateJob(id, {
            status: 'failed',
            error: data.error || 'Generation failed',
          });

          // Stop polling
          clearInterval(timersRef.current[id]);
          delete timersRef.current[id];
        } else {
          // Update progress
          updateJob(id, {
            status: data.status,
            progress: data.progress,
          });
        }
      } catch (err) {
        console.error('Poll error:', err);
        // Continue polling unless we've maxed out
      }
    };

    // Start timer
    timersRef.current[id] = setInterval(poll, POLL_INTERVAL_MS);

    // Immediate first poll
    poll();
  }

  function getStatusEndpoint(type: string): string {
    switch (type) {
      case 'model':
        return '/api/generate/model/status';
      case 'texture':
        return '/api/generate/texture/status';
      case 'skybox':
        return '/api/generate/skybox/status';
      case 'music':
        return '/api/generate/music/status';
      case 'sprite':
        return '/api/generate/sprite/status';
      case 'sprite_sheet':
        return '/api/generate/sprite-sheet/status';
      case 'tileset':
        return '/api/generate/tileset-gen/status';
      case 'pixel-art':
        return '/api/generate/pixel-art/status';
      default:
        throw new Error(`Unknown generation type: ${type}`);
    }
  }

  async function handleCompletion(id: string, type: string, data: StatusResponse) {
    const job = useGenerationStore.getState().jobs[id];
    if (!job) return;

    try {
      // Run post-processing pipeline
      const ppConfig = type === 'sfx' || type === 'voice'
        ? { sfxCategory: inferSfxCategory(job.prompt) }
        : undefined;
      const ppResult = postProcess(type as Parameters<typeof postProcess>[0], job.prompt, ppConfig);

      // Log warnings
      for (const warning of ppResult.warnings) {
        console.warn(`[PostProcess] ${type}:`, warning);
      }

      if (type === 'model') {
        // Download GLB and import
        if (!data.resultUrl) throw new Error('No result URL');

        const blob = await downloadBinary(data.resultUrl);

        // Run model quality analysis on the raw GLB
        const qualityMetrics = await analyzeModelQuality(blob);
        for (const warning of qualityMetrics.warnings) {
          console.warn(`[ModelQuality] ${warning}`);
        }

        if (!qualityMetrics.validFormat) {
          throw new Error('Downloaded file is not a valid GLB model');
        }

        const base64 = await blobToBase64(blob);

        const assetName = (ppResult.metadata.assetName as string) ?? `Generated_${job.prompt.slice(0, 20)}`;
        useEditorStore.getState().importGltf(base64, assetName);

        updateJob(id, {
          status: 'completed',
          resultUrl: data.resultUrl,
          metadata: {
            ...job.metadata,
            ...ppResult.metadata,
            quality: {
              fileSize: qualityMetrics.fileSize,
              sizeCategory: qualityMetrics.sizeCategory,
              estimatedTriangles: qualityMetrics.estimatedTriangles,
              polyBudget: qualityMetrics.polyBudget,
              primitiveCount: qualityMetrics.primitiveCount,
              materialCount: qualityMetrics.materialCount,
            },
          },
        });
      } else if (type === 'texture') {
        // Download PBR maps and apply to entity
        if (!data.maps) throw new Error('No texture maps');

        const entityId = job.entityId;
        if (!entityId) {
          updateJob(id, { status: 'completed' });
          return;
        }

        const slotMap: Record<string, string> = {
          albedo: 'base_color',
          normal: 'normal',
          metallic_roughness: 'metallic_roughness',
          emissive: 'emissive',
          ao: 'occlusion',
        };

        for (const [mapType, url] of Object.entries(data.maps)) {
          const blob = await downloadBinary(url);
          const base64 = await blobToBase64(blob);
          const slot = slotMap[mapType];
          if (slot) {
            useEditorStore.getState().loadTexture(base64, `${mapType}_${entityId}`, entityId, slot);
          }
        }

        updateJob(id, {
          status: 'completed',
          metadata: { ...job.metadata, ...ppResult.metadata },
        });
      } else if (type === 'skybox') {
        // Download equirectangular image and apply as scene skybox
        if (!data.resultUrl) throw new Error('No result URL');

        const blob = await downloadBinary(data.resultUrl);
        const base64 = await blobToBase64(blob);

        useEditorStore.getState().setCustomSkybox(`generated_skybox_${id}`, base64);

        updateJob(id, {
          status: 'completed',
          resultUrl: data.resultUrl,
          metadata: { ...job.metadata, ...ppResult.metadata },
        });
      } else if (type === 'music') {
        // Download audio and import with looping enabled
        if (!data.resultUrl) throw new Error('No result URL');

        const blob = await downloadBinary(data.resultUrl);
        const base64 = await blobToBase64(blob);

        const assetName = (ppResult.metadata.assetName as string) ?? `Music_${job.prompt.slice(0, 20)}`;
        const store = useEditorStore.getState();
        store.importAudio(base64, assetName);

        // Attach looping music audio to target entity
        // Note: importAudio uses the name as the asset ID in the engine's asset registry,
        // so assetName IS the correct identifier to reference this asset.
        if (job.entityId) {
          store.setAudio(job.entityId, {
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

        updateJob(id, {
          status: 'completed',
          resultUrl: data.resultUrl,
          metadata: { ...job.metadata, ...ppResult.metadata },
        });
      } else if (type === 'pixel-art') {
        // Download pixel art result image and store as asset
        if (!data.resultUrl) throw new Error('No result URL');

        const blob = await downloadBinary(data.resultUrl);
        const base64 = await blobToBase64(blob);

        const assetName = (ppResult.metadata.assetName as string) ?? `PixelArt_${job.prompt.slice(0, 20)}`;
        const entityId = job.entityId;

        if (entityId) {
          useEditorStore.getState().loadTexture(base64, assetName, entityId, 'base_color');
        }

        updateJob(id, {
          status: 'completed',
          resultUrl: data.resultUrl,
          metadata: { ...job.metadata, ...ppResult.metadata },
        });
      } else if (type === 'sprite_sheet') {
        // Download sprite sheet, slice into frames, and set sprite sheet data
        if (!data.resultUrl) throw new Error('No result URL');

        const blob = await downloadBinary(data.resultUrl);
        const base64 = await blobToBase64(blob);

        const assetName = (ppResult.metadata.assetName as string) ?? `SpriteSheet_${job.prompt.slice(0, 20)}`;
        const entityId = job.entityId;

        if (entityId) {
          useEditorStore.getState().loadTexture(base64, assetName, entityId, 'base_color');
        }

        // Slice the sprite sheet into individual frames
        const imgDims = await getImageDimensions(blob);
        const grid = detectGridDimensions(imgDims.width, imgDims.height);
        const frames = sliceSheet(imgDims.width, imgDims.height, grid.rows, grid.columns);
        const sheetData = buildSpriteSheetData(
          assetName,
          { width: imgDims.width, height: imgDims.height, grid, frames },
          assetName,
        );

        if (entityId) {
          useEditorStore.getState().setSpriteSheet(entityId, sheetData);
        }

        updateJob(id, {
          status: 'completed',
          resultUrl: data.resultUrl,
          metadata: {
            ...job.metadata,
            ...ppResult.metadata,
            spriteSheet: {
              columns: grid.columns,
              rows: grid.rows,
              frameWidth: grid.frameWidth,
              frameHeight: grid.frameHeight,
              frameCount: frames.length,
            },
          },
        });
      } else if (type === 'sprite' || type === 'tileset') {
        // Download image and apply as texture to target entity (or store as asset)
        if (!data.resultUrl) throw new Error('No result URL');

        const blob = await downloadBinary(data.resultUrl);
        const base64 = await blobToBase64(blob);

        const assetName = (ppResult.metadata.assetName as string) ?? `Sprite_${job.prompt.slice(0, 20)}`;
        const entityId = job.entityId;

        if (entityId) {
          // Apply as base_color texture on the target entity
          useEditorStore.getState().loadTexture(base64, assetName, entityId, 'base_color');
        }

        updateJob(id, {
          status: 'completed',
          resultUrl: data.resultUrl,
          metadata: { ...job.metadata, ...ppResult.metadata },
        });
      }
    } catch (err) {
      console.error('Completion error:', err);
      updateJob(id, {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Download failed',
      });
    }
  }

  async function triggerRefund(id: string) {
    const job = useGenerationStore.getState().jobs[id];
    if (!job?.usageId) return;
    try {
      await fetch('/api/generate/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usageId: job.usageId }),
      });
    } catch (err) {
      console.error('Token refund failed:', err);
    }
  }

  async function downloadBinary(url: string): Promise<Blob> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    return response.blob();
  }

  async function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to decode sprite sheet image for slicing'));
      };
      img.src = url;
    });
  }
}
