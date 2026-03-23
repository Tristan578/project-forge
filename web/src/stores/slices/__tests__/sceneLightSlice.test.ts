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
import type { SceneGraph, SceneNode } from '../types';

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
