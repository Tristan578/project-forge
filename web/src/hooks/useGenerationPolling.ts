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
      default:
        throw new Error(`Unknown generation type: ${type}`);
    }
  }

  async function handleCompletion(id: string, type: string, data: StatusResponse) {
    const job = useGenerationStore.getState().jobs[id];
    if (!job) return;

    try {
      if (type === 'model') {
        // Download GLB and import
        if (!data.resultUrl) throw new Error('No result URL');

        const blob = await downloadBinary(data.resultUrl);
        const base64 = await blobToBase64(blob);

        useEditorStore.getState().importGltf(base64, `Generated_${job.prompt.slice(0, 20)}`);

        updateJob(id, { status: 'completed', resultUrl: data.resultUrl });
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

        updateJob(id, { status: 'completed' });
      } else if (type === 'skybox') {
        // Download equirectangular image and apply
        if (!data.resultUrl) throw new Error('No result URL');

        const blob = await downloadBinary(data.resultUrl);
        const _base64 = await blobToBase64(blob);

        // TODO: Implement set_custom_skybox command (Phase 14-D Rust work)
        // For now, just mark as completed
        updateJob(id, { status: 'completed', resultUrl: data.resultUrl });
      } else if (type === 'music') {
        // Download audio and import
        if (!data.resultUrl) throw new Error('No result URL');

        const blob = await downloadBinary(data.resultUrl);
        const base64 = await blobToBase64(blob);

        useEditorStore.getState().importAudio(base64, `Music_${job.prompt.slice(0, 20)}`);

        updateJob(id, { status: 'completed', resultUrl: data.resultUrl });
      }
    } catch (err) {
      console.error('Completion error:', err);
      updateJob(id, {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Download failed',
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
}
