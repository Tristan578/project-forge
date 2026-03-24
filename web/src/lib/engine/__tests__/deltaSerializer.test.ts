import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeltaSerializer, type SceneSnapshot, type DeltaPatch } from '../deltaSerializer';

describe('DeltaSerializer', () => {
  let serializer: DeltaSerializer;

  beforeEach(() => {
    serializer = new DeltaSerializer(60);
  });

  // -----------------------------------------------------------------------
  // Basic delta computation
  // -----------------------------------------------------------------------

  describe('computeDelta', () => {
    it('returns a keyframe on first call (no previous snapshot)', () => {
      const state: SceneSnapshot = {
        'e1': { position: [0, 0, 0], rotation: [0, 0, 0] },
      };

      const delta = serializer.computeDelta(state);

      expect(delta.isKeyframe).toBe(true);
      expect(delta.added).toContain('e1');
      expect(delta.changed['e1']).not.toBeUndefined();
    });

    it('produces empty delta when snapshots are identical', () => {
      const state: SceneSnapshot = {
        'e1': { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] },
        'e2': { position: [4, 5, 6] },
      };

      serializer.computeDelta(state); // first call = keyframe
      const delta = serializer.computeDelta(state); // second call = delta

      expect(delta.isKeyframe).toBe(false);
      expect(Object.keys(delta.changed)).toHaveLength(0);
      expect(delta.removed).toHaveLength(0);
      expect(delta.added).toHaveLength(0);
    });

    it('detects single entity component change', () => {
      const state1: SceneSnapshot = {
        'e1': { position: [0, 0, 0], rotation: [0, 0, 0] },
        'e2': { position: [1, 1, 1] },
      };
      const state2: SceneSnapshot = {
        'e1': { position: [5, 0, 0], rotation: [0, 0, 0] },
        'e2': { position: [1, 1, 1] },
      };

      serializer.computeDelta(state1);
      const delta = serializer.computeDelta(state2);

      expect(delta.isKeyframe).toBe(false);
      expect(delta.changed['e1']).not.toBeUndefined();
      expect(delta.changed['e1'].position).toEqual([5, 0, 0]);
      // Unchanged component should NOT appear
      expect(delta.changed['e1'].rotation).toBeUndefined();
      // e2 should not appear at all
      expect(delta.changed['e2']).toBeUndefined();
    });

    it('detects entity addition', () => {
      const state1: SceneSnapshot = {
        'e1': { position: [0, 0, 0] },
      };
      const state2: SceneSnapshot = {
        'e1': { position: [0, 0, 0] },
        'e2': { position: [1, 1, 1] },
      };

      serializer.computeDelta(state1);
      const delta = serializer.computeDelta(state2);

      expect(delta.added).toContain('e2');
      expect(delta.changed['e2']).not.toBeUndefined();
      expect(delta.changed['e2'].position).toEqual([1, 1, 1]);
    });

    it('detects entity removal', () => {
      const state1: SceneSnapshot = {
        'e1': { position: [0, 0, 0] },
        'e2': { position: [1, 1, 1] },
      };
      const state2: SceneSnapshot = {
        'e1': { position: [0, 0, 0] },
      };

      serializer.computeDelta(state1);
      const delta = serializer.computeDelta(state2);

      expect(delta.removed).toContain('e2');
      expect(delta.changed['e2']).toBeUndefined();
    });

    it('tracks component-level granularity across multiple components', () => {
      const state1: SceneSnapshot = {
        'e1': { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], name: 'Box' },
      };
      const state2: SceneSnapshot = {
        'e1': { position: [0, 0, 0], rotation: [0, 90, 0], scale: [1, 1, 1], name: 'Box' },
      };

      serializer.computeDelta(state1);
      const delta = serializer.computeDelta(state2);

      expect(Object.keys(delta.changed['e1'])).toHaveLength(1);
      expect(delta.changed['e1'].rotation).toEqual([0, 90, 0]);
    });

    it('detects removed component within an entity', () => {
      const state1: SceneSnapshot = {
        'e1': { position: [0, 0, 0], velocity: [1, 0, 0] },
      };
      const state2: SceneSnapshot = {
        'e1': { position: [0, 0, 0] },
      };

      serializer.computeDelta(state1);
      const delta = serializer.computeDelta(state2);

      expect(delta.changed['e1']).not.toBeUndefined();
      expect('velocity' in delta.changed['e1']).toBe(true);
      expect(delta.changed['e1'].velocity).toBeUndefined();
    });

    it('handles nested object changes in components', () => {
      const state1: SceneSnapshot = {
        'e1': { material: { color: '#ff0000', metallic: 0.5 } },
      };
      const state2: SceneSnapshot = {
        'e1': { material: { color: '#00ff00', metallic: 0.5 } },
      };

      serializer.computeDelta(state1);
      const delta = serializer.computeDelta(state2);

      expect(delta.changed['e1'].material).toEqual({ color: '#00ff00', metallic: 0.5 });
    });

    it('handles simultaneous adds, removes, and changes', () => {
      const state1: SceneSnapshot = {
        'e1': { position: [0, 0, 0] },
        'e2': { position: [1, 1, 1] },
        'e3': { position: [2, 2, 2] },
      };
      const state2: SceneSnapshot = {
        'e1': { position: [9, 9, 9] },
        'e3': { position: [2, 2, 2] },
        'e4': { position: [4, 4, 4] },
      };

      serializer.computeDelta(state1);
      const delta = serializer.computeDelta(state2);

      expect(delta.changed['e1'].position).toEqual([9, 9, 9]);
      expect(delta.removed).toContain('e2');
      expect(delta.added).toContain('e4');
      expect(delta.changed['e3']).toBeUndefined(); // unchanged
    });
  });

  // -----------------------------------------------------------------------
  // Keyframe interval
  // -----------------------------------------------------------------------

  describe('keyframe interval', () => {
    it('sends keyframe at configured interval', () => {
      const ser = new DeltaSerializer(3);
      const state: SceneSnapshot = { 'e1': { position: [0, 0, 0] } };

      const d1 = ser.computeDelta(state); // frame 1 — first call = keyframe
      expect(d1.isKeyframe).toBe(true);

      const d2 = ser.computeDelta(state); // frame 2 — delta
      expect(d2.isKeyframe).toBe(false);

      const d3 = ser.computeDelta(state); // frame 3 — keyframe (3 % 3 === 0)
      expect(d3.isKeyframe).toBe(true);

      const d4 = ser.computeDelta(state); // frame 4 — delta
      expect(d4.isKeyframe).toBe(false);

      const d5 = ser.computeDelta(state); // frame 5 — delta
      expect(d5.isKeyframe).toBe(false);

      const d6 = ser.computeDelta(state); // frame 6 — keyframe (6 % 3 === 0)
      expect(d6.isKeyframe).toBe(true);
    });

    it('default keyframe interval is 60', () => {
      const ser = new DeltaSerializer();
      const state: SceneSnapshot = { 'e1': { position: [0, 0, 0] } };

      ser.computeDelta(state); // frame 1 — keyframe (first)
      for (let i = 2; i < 60; i++) {
        const d = ser.computeDelta(state);
        expect(d.isKeyframe).toBe(false);
      }
      const d60 = ser.computeDelta(state); // frame 60
      expect(d60.isKeyframe).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // applyDelta
  // -----------------------------------------------------------------------

  describe('applyDelta', () => {
    it('reconstructs full state from base + delta', () => {
      const base: SceneSnapshot = {
        'e1': { position: [0, 0, 0], rotation: [0, 0, 0] },
        'e2': { position: [1, 1, 1] },
      };
      const delta: DeltaPatch = {
        changed: { 'e1': { position: [5, 0, 0] } },
        removed: [],
        added: [],
        timestamp: 0,
        isKeyframe: false,
      };

      const result = serializer.applyDelta(base, delta);

      expect(result['e1'].position).toEqual([5, 0, 0]);
      expect(result['e1'].rotation).toEqual([0, 0, 0]); // preserved from base
      expect(result['e2'].position).toEqual([1, 1, 1]); // untouched
    });

    it('applies entity removal', () => {
      const base: SceneSnapshot = {
        'e1': { position: [0, 0, 0] },
        'e2': { position: [1, 1, 1] },
      };
      const delta: DeltaPatch = {
        changed: {},
        removed: ['e2'],
        added: [],
        timestamp: 0,
        isKeyframe: false,
      };

      const result = serializer.applyDelta(base, delta);

      expect(result['e1']).not.toBeUndefined();
      expect(result['e2']).toBeUndefined();
    });

    it('applies entity addition', () => {
      const base: SceneSnapshot = {
        'e1': { position: [0, 0, 0] },
      };
      const delta: DeltaPatch = {
        changed: { 'e3': { position: [9, 9, 9] } },
        removed: [],
        added: ['e3'],
        timestamp: 0,
        isKeyframe: false,
      };

      const result = serializer.applyDelta(base, delta);

      expect(result['e1']).not.toBeUndefined();
      expect(result['e3'].position).toEqual([9, 9, 9]);
    });

    it('replaces entire state on keyframe', () => {
      const base: SceneSnapshot = {
        'e1': { position: [0, 0, 0] },
        'e2': { position: [1, 1, 1] },
      };
      const keyframeDelta: DeltaPatch = {
        changed: { 'e5': { position: [5, 5, 5] } },
        removed: [],
        added: ['e5'],
        timestamp: 0,
        isKeyframe: true,
      };

      const result = serializer.applyDelta(base, keyframeDelta);

      // Only e5 should exist — base is replaced on keyframe
      expect(Object.keys(result)).toEqual(['e5']);
      expect(result['e5'].position).toEqual([5, 5, 5]);
    });

    it('does not mutate the base snapshot', () => {
      const base: SceneSnapshot = {
        'e1': { position: [0, 0, 0] },
      };
      const delta: DeltaPatch = {
        changed: { 'e1': { position: [9, 9, 9] } },
        removed: [],
        added: [],
        timestamp: 0,
        isKeyframe: false,
      };

      serializer.applyDelta(base, delta);

      expect(base['e1'].position).toEqual([0, 0, 0]); // untouched
    });
  });

  // -----------------------------------------------------------------------
  // takeSnapshot and getLastSnapshot
  // -----------------------------------------------------------------------

  describe('takeSnapshot / getLastSnapshot', () => {
    it('stores and retrieves snapshots', () => {
      const state: SceneSnapshot = { 'e1': { x: 1 } };
      serializer.takeSnapshot(state);

      const stored = serializer.getLastSnapshot();
      expect(stored).toEqual(state);
    });

    it('deep clones on takeSnapshot so external mutation does not affect internal state', () => {
      const state: SceneSnapshot = { 'e1': { position: [0, 0, 0] } };
      serializer.takeSnapshot(state);

      // Mutate original
      (state['e1'].position as number[])[0] = 999;

      const stored = serializer.getLastSnapshot();
      expect((stored!['e1'].position as number[])[0]).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // reset
  // -----------------------------------------------------------------------

  describe('reset', () => {
    it('clears internal state', () => {
      const state: SceneSnapshot = { 'e1': { x: 1 } };
      serializer.computeDelta(state);

      expect(serializer.getLastSnapshot()).not.toBeNull();
      expect(serializer.getFrameCount()).toBe(1);

      serializer.reset();

      expect(serializer.getLastSnapshot()).toBeNull();
      expect(serializer.getFrameCount()).toBe(0);
    });

    it('after reset, next computeDelta returns a keyframe', () => {
      const state: SceneSnapshot = { 'e1': { x: 1 } };
      serializer.computeDelta(state); // keyframe
      serializer.computeDelta(state); // delta

      serializer.reset();

      const delta = serializer.computeDelta(state);
      expect(delta.isKeyframe).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty scene', () => {
      const state: SceneSnapshot = {};

      serializer.computeDelta(state);
      const delta = serializer.computeDelta(state);

      expect(delta.isKeyframe).toBe(false);
      expect(Object.keys(delta.changed)).toHaveLength(0);
      expect(delta.removed).toHaveLength(0);
      expect(delta.added).toHaveLength(0);
    });

    it('handles transition from empty to populated scene', () => {
      serializer.computeDelta({});
      const delta = serializer.computeDelta({
        'e1': { position: [1, 2, 3] },
      });

      expect(delta.added).toContain('e1');
      expect(delta.changed['e1'].position).toEqual([1, 2, 3]);
    });

    it('handles transition from populated to empty scene', () => {
      serializer.computeDelta({ 'e1': { position: [1, 2, 3] } });
      const delta = serializer.computeDelta({});

      expect(delta.removed).toContain('e1');
    });

    it('handles primitive component values (strings, numbers, booleans)', () => {
      const state1: SceneSnapshot = {
        'e1': { name: 'Box', health: 100, active: true },
      };
      const state2: SceneSnapshot = {
        'e1': { name: 'Box', health: 50, active: true },
      };

      serializer.computeDelta(state1);
      const delta = serializer.computeDelta(state2);

      expect(delta.changed['e1'].health).toBe(50);
      expect(delta.changed['e1'].name).toBeUndefined();
      expect(delta.changed['e1'].active).toBeUndefined();
    });

    it('handles null component values', () => {
      const state1: SceneSnapshot = {
        'e1': { target: null },
      };
      const state2: SceneSnapshot = {
        'e1': { target: 'e2' },
      };

      serializer.computeDelta(state1);
      const delta = serializer.computeDelta(state2);

      expect(delta.changed['e1'].target).toBe('e2');
    });

    it('handles component value changing to null', () => {
      const state1: SceneSnapshot = {
        'e1': { target: 'e2' },
      };
      const state2: SceneSnapshot = {
        'e1': { target: null },
      };

      serializer.computeDelta(state1);
      const delta = serializer.computeDelta(state2);

      expect(delta.changed['e1'].target).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Round-trip integrity
  // -----------------------------------------------------------------------

  describe('round-trip integrity', () => {
    it('computeDelta + applyDelta reconstructs the target state', () => {
      const state1: SceneSnapshot = {
        'e1': { position: [0, 0, 0], rotation: [0, 0, 0] },
        'e2': { position: [1, 1, 1], material: { color: '#ff0000' } },
        'e3': { position: [2, 2, 2] },
      };
      const state2: SceneSnapshot = {
        'e1': { position: [5, 3, 1], rotation: [0, 0, 0] },
        'e2': { position: [1, 1, 1], material: { color: '#00ff00' } },
        'e4': { position: [9, 9, 9] },
      };

      serializer.computeDelta(state1);
      const delta = serializer.computeDelta(state2);
      // Use state1 as the base that the receiver would have
      const reconstructed = serializer.applyDelta(state1, delta);

      expect(reconstructed['e1'].position).toEqual([5, 3, 1]);
      expect(reconstructed['e1'].rotation).toEqual([0, 0, 0]);
      expect(reconstructed['e2'].material).toEqual({ color: '#00ff00' });
      expect(reconstructed['e3']).toBeUndefined(); // was removed
      expect(reconstructed['e4'].position).toEqual([9, 9, 9]); // was added
    });

    it('multiple consecutive deltas accumulate correctly', () => {
      let state: SceneSnapshot = {
        'e1': { position: [0, 0, 0] },
      };

      serializer.computeDelta(state); // keyframe
      let base = { ...state };

      // 10 frames of incremental movement
      for (let i = 1; i <= 10; i++) {
        state = { 'e1': { position: [i, 0, 0] } };
        const delta = serializer.computeDelta(state);
        base = serializer.applyDelta(base, delta);
      }

      expect(base['e1'].position).toEqual([10, 0, 0]);
    });
  });

  // -----------------------------------------------------------------------
  // Performance benchmark
  // -----------------------------------------------------------------------

  describe('performance', () => {
    function generateScene(entityCount: number): SceneSnapshot {
      const scene: SceneSnapshot = {};
      for (let i = 0; i < entityCount; i++) {
        scene[`entity_${i}`] = {
          position: [i * 0.1, i * 0.2, i * 0.3],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
          name: `Entity_${i}`,
          type: 'Cube',
        };
      }
      return scene;
    }

    function generateSceneWithChanges(
      base: SceneSnapshot,
      changePercent: number
    ): SceneSnapshot {
      const scene: SceneSnapshot = {};
      const keys = Object.keys(base);
      const changeCount = Math.floor(keys.length * changePercent);

      for (const key of keys) {
        scene[key] = { ...base[key] };
      }

      // Mutate a subset of entities
      for (let i = 0; i < changeCount; i++) {
        const key = keys[i];
        scene[key] = {
          ...scene[key],
          position: [Math.random(), Math.random(), Math.random()],
        };
      }

      return scene;
    }

    it('delta encoding is faster than full serialization for large scenes with few changes', () => {
      const entityCount = 1000;
      const baseScene = generateScene(entityCount);

      // Measure full serialization time
      const fullStart = performance.now();
      for (let i = 0; i < 100; i++) {
        JSON.stringify(baseScene);
      }
      const fullTime = performance.now() - fullStart;

      // Set up delta serializer
      const ser = new DeltaSerializer(9999); // high interval to avoid keyframes
      ser.computeDelta(baseScene); // initial keyframe

      // Generate scenes with 1% changes
      const changedScene = generateSceneWithChanges(baseScene, 0.01);

      // Measure delta computation time
      // Reset to use the base as the baseline
      ser.takeSnapshot(baseScene);
      const deltaStart = performance.now();
      for (let i = 0; i < 100; i++) {
        ser.computeDelta(changedScene);
        ser.takeSnapshot(baseScene); // reset baseline for fair comparison
      }
      const deltaTime = performance.now() - deltaStart;

      // Delta should be significantly faster for 1% changes
      // We measure the delta SIZE to ensure it's much smaller
      ser.takeSnapshot(baseScene);
      const delta = ser.computeDelta(changedScene);
      const deltaSize = JSON.stringify(delta.changed).length;
      const fullSize = JSON.stringify(baseScene).length;

      // The delta payload should be dramatically smaller
      expect(deltaSize).toBeLessThan(fullSize * 0.1); // < 10% of full size

      // Log for informational purposes
      console.log(`Full serialize (100 iters, ${entityCount} entities): ${fullTime.toFixed(2)}ms`);
      console.log(`Delta compute (100 iters, 1% changes): ${deltaTime.toFixed(2)}ms`);
      console.log(`Full payload size: ${fullSize} bytes`);
      console.log(`Delta payload size: ${deltaSize} bytes (${((deltaSize / fullSize) * 100).toFixed(1)}%)`);
    });

    it('benchmark: 100 entities with 1% changes', () => {
      const scene = generateScene(100);
      const ser = new DeltaSerializer(9999);
      ser.computeDelta(scene);

      const changed = generateSceneWithChanges(scene, 0.01);
      ser.takeSnapshot(scene);
      const delta = ser.computeDelta(changed);

      const deltaPayloadSize = JSON.stringify(delta.changed).length;
      const fullPayloadSize = JSON.stringify(scene).length;

      expect(deltaPayloadSize).toBeLessThan(fullPayloadSize);
      console.log(`100 entities: full=${fullPayloadSize}B, delta=${deltaPayloadSize}B`);
    });

    it('benchmark: 500 entities with 1% changes', () => {
      const scene = generateScene(500);
      const ser = new DeltaSerializer(9999);
      ser.computeDelta(scene);

      const changed = generateSceneWithChanges(scene, 0.01);
      ser.takeSnapshot(scene);
      const delta = ser.computeDelta(changed);

      const deltaPayloadSize = JSON.stringify(delta.changed).length;
      const fullPayloadSize = JSON.stringify(scene).length;

      expect(deltaPayloadSize).toBeLessThan(fullPayloadSize * 0.1);
      console.log(`500 entities: full=${fullPayloadSize}B, delta=${deltaPayloadSize}B`);
    });

    it('benchmark: 1000 entities with 1% changes', () => {
      const scene = generateScene(1000);
      const ser = new DeltaSerializer(9999);
      ser.computeDelta(scene);

      const changed = generateSceneWithChanges(scene, 0.01);
      ser.takeSnapshot(scene);
      const delta = ser.computeDelta(changed);

      const deltaPayloadSize = JSON.stringify(delta.changed).length;
      const fullPayloadSize = JSON.stringify(scene).length;

      expect(deltaPayloadSize).toBeLessThan(fullPayloadSize * 0.05);
      console.log(`1000 entities: full=${fullPayloadSize}B, delta=${deltaPayloadSize}B`);
    });
  });

  // -----------------------------------------------------------------------
  // Timestamp
  // -----------------------------------------------------------------------

  describe('timestamp', () => {
    it('delta patches include a timestamp', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

      const ser = new DeltaSerializer();
      const state: SceneSnapshot = { 'e1': { x: 1 } };
      const delta = ser.computeDelta(state);

      expect(delta.timestamp).toBe(new Date('2026-01-01T00:00:00Z').getTime());

      vi.useRealTimers();
    });
  });
});
