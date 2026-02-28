/**
 * Voice profile store — manages per-character voice settings for consistent
 * dialogue voice generation. Profiles map speaker names to ElevenLabs voice
 * parameters. Persisted to localStorage per-project.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'forge_voice_profiles';

export interface VoiceProfile {
  /** Speaker/character name (unique per project) */
  speaker: string;
  /** ElevenLabs voice ID */
  voiceId: string;
  /** Display label for the voice (e.g. "George", "Rachel") */
  voiceLabel: string;
  /** Voice stability (0-1, higher = more consistent) */
  stability: number;
  /** Similarity boost (0-1, higher = closer to original voice) */
  similarityBoost: number;
  /** Voice style intensity (0-1) */
  style: number;
  /** When this profile was last updated */
  updatedAt: number;
}

/** Curated list of ElevenLabs voices for quick selection */
export const VOICE_PRESETS: { id: string; label: string; gender: string; accent: string }[] = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George', gender: 'Male', accent: 'British' },
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel', gender: 'Female', accent: 'American' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella', gender: 'Female', accent: 'American' },
  { id: 'ErXwobaYiN019PkySvjV', label: 'Antoni', gender: 'Male', accent: 'American' },
  { id: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli', gender: 'Female', accent: 'American' },
  { id: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh', gender: 'Male', accent: 'American' },
  { id: 'VR6AewLTigWG4xSOukaG', label: 'Arnold', gender: 'Male', accent: 'American' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam', gender: 'Male', accent: 'American' },
  { id: 'yoZ06aMxZJJ28mfd3POQ', label: 'Sam', gender: 'Male', accent: 'American' },
  { id: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi', gender: 'Female', accent: 'American' },
];

interface VoiceProfileState {
  /** Speaker name → VoiceProfile */
  profiles: Record<string, VoiceProfile>;

  /** Add or update a voice profile */
  setProfile: (profile: VoiceProfile) => void;
  /** Remove a voice profile by speaker name */
  removeProfile: (speaker: string) => void;
  /** Get profile for a speaker (returns undefined if not set) */
  getProfile: (speaker: string) => VoiceProfile | undefined;
  /** Bulk-load profiles (e.g. from project import) */
  loadProfiles: (profiles: Record<string, VoiceProfile>) => void;
  /** Clear all profiles */
  clearProfiles: () => void;
}

function loadFromStorage(): Record<string, VoiceProfile> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore parse errors
  }
  return {};
}

function saveToStorage(profiles: Record<string, VoiceProfile>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // Ignore storage errors
  }
}

export const useVoiceProfileStore = create<VoiceProfileState>((set, get) => ({
  profiles: loadFromStorage(),

  setProfile: (profile) => {
    set((state) => {
      const next = { ...state.profiles, [profile.speaker]: profile };
      saveToStorage(next);
      return { profiles: next };
    });
  },

  removeProfile: (speaker) => {
    set((state) => {
      const { [speaker]: _, ...rest } = state.profiles;
      saveToStorage(rest);
      return { profiles: rest };
    });
  },

  getProfile: (speaker) => {
    return get().profiles[speaker];
  },

  loadProfiles: (profiles) => {
    set({ profiles });
    saveToStorage(profiles);
  },

  clearProfiles: () => {
    set({ profiles: {} });
    saveToStorage({});
  },
}));
