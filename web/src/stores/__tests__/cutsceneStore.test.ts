import { describe, it, expect, beforeEach } from 'vitest';
import { useCutsceneStore } from '../cutsceneStore';
import type { Cutscene, CutsceneTrack, CutsceneKeyframe } from '../cutsceneStore';

function makeKeyframe(timestamp: number): CutsceneKeyframe {
  return { timestamp, duration: 1, easing: 'linear', payload: {} };
}

function makeTrack(id: string, type: CutsceneTrack['type'] = 'wait'): CutsceneTrack {
  return { id, type, entityId: null, keyframes: [], muted: false };
}

function makeCutscene(id: string): Cutscene {
  return {
    id,
    name: `Cutscene ${id}`,
    duration: 10,
    tracks: [],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

beforeEach(() => {
  useCutsceneStore.setState({
    cutscenes: {},
    activeCutsceneId: null,
    playbackState: 'idle',
    playbackTime: 0,
  });
});

describe('cutsceneStore', () => {
  describe('initial state', () => {
    it('starts with empty cutscenes', () => {
      expect(useCutsceneStore.getState().cutscenes).toEqual({});
    });

    it('starts with null activeCutsceneId', () => {
      expect(useCutsceneStore.getState().activeCutsceneId).toBeNull();
    });

    it('starts with idle playback state', () => {
      expect(useCutsceneStore.getState().playbackState).toBe('idle');
    });

    it('starts with zero playback time', () => {
      expect(useCutsceneStore.getState().playbackTime).toBe(0);
    });
  });

  describe('addCutscene', () => {
    it('stores the cutscene by id', () => {
      const cs = makeCutscene('cs1');
      useCutsceneStore.getState().addCutscene(cs);
      expect(useCutsceneStore.getState().cutscenes['cs1']).toEqual(cs);
    });

    it('stores multiple cutscenes independently', () => {
      useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
      useCutsceneStore.getState().addCutscene(makeCutscene('cs2'));
      const { cutscenes } = useCutsceneStore.getState();
      expect(Object.keys(cutscenes)).toHaveLength(2);
    });
  });

  describe('updateCutscene', () => {
    it('patches name', () => {
      useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
      useCutsceneStore.getState().updateCutscene('cs1', { name: 'Updated' });
      expect(useCutsceneStore.getState().cutscenes['cs1'].name).toBe('Updated');
    });

    it('updates updatedAt', () => {
      useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
      const before = useCutsceneStore.getState().cutscenes['cs1'].updatedAt;
      useCutsceneStore.getState().updateCutscene('cs1', { name: 'New' });
      const after = useCutsceneStore.getState().cutscenes['cs1'].updatedAt;
      expect(after).toBeGreaterThanOrEqual(before);
    });

    it('is a no-op for unknown id', () => {
      const before = { ...useCutsceneStore.getState().cutscenes };
      useCutsceneStore.getState().updateCutscene('unknown', { name: 'Ghost' });
      expect(useCutsceneStore.getState().cutscenes).toEqual(before);
    });
  });

  describe('deleteCutscene', () => {
    it('removes the cutscene', () => {
      useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
      useCutsceneStore.getState().deleteCutscene('cs1');
      expect(useCutsceneStore.getState().cutscenes['cs1']).toBeUndefined();
    });

    it('clears activeCutsceneId when the active one is deleted', () => {
      useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
      useCutsceneStore.getState().setActiveCutscene('cs1');
      useCutsceneStore.getState().deleteCutscene('cs1');
      expect(useCutsceneStore.getState().activeCutsceneId).toBeNull();
    });

    it('preserves activeCutsceneId when a different cutscene is deleted', () => {
      useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
      useCutsceneStore.getState().addCutscene(makeCutscene('cs2'));
      useCutsceneStore.getState().setActiveCutscene('cs1');
      useCutsceneStore.getState().deleteCutscene('cs2');
      expect(useCutsceneStore.getState().activeCutsceneId).toBe('cs1');
    });
  });

  describe('addTrack', () => {
    it('appends the track to the cutscene', () => {
      useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
      const track = makeTrack('t1', 'camera');
      useCutsceneStore.getState().addTrack('cs1', track);
      expect(useCutsceneStore.getState().cutscenes['cs1'].tracks).toHaveLength(1);
      expect(useCutsceneStore.getState().cutscenes['cs1'].tracks[0]).toEqual(track);
    });

    it('is a no-op for unknown cutscene id', () => {
      useCutsceneStore.getState().addTrack('missing', makeTrack('t1'));
      // should not throw; cutscenes stays empty
      expect(useCutsceneStore.getState().cutscenes).toEqual({});
    });
  });

  describe('updateTrack', () => {
    it('patches the track', () => {
      useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
      useCutsceneStore.getState().addTrack('cs1', makeTrack('t1', 'camera'));
      useCutsceneStore.getState().updateTrack('cs1', 't1', { muted: true });
      expect(useCutsceneStore.getState().cutscenes['cs1'].tracks[0].muted).toBe(true);
    });
  });

  describe('removeTrack', () => {
    it('removes the track by id', () => {
      useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
      useCutsceneStore.getState().addTrack('cs1', makeTrack('t1'));
      useCutsceneStore.getState().addTrack('cs1', makeTrack('t2'));
      useCutsceneStore.getState().removeTrack('cs1', 't1');
      const tracks = useCutsceneStore.getState().cutscenes['cs1'].tracks;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].id).toBe('t2');
    });
  });

  describe('addKeyframe', () => {
    it('appends a keyframe to the track', () => {
      useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
      useCutsceneStore.getState().addTrack('cs1', makeTrack('t1'));
      useCutsceneStore.getState().addKeyframe('cs1', 't1', makeKeyframe(2));
      expect(useCutsceneStore.getState().cutscenes['cs1'].tracks[0].keyframes).toHaveLength(1);
    });

    it('maintains ascending timestamp order', () => {
      useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
      useCutsceneStore.getState().addTrack('cs1', makeTrack('t1'));
      useCutsceneStore.getState().addKeyframe('cs1', 't1', makeKeyframe(5));
      useCutsceneStore.getState().addKeyframe('cs1', 't1', makeKeyframe(1));
      useCutsceneStore.getState().addKeyframe('cs1', 't1', makeKeyframe(3));
      const kfs = useCutsceneStore.getState().cutscenes['cs1'].tracks[0].keyframes;
      expect(kfs.map((k) => k.timestamp)).toEqual([1, 3, 5]);
    });
  });

  describe('removeKeyframe', () => {
    it('removes the keyframe at the given timestamp', () => {
      useCutsceneStore.getState().addCutscene(makeCutscene('cs1'));
      useCutsceneStore.getState().addTrack('cs1', makeTrack('t1'));
      useCutsceneStore.getState().addKeyframe('cs1', 't1', makeKeyframe(2));
      useCutsceneStore.getState().addKeyframe('cs1', 't1', makeKeyframe(5));
      useCutsceneStore.getState().removeKeyframe('cs1', 't1', 2);
      const kfs = useCutsceneStore.getState().cutscenes['cs1'].tracks[0].keyframes;
      expect(kfs).toHaveLength(1);
      expect(kfs[0].timestamp).toBe(5);
    });
  });

  describe('playback controls', () => {
    it('setActiveCutscene sets the id', () => {
      useCutsceneStore.getState().setActiveCutscene('cs1');
      expect(useCutsceneStore.getState().activeCutsceneId).toBe('cs1');
    });

    it('setActiveCutscene accepts null', () => {
      useCutsceneStore.getState().setActiveCutscene('cs1');
      useCutsceneStore.getState().setActiveCutscene(null);
      expect(useCutsceneStore.getState().activeCutsceneId).toBeNull();
    });

    it('setPlaybackState updates state', () => {
      useCutsceneStore.getState().setPlaybackState('playing');
      expect(useCutsceneStore.getState().playbackState).toBe('playing');
    });

    it('setPlaybackTime updates time', () => {
      useCutsceneStore.getState().setPlaybackTime(4.5);
      expect(useCutsceneStore.getState().playbackTime).toBe(4.5);
    });
  });
});
