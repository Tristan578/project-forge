import { describe, it, expect, beforeEach } from 'vitest';
import { useVoiceProfileStore, VOICE_PRESETS, type VoiceProfile } from '../voiceProfileStore';

function createProfile(speaker: string, overrides?: Partial<VoiceProfile>): VoiceProfile {
  return {
    speaker,
    voiceId: VOICE_PRESETS[0].id,
    voiceLabel: VOICE_PRESETS[0].label,
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0,
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('voiceProfileStore', () => {
  beforeEach(() => {
    useVoiceProfileStore.getState().clearProfiles();
  });

  describe('setProfile', () => {
    it('should add a new profile', () => {
      const profile = createProfile('Hero');
      useVoiceProfileStore.getState().setProfile(profile);

      const profiles = useVoiceProfileStore.getState().profiles;
      expect(profiles['Hero']).toEqual(profile);
    });

    it('should update an existing profile', () => {
      const original = createProfile('Villain', { stability: 0.3 });
      useVoiceProfileStore.getState().setProfile(original);

      const updated = createProfile('Villain', { stability: 0.9 });
      useVoiceProfileStore.getState().setProfile(updated);

      expect(useVoiceProfileStore.getState().profiles['Villain'].stability).toBe(0.9);
    });

    it('should not affect other profiles', () => {
      useVoiceProfileStore.getState().setProfile(createProfile('A'));
      useVoiceProfileStore.getState().setProfile(createProfile('B'));

      const profiles = useVoiceProfileStore.getState().profiles;
      expect(Object.keys(profiles)).toHaveLength(2);
      expect(profiles['A']).toBeDefined();
      expect(profiles['B']).toBeDefined();
    });
  });

  describe('removeProfile', () => {
    it('should remove a profile by speaker name', () => {
      useVoiceProfileStore.getState().setProfile(createProfile('Hero'));
      useVoiceProfileStore.getState().setProfile(createProfile('Villain'));

      useVoiceProfileStore.getState().removeProfile('Hero');

      const profiles = useVoiceProfileStore.getState().profiles;
      expect(profiles['Hero']).toBeUndefined();
      expect(profiles['Villain']).toBeDefined();
    });

    it('should be a no-op for non-existent profile', () => {
      useVoiceProfileStore.getState().setProfile(createProfile('Hero'));
      useVoiceProfileStore.getState().removeProfile('Nobody');

      expect(Object.keys(useVoiceProfileStore.getState().profiles)).toHaveLength(1);
    });
  });

  describe('getProfile', () => {
    it('should return the profile for a speaker', () => {
      const profile = createProfile('Hero');
      useVoiceProfileStore.getState().setProfile(profile);

      const result = useVoiceProfileStore.getState().getProfile('Hero');
      expect(result).toEqual(profile);
    });

    it('should return undefined for unknown speaker', () => {
      const result = useVoiceProfileStore.getState().getProfile('Unknown');
      expect(result).toBeUndefined();
    });
  });

  describe('loadProfiles', () => {
    it('should bulk-replace all profiles', () => {
      useVoiceProfileStore.getState().setProfile(createProfile('Old'));

      const newProfiles = {
        A: createProfile('A'),
        B: createProfile('B'),
      };
      useVoiceProfileStore.getState().loadProfiles(newProfiles);

      const profiles = useVoiceProfileStore.getState().profiles;
      expect(Object.keys(profiles)).toHaveLength(2);
      expect(profiles['Old']).toBeUndefined();
      expect(profiles['A']).toBeDefined();
    });
  });

  describe('clearProfiles', () => {
    it('should remove all profiles', () => {
      useVoiceProfileStore.getState().setProfile(createProfile('A'));
      useVoiceProfileStore.getState().setProfile(createProfile('B'));

      useVoiceProfileStore.getState().clearProfiles();

      expect(Object.keys(useVoiceProfileStore.getState().profiles)).toHaveLength(0);
    });
  });

  describe('VOICE_PRESETS', () => {
    it('should have at least 5 presets', () => {
      expect(VOICE_PRESETS.length).toBeGreaterThanOrEqual(5);
    });

    it('should have unique IDs', () => {
      const ids = VOICE_PRESETS.map((v) => v.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('should have labels and gender for each preset', () => {
      for (const preset of VOICE_PRESETS) {
        expect(preset.label.length).toBeGreaterThan(0);
        expect(preset.gender).toMatch(/^(Male|Female)$/);
        expect(preset.accent.length).toBeGreaterThan(0);
      }
    });
  });
});
