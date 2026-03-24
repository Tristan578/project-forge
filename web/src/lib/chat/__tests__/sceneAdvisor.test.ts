import { describe, it, expect } from 'vitest';
import {
  analyzeScene,
  type SceneAnalysisInput,
  type SceneAdvice,
} from '@/lib/chat/sceneAdvisor';

function makeInput(overrides: Partial<SceneAnalysisInput> = {}): SceneAnalysisInput {
  return {
    sceneGraph: { rootIds: [], nodes: {} },
    transforms: {},
    materials: {},
    lights: {},
    physics: {},
    physicsEnabled: {},
    ambientLight: { color: [1, 1, 1], brightness: 0.3 },
    environment: { fogEnabled: false },
    entityCount: 0,
    ...overrides,
  };
}

function findAdvice(advice: SceneAdvice[], id: string): SceneAdvice | undefined {
  return advice.find((a) => a.id === id);
}

describe('analyzeScene', () => {
  describe('empty scene', () => {
    it('warns about empty scene', () => {
      const advice = analyzeScene(makeInput());
      expect(findAdvice(advice, 'empty-scene')).toMatchObject({ id: 'empty-scene', severity: 'info' });
    });
  });

  describe('no lighting', () => {
    it('warns when no lights and low ambient', () => {
      const advice = analyzeScene(makeInput({
        entityCount: 5,
        ambientLight: { color: [1, 1, 1], brightness: 0.01 },
      }));
      expect(findAdvice(advice, 'no-lighting')).toMatchObject({ id: 'no-lighting', severity: 'warning' });
    });

    it('does not warn when ambient is sufficient', () => {
      const advice = analyzeScene(makeInput({
        entityCount: 5,
        ambientLight: { color: [1, 1, 1], brightness: 0.5 },
      }));
      expect(findAdvice(advice, 'no-lighting')).toBeUndefined();
    });

    it('does not warn when lights exist', () => {
      const advice = analyzeScene(makeInput({
        entityCount: 5,
        lights: { light1: { lightType: 'directional', color: [1, 1, 1], intensity: 1000, shadowsEnabled: true } },
      }));
      expect(findAdvice(advice, 'no-lighting')).toBeUndefined();
    });

    it('does not warn on empty scene', () => {
      const advice = analyzeScene(makeInput({ entityCount: 0, ambientLight: { color: [1, 1, 1], brightness: 0 } }));
      expect(findAdvice(advice, 'no-lighting')).toBeUndefined();
    });
  });

  describe('overlapping entities', () => {
    it('detects entities at same position', () => {
      const advice = analyzeScene(makeInput({
        entityCount: 2,
        transforms: {
          e1: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          e2: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
      }));
      expect(findAdvice(advice, 'overlapping-entities')).toMatchObject({ id: 'overlapping-entities' });
    });

    it('does not flag non-overlapping entities', () => {
      const advice = analyzeScene(makeInput({
        entityCount: 2,
        transforms: {
          e1: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
          e2: { position: [5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
      }));
      expect(findAdvice(advice, 'overlapping-entities')).toBeUndefined();
    });
  });

  describe('physics without ground', () => {
    it('warns when dynamic bodies exist without fixed body', () => {
      const advice = analyzeScene(makeInput({
        entityCount: 1,
        physics: { e1: { bodyType: 'dynamic', colliderShape: 'cuboid' } },
        physicsEnabled: { e1: true },
      }));
      expect(findAdvice(advice, 'no-physics-ground')).toMatchObject({ id: 'no-physics-ground' });
    });

    it('does not warn when fixed body exists', () => {
      const advice = analyzeScene(makeInput({
        entityCount: 2,
        physics: {
          e1: { bodyType: 'dynamic', colliderShape: 'cuboid' },
          e2: { bodyType: 'fixed', colliderShape: 'cuboid' },
        },
        physicsEnabled: { e1: true, e2: true },
      }));
      expect(findAdvice(advice, 'no-physics-ground')).toBeUndefined();
    });

    it('does not warn when physics is disabled', () => {
      const advice = analyzeScene(makeInput({
        entityCount: 1,
        physics: { e1: { bodyType: 'dynamic', colliderShape: 'cuboid' } },
        physicsEnabled: { e1: false },
      }));
      expect(findAdvice(advice, 'no-physics-ground')).toBeUndefined();
    });
  });

  describe('entity count', () => {
    it('warns at >200 entities', () => {
      const advice = analyzeScene(makeInput({ entityCount: 250 }));
      expect(findAdvice(advice, 'high-entity-count')).toMatchObject({ id: 'high-entity-count', severity: 'warning' });
    });

    it('info at >100 entities', () => {
      const advice = analyzeScene(makeInput({ entityCount: 150 }));
      expect(findAdvice(advice, 'moderate-entity-count')).toMatchObject({ id: 'moderate-entity-count', severity: 'info' });
    });

    it('no warning at <=100 entities', () => {
      const advice = analyzeScene(makeInput({ entityCount: 50 }));
      expect(findAdvice(advice, 'high-entity-count')).toBeUndefined();
      expect(findAdvice(advice, 'moderate-entity-count')).toBeUndefined();
    });
  });

  describe('default materials', () => {
    it('flags when >3 entities have default material', () => {
      const materials: Record<string, { baseColor: [number, number, number]; metallic: number; perceptualRoughness: number }> = {};
      for (let i = 0; i < 5; i++) {
        materials[`e${i}`] = { baseColor: [1, 1, 1], metallic: 0, perceptualRoughness: 0.5 };
      }
      const advice = analyzeScene(makeInput({ entityCount: 5, materials }));
      expect(findAdvice(advice, 'default-materials')).not.toBeUndefined();
    });

    it('does not flag when materials are customized', () => {
      const materials: Record<string, { baseColor: [number, number, number]; metallic: number; perceptualRoughness: number }> = {
        e1: { baseColor: [1, 0, 0], metallic: 0.8, perceptualRoughness: 0.2 },
        e2: { baseColor: [0, 1, 0], metallic: 0.3, perceptualRoughness: 0.7 },
      };
      const advice = analyzeScene(makeInput({ entityCount: 2, materials }));
      expect(findAdvice(advice, 'default-materials')).toBeUndefined();
    });
  });

  describe('no shadows', () => {
    it('flags when lights exist but none have shadows', () => {
      const advice = analyzeScene(makeInput({
        entityCount: 3,
        lights: {
          l1: { lightType: 'directional', color: [1, 1, 1], intensity: 1000, shadowsEnabled: false },
        },
      }));
      expect(findAdvice(advice, 'no-shadows')).not.toBeUndefined();
    });

    it('does not flag when at least one light has shadows', () => {
      const advice = analyzeScene(makeInput({
        entityCount: 3,
        lights: {
          l1: { lightType: 'directional', color: [1, 1, 1], intensity: 1000, shadowsEnabled: true },
        },
      }));
      expect(findAdvice(advice, 'no-shadows')).toBeUndefined();
    });
  });

  describe('too many shadow lights', () => {
    it('warns with >4 shadow-casting lights', () => {
      const lights: Record<string, { lightType: string; color: [number, number, number]; intensity: number; shadowsEnabled: boolean }> = {};
      for (let i = 0; i < 6; i++) {
        lights[`l${i}`] = { lightType: 'point', color: [1, 1, 1], intensity: 500, shadowsEnabled: true };
      }
      const advice = analyzeScene(makeInput({ entityCount: 6, lights }));
      expect(findAdvice(advice, 'too-many-shadow-lights')).not.toBeUndefined();
    });
  });

  describe('floating entities', () => {
    it('flags entities high above ground (excluding lights)', () => {
      const transforms: Record<string, { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }> = {
        e1: { position: [0, 25, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        e2: { position: [3, 30, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        e3: { position: [6, 22, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      };
      const advice = analyzeScene(makeInput({ entityCount: 3, transforms }));
      expect(findAdvice(advice, 'floating-entities')).not.toBeUndefined();
    });

    it('does not flag lights positioned high', () => {
      const transforms: Record<string, { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }> = {
        l1: { position: [0, 30, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        l2: { position: [3, 25, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        l3: { position: [6, 22, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      };
      const advice = analyzeScene(makeInput({
        entityCount: 3,
        transforms,
        lights: {
          l1: { lightType: 'point', color: [1, 1, 1], intensity: 500, shadowsEnabled: false },
          l2: { lightType: 'point', color: [1, 1, 1], intensity: 500, shadowsEnabled: false },
          l3: { lightType: 'directional', color: [1, 1, 1], intensity: 500, shadowsEnabled: false },
        },
      }));
      expect(findAdvice(advice, 'floating-entities')).toBeUndefined();
    });
  });

  describe('dark scene', () => {
    it('flags low-intensity lights with low ambient', () => {
      const advice = analyzeScene(makeInput({
        entityCount: 3,
        lights: { l1: { lightType: 'point', color: [1, 1, 1], intensity: 100, shadowsEnabled: false } },
        ambientLight: { color: [1, 1, 1], brightness: 0.01 },
      }));
      expect(findAdvice(advice, 'dark-scene')).not.toBeUndefined();
    });
  });

  describe('return value', () => {
    it('returns array of advice items with required fields', () => {
      const advice = analyzeScene(makeInput());
      expect(Array.isArray(advice)).toBe(true);
      for (const item of advice) {
        expect(item.id).not.toBeNull();
        expect(item.severity).not.toBeNull();
        expect(item.category).not.toBeNull();
        expect(item.title).not.toBeNull();
        expect(item.description).not.toBeNull();
      }
    });
  });
});
