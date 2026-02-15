/**
 * Generation job tracking store.
 *
 * Manages AI asset generation jobs across all providers.
 */

import { create } from 'zustand';

export type GenerationType = 'model' | 'texture' | 'sfx' | 'voice' | 'skybox' | 'music';
export type GenerationStatus = 'pending' | 'processing' | 'downloading' | 'completed' | 'failed';

export interface GenerationJob {
  id: string;               // UUID assigned client-side
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
  metadata?: Record<string, unknown>;  // Type-specific data
}

interface GenerationState {
  jobs: Record<string, GenerationJob>;

  // Computed
  get activeJobCount(): number;

  // Actions
  addJob: (job: GenerationJob) => void;
  updateJob: (id: string, updates: Partial<GenerationJob>) => void;
  removeJob: (id: string) => void;
  clearCompleted: () => void;
}

export const useGenerationStore = create<GenerationState>((set, get) => ({
  jobs: {},

  get activeJobCount() {
    const jobs = get().jobs;
    return Object.values(jobs).filter(
      (j) => j.status === 'pending' || j.status === 'processing' || j.status === 'downloading'
    ).length;
  },

  addJob: (job) =>
    set((state) => ({
      jobs: { ...state.jobs, [job.id]: job },
    })),

  updateJob: (id, updates) =>
    set((state) => {
      const existing = state.jobs[id];
      if (!existing) return state;
      return {
        jobs: { ...state.jobs, [id]: { ...existing, ...updates } },
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
}));
