/**
 * Polls generation job status. Durable jobs use server callbacks as the
 * primary completion channel and only perform sparse safety/focus reads;
 * legacy jobs retain the 3-second loop.
 * Auto-stops when job completes or fails.
 * Maximum poll duration: 5 minutes.
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
import { getStatusEndpoint } from '@/lib/generation/statusEndpoints';
import { postProcess, inferSfxCategory } from '@/lib/generate/postProcess';
import { analyzeModelQuality } from '@/lib/generate/modelQuality';
import { detectGridDimensions, sliceSheet, buildSpriteSheetData } from '@/lib/sprites/sheetImporter';
import { retryWithBackoff } from '@/lib/utils/retryWithBackoff';
import { enqueueFailedRefund, processFailedRefunds } from '@/lib/utils/refundQueue';

const POLL_INTERVAL_MS = 3000;
const DURABLE_POLL_INTERVAL_MS = 30_000;
const MAX_POLL_DURATION_MS = 5 * 60 * 1000;

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
  const timersRef = useRef<Record<string, NodeJS.Timeout>>({});
  const startedAtRef = useRef<Record<string, number>>({});
  const durablePollsRef = useRef<Record<string, () => void>>({});
  const inFlightPollsRef = useRef<Record<string, true>>({});

  // On mount: drain any refunds that failed in a previous session
  useEffect(() => {
    processFailedRefunds().catch((err) => {
      console.error('processFailedRefunds error:', err);
    });
  }, []);


  // Separate effect for unmount-only cleanup so that timer teardown does not
  // run on every jobs state change (which would desync the polling loop).
  useEffect(() => {
    return () => {
      for (const timer of Object.values(timersRef.current)) {
        clearInterval(timer);
      }
      timersRef.current = {};
      startedAtRef.current = {};
      durablePollsRef.current = {};
      inFlightPollsRef.current = {};
    };
  }, []);

  // Durable callbacks update the persisted job server-side. Refresh the client
  // view when the user returns, without maintaining a hot 3-second loop.
  useEffect(() => {
    const recheckDurableJobs = () => {
      for (const poll of Object.values(durablePollsRef.current)) poll();
    };
    const recheckVisibleDurableJobs = () => {
      if (document.visibilityState === 'visible') recheckDurableJobs();
    };

    window.addEventListener('focus', recheckDurableJobs);
    document.addEventListener('visibilitychange', recheckVisibleDurableJobs);
    return () => {
      window.removeEventListener('focus', recheckDurableJobs);
      document.removeEventListener('visibilitychange', recheckVisibleDurableJobs);
    };
  }, []);

  function startPolling(id: string, jobId: string, type: string, durable: boolean) {
    const poll = async () => {
      // Focus/visibility and the safety interval can fire together. Serialize
      // reads per job so two completed responses cannot import the same asset.
      if (inFlightPollsRef.current[id]) return;
      inFlightPollsRef.current[id] = true;
      try {
      const startedAt = startedAtRef.current[id] ?? Date.now();
      startedAtRef.current[id] = startedAt;
      // Keep the existing five-minute overall cap independent of focus events
      // or the selected safety interval.
      if (Date.now() - startedAt >= MAX_POLL_DURATION_MS) {
        await triggerRefund(id);
        updateJob(id, {
          status: 'failed',
          error: 'Generation timed out',
        });
        clearInterval(timersRef.current[id]);
        delete timersRef.current[id];
        delete durablePollsRef.current[id];
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
          delete durablePollsRef.current[id];
        } else if (data.status === 'failed') {
          await triggerRefund(id);
          updateJob(id, {
            status: 'failed',
            error: data.error || 'Generation failed',
          });

          // Stop polling
          clearInterval(timersRef.current[id]);
          delete timersRef.current[id];
          delete durablePollsRef.current[id];
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
      } finally {
        delete inFlightPollsRef.current[id];
      }
    };

    // Start timer
    timersRef.current[id] = setInterval(
      poll,
      durable ? DURABLE_POLL_INTERVAL_MS : POLL_INTERVAL_MS,
    );
    if (durable) durablePollsRef.current[id] = () => { void poll(); };

    // Immediate first poll
    void poll();
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

        const shouldPlace = job.autoPlace !== false;

        // Skip expensive download + analysis when autoPlace is disabled
        if (!shouldPlace) {
          updateJob(id, {
            status: 'completed',
            resultUrl: data.resultUrl,
            metadata: {
              ...job.metadata,
              ...ppResult.metadata,
              autoPlaced: false,
              targetEntityId: job.targetEntityId,
            },
          });
          return;
        }

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

        if (shouldPlace) {
          // Pass the job's targetEntityId so a placeholder primitive (spawned by the
          // orchestrator before generation) is replaced in place rather than leaving
          // the model as a sibling root. Textures/audio already consume this id;
          // models were the only generated type that dropped it.
          useEditorStore.getState().importGltf(base64, assetName, job.targetEntityId);
        }

        updateJob(id, {
          status: 'completed',
          resultUrl: data.resultUrl,
          metadata: {
            ...job.metadata,
            ...ppResult.metadata,
            autoPlaced: shouldPlace,
            targetEntityId: job.targetEntityId,
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
        // Download PBR maps and apply to entity. A truthy-but-empty `{}` is not a
        // usable result — `Object.entries({})` would iterate zero times and mark the
        // job `completed` with no textures applied and no error. Treat it as missing
        // so the catch below refunds, matching the status route's own empty-maps guard.
        if (!data.maps || Object.keys(data.maps).length === 0) throw new Error('No texture maps');

        // Use targetEntityId (from autoPlace) or fall back to legacy entityId
        const entityId = job.targetEntityId ?? job.entityId;
        if (!entityId || job.autoPlace === false) {
          updateJob(id, {
            status: 'completed',
            metadata: { ...job.metadata, ...ppResult.metadata },
          });
          return;
        }

        const slotMap: Record<string, string> = {
          albedo: 'base_color',
          normal: 'normal_map',
          metallic_roughness: 'metallic_roughness',
          emissive: 'emissive',
          ao: 'occlusion',
        };

        // If a specific materialSlot was requested, only apply that map
        const targetSlot = job.materialSlot;
        for (const [mapType, url] of Object.entries(data.maps)) {
          const slot = slotMap[mapType];
          if (!slot) continue;
          // When materialSlot is specified, only apply the matching slot
          if (targetSlot && slot !== targetSlot) continue;

          const blob = await downloadBinary(url);
          const base64 = await blobToBase64(blob);
          useEditorStore.getState().loadTexture(base64, `${mapType}_${entityId}`, entityId, slot);
        }

        updateJob(id, {
          status: 'completed',
          metadata: {
            ...job.metadata,
            ...ppResult.metadata,
            autoPlaced: true,
            targetEntityId: entityId,
            materialSlot: targetSlot,
          },
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
        // Use targetEntityId (from autoPlace) or fall back to legacy entityId
        const entityId = job.targetEntityId ?? job.entityId;
        if (entityId && job.autoPlace !== false) {
          store.setAudio(entityId, {
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
          metadata: {
            ...job.metadata,
            ...ppResult.metadata,
            autoPlaced: !!entityId && job.autoPlace !== false,
            targetEntityId: entityId,
          },
        });
      } else if (type === 'pixel-art') {
        // Download pixel art result image and store as asset
        if (!data.resultUrl) throw new Error('No result URL');

        const blob = await downloadBinary(data.resultUrl);
        const base64 = await blobToBase64(blob);

        const assetName = (ppResult.metadata.assetName as string) ?? `PixelArt_${job.prompt.slice(0, 20)}`;
        const entityId = job.targetEntityId ?? job.entityId;
        const slot = job.materialSlot ?? 'base_color';

        if (entityId && job.autoPlace !== false) {
          useEditorStore.getState().loadTexture(base64, assetName, entityId, slot);
        }

        updateJob(id, {
          status: 'completed',
          resultUrl: data.resultUrl,
          metadata: {
            ...job.metadata,
            ...ppResult.metadata,
            autoPlaced: !!entityId && job.autoPlace !== false,
            targetEntityId: entityId,
            materialSlot: slot,
          },
        });
      } else if (type === 'sprite_sheet') {
        // Download sprite sheet, slice into frames, and set sprite sheet data
        if (!data.resultUrl) throw new Error('No result URL');

        const blob = await downloadBinary(data.resultUrl);
        const base64 = await blobToBase64(blob);

        const assetName = (ppResult.metadata.assetName as string) ?? `SpriteSheet_${job.prompt.slice(0, 20)}`;
        const entityId = job.targetEntityId ?? job.entityId;
        const shouldPlace = !!entityId && job.autoPlace !== false;

        if (shouldPlace) {
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

        if (shouldPlace) {
          useEditorStore.getState().setSpriteSheet(entityId, sheetData);
        }

        updateJob(id, {
          status: 'completed',
          resultUrl: data.resultUrl,
          metadata: {
            ...job.metadata,
            ...ppResult.metadata,
            autoPlaced: shouldPlace,
            targetEntityId: entityId,
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
        const entityId = job.targetEntityId ?? job.entityId;
        const slot = job.materialSlot ?? 'base_color';

        if (entityId && job.autoPlace !== false) {
          // Apply as texture on the target entity
          useEditorStore.getState().loadTexture(base64, assetName, entityId, slot);
        }

        updateJob(id, {
          status: 'completed',
          resultUrl: data.resultUrl,
          metadata: {
            ...job.metadata,
            ...ppResult.metadata,
            autoPlaced: !!entityId && job.autoPlace !== false,
            targetEntityId: entityId,
            materialSlot: slot,
          },
        });
      }
    } catch (err) {
      console.error('Completion error:', err);
      // A job that reached `completed` but failed to download or import a usable
      // artifact must STILL refund — otherwise the user is charged for a result they
      // never received (the same charge-with-no-refund hole the status routes close
      // upstream, #8757). triggerRefund is idempotent server-side (refundTokens uses a
      // CTE ON CONFLICT keyed on usageId) and polling has already stopped by the time
      // this branch is reached, so it fires at most once per job.
      await triggerRefund(id);
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
      await retryWithBackoff(
        () =>
          fetch('/api/generate/refund', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usageId: job.usageId }),
          }).then((res) => {
            if (!res.ok) {
              const err = new Error(`Refund API error: ${res.status}`);
              (err as Error & { status: number }).status = res.status;
              throw err;
            }
          }),
        {
          maxAttempts: 3,
          baseDelayMs: 500,
          isRetryable: (err) => {
            const status = (err as Error & { status?: number }).status;
            return status === undefined || status >= 500;
          },
        },
      );
    } catch (err) {
      console.error('Token refund failed after retries — queuing for next session:', err);
      enqueueFailedRefund({
        jobId: job.usageId,
        provider: job.type,
        amount: 0,
        timestamp: Date.now(),
      });
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

  // Declared AFTER `startPolling` and its helpers, not before them.
  //
  // Function declarations hoist, so calling `startPolling` from above it ran
  // fine — but `react-hooks/immutability` refuses the shape, and it is right to:
  // the effect closes over whatever the identifier holds, and a hoisted binding
  // read before its declaration is one edit away (`function` -> `const`) from
  // being `undefined` at call time, with nothing at the call site to say so.
  // Moving the effect below the declarations is behaviour-identical: both of the
  // other effects have `[]` deps and register cleanup only, so the mount order
  // this changes is not observable.
  useEffect(() => {
    const activeJobs = Object.values(jobs).filter(
      (j) => j.status === 'pending' || j.status === 'processing'
    );

    for (const job of activeJobs) {
      // Skip if already polling
      if (timersRef.current[job.id]) continue;

      // Start polling for this job
      startPolling(job.id, job.jobId, job.type, job.durable === true);
    }

    // Cleanup timers for jobs that are no longer active
    const activeJobIds = new Set(activeJobs.map((j) => j.id));
    for (const id of Object.keys(timersRef.current)) {
      if (!activeJobIds.has(id)) {
        clearInterval(timersRef.current[id]);
        delete timersRef.current[id];
        delete startedAtRef.current[id];
        delete durablePollsRef.current[id];
        delete inFlightPollsRef.current[id];
      }
    }
    // NOTE: No cleanup return here — clearing all timers on deps change would stop
    // in-flight polls every time updateJob() causes a re-render (PF-699 desync bug).
    // Unmount cleanup is handled by the separate [] -deps effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);
}
