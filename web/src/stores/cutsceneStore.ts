/**
 * Cutscene store — manages cinematic cutscene timelines.
 *
 * A cutscene is a sequence of time-stamped tracks that orchestrate existing
 * engine subsystems: camera moves, entity animations, dialogue, and audio cues.
 * Playback is JS-side via requestAnimationFrame; no new Rust systems are needed.
 */

import { create } from 'zustand';

// ============================================================================
// Types
// ============================================================================

export type CutsceneTrackType = 'camera' | 'animation' | 'dialogue' | 'audio' | 'wait';

export type EasingMode = 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out';

export interface CutsceneKeyframe {
  /** Timestamp in seconds from the cutscene start. */
  timestamp: number;
  /** Duration of this keyframe's effect in seconds. */
  duration: number;
  easing: EasingMode;
  /** Payload — varies by track type. */
  payload: Record<string, unknown>;
}

export interface CutsceneTrack {
  id: string;
  type: CutsceneTrackType;
  /** Entity ID targeted by this track (null for scene-wide tracks like camera). */
  entityId: string | null;
  keyframes: CutsceneKeyframe[];
  muted: boolean;
}

export interface Cutscene {
  id: string;
  name: string;
  /** Total duration in seconds. Maximum 60. */
  duration: number;
  tracks: CutsceneTrack[];
  createdAt: number;
  updatedAt: number;
}

export type CutscenePlaybackState = 'idle' | 'playing' | 'paused' | 'stopped';

// ============================================================================
// Store interface
// ============================================================================

export interface CutsceneState {
  cutscenes: Record<string, Cutscene>;
  activeCutsceneId: string | null;
  playbackState: CutscenePlaybackState;
  playbackTime: number;

  // CRUD
  addCutscene: (cutscene: Cutscene) => void;
  updateCutscene: (id: string, patch: Partial<Cutscene>) => void;
  deleteCutscene: (id: string) => void;

  // Track mutations
  addTrack: (cutsceneId: string, track: CutsceneTrack) => void;
  updateTrack: (cutsceneId: string, trackId: string, patch: Partial<CutsceneTrack>) => void;
  removeTrack: (cutsceneId: string, trackId: string) => void;
  addKeyframe: (cutsceneId: string, trackId: string, keyframe: CutsceneKeyframe) => void;
  removeKeyframe: (cutsceneId: string, trackId: string, timestamp: number) => void;

  // Playback control
  setActiveCutscene: (id: string | null) => void;
  setPlaybackState: (state: CutscenePlaybackState) => void;
  setPlaybackTime: (time: number) => void;
}

// ============================================================================
// Store
// ============================================================================

export const useCutsceneStore = create<CutsceneState>()((set) => ({
  cutscenes: {},
  activeCutsceneId: null,
  playbackState: 'idle',
  playbackTime: 0,

  addCutscene: (cutscene) =>
    set((state) => ({
      cutscenes: { ...state.cutscenes, [cutscene.id]: cutscene },
    })),

  updateCutscene: (id, patch) =>
    set((state) => {
      const existing = state.cutscenes[id];
      if (!existing) return state;
      return {
        cutscenes: {
          ...state.cutscenes,
          [id]: { ...existing, ...patch, updatedAt: Date.now() },
        },
      };
    }),

  deleteCutscene: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.cutscenes;
      return {
        cutscenes: rest,
        activeCutsceneId: state.activeCutsceneId === id ? null : state.activeCutsceneId,
      };
    }),

  addTrack: (cutsceneId, track) =>
    set((state) => {
      const cutscene = state.cutscenes[cutsceneId];
      if (!cutscene) return state;
      return {
        cutscenes: {
          ...state.cutscenes,
          [cutsceneId]: {
            ...cutscene,
            tracks: [...cutscene.tracks, track],
            updatedAt: Date.now(),
          },
        },
      };
    }),

  updateTrack: (cutsceneId, trackId, patch) =>
    set((state) => {
      const cutscene = state.cutscenes[cutsceneId];
      if (!cutscene) return state;
      return {
        cutscenes: {
          ...state.cutscenes,
          [cutsceneId]: {
            ...cutscene,
            tracks: cutscene.tracks.map((t) =>
              t.id === trackId ? { ...t, ...patch } : t,
            ),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  removeTrack: (cutsceneId, trackId) =>
    set((state) => {
      const cutscene = state.cutscenes[cutsceneId];
      if (!cutscene) return state;
      return {
        cutscenes: {
          ...state.cutscenes,
          [cutsceneId]: {
            ...cutscene,
            tracks: cutscene.tracks.filter((t) => t.id !== trackId),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  addKeyframe: (cutsceneId, trackId, keyframe) =>
    set((state) => {
      const cutscene = state.cutscenes[cutsceneId];
      if (!cutscene) return state;
      return {
        cutscenes: {
          ...state.cutscenes,
          [cutsceneId]: {
            ...cutscene,
            tracks: cutscene.tracks.map((t) =>
              t.id === trackId
                ? { ...t, keyframes: [...t.keyframes, keyframe].sort((a, b) => a.timestamp - b.timestamp) }
                : t,
            ),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  removeKeyframe: (cutsceneId, trackId, timestamp) =>
    set((state) => {
      const cutscene = state.cutscenes[cutsceneId];
      if (!cutscene) return state;
      return {
        cutscenes: {
          ...state.cutscenes,
          [cutsceneId]: {
            ...cutscene,
            tracks: cutscene.tracks.map((t) =>
              t.id === trackId
                ? { ...t, keyframes: t.keyframes.filter((k) => k.timestamp !== timestamp) }
                : t,
            ),
            updatedAt: Date.now(),
          },
        },
      };
    }),

  setActiveCutscene: (id) => set({ activeCutsceneId: id }),
  setPlaybackState: (state) => set({ playbackState: state }),
  setPlaybackTime: (time) => set({ playbackTime: time }),
}));
