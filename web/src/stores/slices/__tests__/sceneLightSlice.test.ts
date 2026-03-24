/**
 * Tests for sceneLightSlice — scene-wide light state derived from the scene graph.
 */

import { describe, it, expect } from 'vitest';
import { createSliceStore } from './sliceTestTemplate';
import {
  createSceneLightSlice,
  type SceneLightSlice,
  hasSceneLights,
  describeSceneLights,
} from '../sceneLightSlice';
import type { SceneGraph, SceneNode, LightData } from '../types';

function makeStore() {
  return createSliceStore<SceneLightSlice>(createSceneLightSlice);
}

function makeNode(
  entityId: string,
  components: string[],
): SceneNode {
  return { entityId, name: entityId, parentId: null, children: [], components, visible: true };
}

function makeGraph(nodes: SceneNode[]): SceneGraph {
  const nodeMap: SceneGraph['nodes'] = {};
  for (const n of nodes) {
    nodeMap[n.entityId] = n;
  }
  return { nodes: nodeMap, rootIds: nodes.map((n) => n.entityId) };
}

describe('sceneLightSlice', () => {
  describe('initial state', () => {
    it('starts with zero light entities', () => {
      const store = makeStore();
      const s = store.getState().sceneLightState;
      expect(s.directionalLights).toBe(0);
      expect(s.pointLights).toBe(0);
      expect(s.spotLights).toBe(0);
      expect(s.totalLightEntities).toBe(0);
    });

    it('starts with default ambient color and intensity', () => {
      const store = makeStore();
      const s = store.getState().sceneLightState;
      expect(s.ambientColor).toEqual([1, 1, 1, 1]);
      expect(s.ambientIntensity).toBe(300);
    });
  });

  describe('recomputeLightState', () => {
    it('counts directional, point, and spot lights from graph', () => {
      const store = makeStore();
      const graph = makeGraph([
        makeNode('d1', ['DirectionalLight']),
        makeNode('p1', ['PointLight']),
        makeNode('p2', ['PointLight']),
        makeNode('s1', ['SpotLight']),
        makeNode('cube', ['Mesh']),
      ]);
      store.getState().recomputeLightState(graph);
      const s = store.getState().sceneLightState;
      expect(s.directionalLights).toBe(1);
      expect(s.pointLights).toBe(2);
      expect(s.spotLights).toBe(1);
      expect(s.totalLightEntities).toBe(4);
    });

    it('results in zero counts for a graph with no lights', () => {
      const store = makeStore();
      const graph = makeGraph([
        makeNode('cube', ['Mesh']),
        makeNode('sphere', ['Mesh', 'Physics']),
      ]);
      store.getState().recomputeLightState(graph);
      const s = store.getState().sceneLightState;
      expect(s.totalLightEntities).toBe(0);
    });

    it('results in zero counts for an empty graph', () => {
      const store = makeStore();
      store.getState().recomputeLightState({ nodes: {}, rootIds: [] });
      expect(store.getState().sceneLightState.totalLightEntities).toBe(0);
    });

    it('does not reset ambient values on recompute', () => {
      const store = makeStore();
      store.getState().setSceneLightAmbient([0.5, 0.5, 0.5], 500);
      store.getState().recomputeLightState(makeGraph([makeNode('d1', ['DirectionalLight'])]));
      expect(store.getState().sceneLightState.ambientIntensity).toBe(500);
    });

    it('replacing with a graph with fewer lights reduces counts', () => {
      const store = makeStore();
      store.getState().recomputeLightState(makeGraph([
        makeNode('p1', ['PointLight']),
        makeNode('p2', ['PointLight']),
      ]));
      expect(store.getState().sceneLightState.pointLights).toBe(2);

      store.getState().recomputeLightState(makeGraph([makeNode('p1', ['PointLight'])]));
      expect(store.getState().sceneLightState.pointLights).toBe(1);
      expect(store.getState().sceneLightState.totalLightEntities).toBe(1);
    });
  });

  describe('onLightNodeAdded', () => {
    it('increments point light count when a PointLight node is added', () => {
      const store = makeStore();
      store.getState().onLightNodeAdded(makeNode('p1', ['PointLight']));
      expect(store.getState().sceneLightState.pointLights).toBe(1);
      expect(store.getState().sceneLightState.totalLightEntities).toBe(1);
    });

    it('increments directional light count when a DirectionalLight node is added', () => {
      const store = makeStore();
      store.getState().onLightNodeAdded(makeNode('d1', ['DirectionalLight']));
      expect(store.getState().sceneLightState.directionalLights).toBe(1);
    });

    it('increments spot light count when a SpotLight node is added', () => {
      const store = makeStore();
      store.getState().onLightNodeAdded(makeNode('s1', ['SpotLight']));
      expect(store.getState().sceneLightState.spotLights).toBe(1);
    });

    it('does not change counts for a non-light node', () => {
      const store = makeStore();
      store.getState().onLightNodeAdded(makeNode('cube', ['Mesh', 'Physics']));
      expect(store.getState().sceneLightState.totalLightEntities).toBe(0);
    });

    it('accumulates multiple additions correctly', () => {
      const store = makeStore();
      store.getState().onLightNodeAdded(makeNode('p1', ['PointLight']));
      store.getState().onLightNodeAdded(makeNode('p2', ['PointLight']));
      store.getState().onLightNodeAdded(makeNode('d1', ['DirectionalLight']));
      const s = store.getState().sceneLightState;
      expect(s.pointLights).toBe(2);
      expect(s.directionalLights).toBe(1);
      expect(s.totalLightEntities).toBe(3);
    });
  });

  describe('onLightNodeRemoved', () => {
    it('decrements point light count', () => {
      const store = makeStore();
      store.getState().onLightNodeAdded(makeNode('p1', ['PointLight']));
      store.getState().onLightNodeAdded(makeNode('p2', ['PointLight']));
      store.getState().onLightNodeRemoved(['PointLight']);
      expect(store.getState().sceneLightState.pointLights).toBe(1);
    });

    it('decrements directional light count', () => {
      const store = makeStore();
      store.getState().onLightNodeAdded(makeNode('d1', ['DirectionalLight']));
      store.getState().onLightNodeRemoved(['DirectionalLight']);
      expect(store.getState().sceneLightState.directionalLights).toBe(0);
    });

    it('does not go below zero on spurious removal', () => {
      const store = makeStore();
      // Remove when count is already 0
      store.getState().onLightNodeRemoved(['PointLight']);
      expect(store.getState().sceneLightState.pointLights).toBe(0);
      expect(store.getState().sceneLightState.totalLightEntities).toBe(0);
    });

    it('does not change counts for non-light component removal', () => {
      const store = makeStore();
      store.getState().onLightNodeAdded(makeNode('p1', ['PointLight']));
      store.getState().onLightNodeRemoved(['Mesh']);
      expect(store.getState().sceneLightState.pointLights).toBe(1);
    });

    it('updates totalLightEntities after removal', () => {
      const store = makeStore();
      store.getState().onLightNodeAdded(makeNode('p1', ['PointLight']));
      store.getState().onLightNodeAdded(makeNode('s1', ['SpotLight']));
      store.getState().onLightNodeRemoved(['SpotLight']);
      expect(store.getState().sceneLightState.totalLightEntities).toBe(1);
    });
  });

  describe('setSceneLightAmbient', () => {
    it('updates ambientColor with alpha=1', () => {
      const store = makeStore();
      store.getState().setSceneLightAmbient([0.2, 0.4, 0.6], 800);
      expect(store.getState().sceneLightState.ambientColor).toEqual([0.2, 0.4, 0.6, 1]);
    });

    it('updates ambientIntensity', () => {
      const store = makeStore();
      store.getState().setSceneLightAmbient([1, 1, 1], 1200);
      expect(store.getState().sceneLightState.ambientIntensity).toBe(1200);
    });

    it('does not alter light entity counts', () => {
      const store = makeStore();
      store.getState().onLightNodeAdded(makeNode('p1', ['PointLight']));
      store.getState().setSceneLightAmbient([0, 0, 0], 0);
      expect(store.getState().sceneLightState.totalLightEntities).toBe(1);
    });
  });

  // Regression: PF-795 — the store must aggregate per-entity LightData (color,
  // intensity, shadowsEnabled) so the editor can render an accurate shadow preview.
  describe('setLightEntityData / removeLightEntityData (PF-795)', () => {
    function makeLightData(lightType: LightData['lightType']): LightData {
      return {
        lightType,
        color: [1, 1, 1],
        intensity: 500,
        shadowsEnabled: true,
        shadowDepthBias: 0.02,
        shadowNormalBias: 0.6,
        range: 20,
        radius: 0,
        innerAngle: 0,
        outerAngle: 0.785,
      };
    }

    it('starts with an empty lightDataMap (PF-795)', () => {
      const store = makeStore();
      expect(store.getState().sceneLightState.lightDataMap).toEqual({});
    });

    it('stores light data for a given entity (PF-795)', () => {
      const store = makeStore();
      const data = makeLightData('directional');
      store.getState().setLightEntityData('d1', data);
      expect(store.getState().sceneLightState.lightDataMap['d1']).toEqual(data);
    });

    it('overwrites existing data on subsequent call for same entity (PF-795)', () => {
      const store = makeStore();
      store.getState().setLightEntityData('p1', makeLightData('point'));
      const updated = { ...makeLightData('point'), intensity: 1200 };
      store.getState().setLightEntityData('p1', updated);
      expect(store.getState().sceneLightState.lightDataMap['p1'].intensity).toBe(1200);
    });

    it('stores multiple entities independently (PF-795)', () => {
      const store = makeStore();
      store.getState().setLightEntityData('d1', makeLightData('directional'));
      store.getState().setLightEntityData('p1', makeLightData('point'));
      store.getState().setLightEntityData('s1', makeLightData('spot'));
      const map = store.getState().sceneLightState.lightDataMap;
      expect(Object.keys(map)).toHaveLength(3);
      expect(map['d1'].lightType).toBe('directional');
      expect(map['p1'].lightType).toBe('point');
      expect(map['s1'].lightType).toBe('spot');
    });

    it('removes light data for a given entity (PF-795)', () => {
      const store = makeStore();
      store.getState().setLightEntityData('p1', makeLightData('point'));
      store.getState().setLightEntityData('p2', makeLightData('point'));
      store.getState().removeLightEntityData('p1');
      const map = store.getState().sceneLightState.lightDataMap;
      expect(map['p1']).toBeUndefined();
      expect(map['p2']).not.toBeUndefined();
    });

    it('no-ops gracefully when removing an entity not in the map (PF-795)', () => {
      const store = makeStore();
      expect(() => store.getState().removeLightEntityData('nonexistent')).not.toThrow();
      expect(store.getState().sceneLightState.lightDataMap).toEqual({});
    });

    it('setLightEntityData does not affect light entity counts (PF-795)', () => {
      const store = makeStore();
      store.getState().onLightNodeAdded(makeNode('p1', ['PointLight']));
      store.getState().setLightEntityData('p1', makeLightData('point'));
      expect(store.getState().sceneLightState.totalLightEntities).toBe(1);
      expect(store.getState().sceneLightState.pointLights).toBe(1);
    });

    it('removeLightEntityData does not affect light entity counts (PF-795)', () => {
      const store = makeStore();
      store.getState().onLightNodeAdded(makeNode('p1', ['PointLight']));
      store.getState().setLightEntityData('p1', makeLightData('point'));
      store.getState().removeLightEntityData('p1');
      // Count tracking (onLightNodeRemoved) is separate from data map
      expect(store.getState().sceneLightState.pointLights).toBe(1);
    });

    it('setSceneLightAmbient does not clear lightDataMap (PF-795)', () => {
      const store = makeStore();
      store.getState().setLightEntityData('d1', makeLightData('directional'));
      store.getState().setSceneLightAmbient([0.5, 0.5, 0.5], 200);
      expect(store.getState().sceneLightState.lightDataMap['d1']).not.toBeUndefined();
    });

    it('recomputeLightState does not clear lightDataMap (PF-795)', () => {
      const store = makeStore();
      store.getState().setLightEntityData('d1', makeLightData('directional'));
      store.getState().recomputeLightState(makeGraph([makeNode('d1', ['DirectionalLight'])]));
      expect(store.getState().sceneLightState.lightDataMap['d1']).not.toBeUndefined();
    });

    it('shadowsEnabled is accessible for shadow preview via lightDataMap (PF-795)', () => {
      const store = makeStore();
      const withShadows = { ...makeLightData('directional'), shadowsEnabled: true };
      const withoutShadows = { ...makeLightData('point'), shadowsEnabled: false };
      store.getState().setLightEntityData('sun', withShadows);
      store.getState().setLightEntityData('fill', withoutShadows);
      const map = store.getState().sceneLightState.lightDataMap;
      const shadowCasters = Object.values(map).filter((l) => l.shadowsEnabled);
      expect(shadowCasters).toHaveLength(1);
      expect(shadowCasters[0].lightType).toBe('directional');
    });
  });

  describe('selector helpers', () => {
    describe('hasSceneLights', () => {
      it('returns false when totalLightEntities is 0', () => {
        const store = makeStore();
        expect(hasSceneLights(store.getState())).toBe(false);
      });

      it('returns true when there is at least one light entity', () => {
        const store = makeStore();
        store.getState().onLightNodeAdded(makeNode('p1', ['PointLight']));
        expect(hasSceneLights(store.getState())).toBe(true);
      });
    });

    describe('describeSceneLights', () => {
      it('returns "no light entities" when empty', () => {
        const store = makeStore();
        expect(describeSceneLights(store.getState())).toBe('no light entities');
      });

      it('describes a single directional light', () => {
        const store = makeStore();
        store.getState().onLightNodeAdded(makeNode('d1', ['DirectionalLight']));
        expect(describeSceneLights(store.getState())).toBe('1 directional');
      });

      it('describes multiple light types', () => {
        const store = makeStore();
        store.getState().onLightNodeAdded(makeNode('d1', ['DirectionalLight']));
        store.getState().onLightNodeAdded(makeNode('p1', ['PointLight']));
        store.getState().onLightNodeAdded(makeNode('p2', ['PointLight']));
        store.getState().onLightNodeAdded(makeNode('s1', ['SpotLight']));
        expect(describeSceneLights(store.getState())).toBe('1 directional, 2 point, 1 spot');
      });

      it('omits light types with zero count', () => {
        const store = makeStore();
        store.getState().onLightNodeAdded(makeNode('p1', ['PointLight']));
        expect(describeSceneLights(store.getState())).toBe('1 point');
      });
    });
  });
});
