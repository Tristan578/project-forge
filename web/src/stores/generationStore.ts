/**
 * Generation job tracking store.
 *
 * Manages AI asset generation jobs across all providers.
 * Jobs are persisted to the database via /api/jobs and
 * hydrated on page load so in-flight jobs survive refresh.
 */

import { create } from 'zustand';
import { useGenerationHistoryStore } from './generationHistoryStore';
import { trackEvent, AnalyticsEvent } from '@/lib/analytics/posthog';

export type GenerationType = 'model' | 'texture' | 'sfx' | 'voice' | 'skybox' | 'music' | 'sprite' | 'sprite_sheet' | 'tileset' | 'pixel-art';
export type GenerationStatus = 'pending' | 'processing' | 'downloading' | 'completed' | 'failed';

export interface GenerationJob {
  id: string;               // UUID assigned client-side or from DB
  jobId: string;            // Provider job ID (from API route response)
  type: GenerationType;
  prompt: string;
  status: GenerationStatus;
  progress: number;          // 0-100
  provider: string;
  createdAt: number;         // Date.now() — stored once, not used in render
  resultUrl?: string;
  error?: string;
  entityId?: string;         // Target entity (for texture/audio attachment)
  usageId?: string;          // Token usage ID for refund on failure
  metadata?: Record<string, unknown>;  // Type-specific data
  dbId?: string;             // Database record ID (for syncing)
  // TODO: persist autoPlace/targetEntityId/materialSlot in job parameters JSON
  // so hydrateFromServer restores them correctly after page refresh.
  autoPlace?: boolean;       // Auto-import and attach to entity on completion
  targetEntityId?: string;   // Entity to attach result to (e.g. place model as child, assign texture)
  materialSlot?: string;     // Material texture slot for texture generation (e.g. 'base_color', 'normal_map')
}

interface GenerationState {
  jobs: Record<string, GenerationJob>;
  hydrated: boolean;

  // Computed
  get activeJobCount(): number;

  // Actions
  addJob: (job: GenerationJob) => void;
  updateJob: (id: string, updates: Partial<GenerationJob>) => void;
  removeJob: (id: string) => void;
  clearCompleted: () => void;
  hydrateFromServer: () => Promise<void>;
}

export const useGenerationStore = create<GenerationState>((set, get) => ({
  jobs: {},
  hydrated: false,

  get activeJobCount() {
    const jobs = get().jobs;
    return Object.values(jobs).filter(
      (j) => j.status === 'pending' || j.status === 'processing' || j.status === 'downloading'
    ).length;
  },

  addJob: (job) => {
    set((state) => ({
      jobs: { ...state.jobs, [job.id]: job },
    }));
    trackEvent(AnalyticsEvent.AI_GENERATION_STARTED, { type: job.type, provider: job.provider });

    // Persist to database (fire-and-forget)
    fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerJobId: job.jobId,
        provider: job.provider,
        type: job.type,
        prompt: job.prompt,
        tokenCost: 0,
        tokenUsageId: job.usageId,
        entityId: job.entityId,
      }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.job?.id) {
          // Store the DB id for future syncs
          set((state) => {
            const existing = state.jobs[job.id];
            if (!existing) return state;
            return {
              jobs: { ...state.jobs, [job.id]: { ...existing, dbId: data.job.id } },
            };
          });
        }
      })
      .catch(() => {
        // DB persistence failed — job still works in memory
      });
  },

  updateJob: (id, updates) =>
    set((state) => {
      const existing = state.jobs[id];
      if (!existing) return state;
      const updated = { ...existing, ...updates };

      // Track completion
      if (updated.status === 'completed' && existing.status !== 'completed') {
        trackEvent(AnalyticsEvent.AI_GENERATION_COMPLETED, { type: updated.type, provider: updated.provider });
      }

      // Auto-save completed jobs with results to generation history
      if (updated.status === 'completed' && updated.resultUrl) {
        useGenerationHistoryStore.getState().addEntry({
          id: updated.id,
          type: updated.type,
          prompt: updated.prompt,
          provider: updated.provider,
          resultUrl: updated.resultUrl,
          createdAt: updated.createdAt,
          metadata: updated.metadata,
        });
      }

      // Sync status to database (fire-and-forget)
      const dbId = updated.dbId;
      if (dbId && (updates.status || updates.progress !== undefined)) {
        fetch(`/api/jobs/${dbId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: updates.status,
            progress: updates.progress,
            resultUrl: updates.resultUrl,
            errorMessage: updates.error,
            imported: updates.status === 'completed',
          }),
        }).catch(() => {
          // DB sync failed — non-critical
        });
      }

      return {
        jobs: { ...state.jobs, [id]: updated },
      };
    }),

  removeJob: (id) =>
    set((state) => {
      const newJobs = { ...state.jobs };
      delete newJobs[id];
      return { jobs: newJobs };
    }),

  clearCompleted: () =>
    set((state) => {
      const newJobs: Record<string, GenerationJob> = {};
      for (const [id, job] of Object.entries(state.jobs)) {
        if (job.status !== 'completed' && job.status !== 'failed') {
          newJobs[id] = job;
        }
      }
      return { jobs: newJobs };
    }),

  hydrateFromServer: async () => {
    try {
      const res = await fetch('/api/jobs?status=active');
      if (!res.ok) return;
      const data = await res.json();
      const serverJobs = data.jobs || [];

      if (serverJobs.length === 0) {
        set({ hydrated: true });
        return;
      }

      const hydratedJobs: Record<string, GenerationJob> = {};
      for (const sj of serverJobs) {
        const localId = `hydrated_${sj.id}`;
        hydratedJobs[localId] = {
          id: localId,
          jobId: sj.providerJobId,
          type: sj.type,
          prompt: sj.prompt,
          status: sj.status,
          progress: sj.progress,
          provider: sj.provider,
          createdAt: new Date(sj.createdAt).getTime(),
          entityId: sj.entityId ?? undefined,
          usageId: sj.tokenUsageId ?? undefined,
          dbId: sj.id,
        };
      }

      set((state) => ({
        jobs: { ...hydratedJobs, ...state.jobs },
        hydrated: true,
      }));
    } catch {
      set({ hydrated: true });
    }
  },
}));
