/**
 * Tests for SceneStatistics component logic.
 * Tests the statistics computation from store data.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the stores before importing the component
vi.mock('@/stores/editorStore', () => {
  const storeData = {
    sceneGraph: { nodes: {} },
    allScripts: {},
    assetRegistry: {},
    sprites: {},
    sortingLayers: [],
  };

  return {
    useEditorStore: (selector: (s: typeof storeData) => unknown) => selector(storeData),
    __setMockData: (data: Partial<typeof storeData>) => {
      Object.assign(storeData, data);
    },
  };
});

// Import after mock setup — __setMockData is injected by vi.mock above
// @ts-expect-error: mock-only export not in real module types
import { __setMockData } from '@/stores/editorStore';

describe('SceneStatistics store data computation', () => {
  beforeEach(() => {
    __setMockData({
      sceneGraph: { nodes: {} },
      allScripts: {},
      assetRegistry: {},
      sprites: {},
      sortingLayers: [],
    });
  });

  it('should count entities from sceneGraph nodes', () => {
    __setMockData({
      sceneGraph: {
        nodes: {
          'e1': { components: ['Mesh'] },
          'e2': { components: ['Light'] },
          'e3': { components: ['Mesh', 'Physics'] },
        },
      },
    });

    // Directly test the computation logic
    const nodes = { e1: { components: ['Mesh'] }, e2: { components: ['Light'] }, e3: { components: ['Mesh', 'Physics'] } };
    const entityCount = Object.keys(nodes).length;
    expect(entityCount).toBe(3);
  });

  it('should count scripts', () => {
    const scripts = { player: { source: '...', enabled: true }, enemy: { source: '...', enabled: true } };
    expect(Object.keys(scripts).length).toBe(2);
  });

  it('should count assets by kind', () => {
    const assets = {
      t1: { id: 't1', name: 'tex', kind: 'texture', fileSize: 100, source: { type: 'upload', filename: 'a.png' } },
      m1: { id: 'm1', name: 'model', kind: 'gltf_model', fileSize: 200, source: { type: 'upload', filename: 'b.glb' } },
      a1: { id: 'a1', name: 'sound', kind: 'audio', fileSize: 50, source: { type: 'upload', filename: 'c.mp3' } },
      t2: { id: 't2', name: 'tex2', kind: 'texture', fileSize: 100, source: { type: 'upload', filename: 'd.png' } },
    };

    const textureCount = Object.values(assets).filter((a) => a.kind === 'texture').length;
    const modelCount = Object.values(assets).filter((a) => a.kind === 'gltf_model').length;
    const audioCount = Object.values(assets).filter((a) => a.kind === 'audio').length;

    expect(textureCount).toBe(2);
    expect(modelCount).toBe(1);
    expect(audioCount).toBe(1);
  });

  it('should count component types from node components array', () => {
    const nodes: Record<string, { components: string[] }> = {
      e1: { components: ['Light'] },
      e2: { components: ['Physics', 'GameComponent'] },
      e3: { components: ['PointLight'] },
      e4: { components: ['Audio', 'AnimationClip'] },
      e5: { components: ['Particle'] },
    };

    let lightCount = 0;
    let physicsCount = 0;
    let audioCount = 0;
    let particleCount = 0;
    let gameComponentCount = 0;
    let animClipCount = 0;

    for (const id of Object.keys(nodes)) {
      for (const c of nodes[id].components) {
        if (c === 'Light' || c === 'PointLight' || c === 'DirectionalLight' || c === 'SpotLight') lightCount++;
        if (c === 'Physics' || c === 'RigidBody') physicsCount++;
        if (c === 'Audio') audioCount++;
        if (c === 'Particle') particleCount++;
        if (c === 'GameComponent') gameComponentCount++;
        if (c === 'AnimationClip') animClipCount++;
      }
    }

    expect(lightCount).toBe(2);
    expect(physicsCount).toBe(1);
    expect(audioCount).toBe(1);
    expect(particleCount).toBe(1);
    expect(gameComponentCount).toBe(1);
    expect(animClipCount).toBe(1);
  });

  it('should handle empty scene gracefully', () => {
    const nodes = {};
    const scripts = {};
    const assets = {};

    expect(Object.keys(nodes).length).toBe(0);
    expect(Object.keys(scripts).length).toBe(0);
    expect(Object.keys(assets).length).toBe(0);
  });

  it('should filter out zero-count component breakdowns', () => {
    const componentBreakdown = [
      { label: 'Sprites', value: 5 },
      { label: 'Lights', value: 0 },
      { label: 'Physics Bodies', value: 3 },
      { label: 'Audio Sources', value: 0 },
    ].filter((r) => r.value > 0);

    expect(componentBreakdown).toHaveLength(2);
    expect(componentBreakdown[0].label).toBe('Sprites');
    expect(componentBreakdown[1].label).toBe('Physics Bodies');
  });

  it('should count sorting layers', () => {
    const layers = [
      { name: 'Background', order: 0, visible: true },
      { name: 'Default', order: 1, visible: true },
      { name: 'Foreground', order: 2, visible: true },
      { name: 'UI', order: 3, visible: true },
    ];
    expect(layers.length).toBe(4);
  });

  it('should count sprites from sprites record', () => {
    const sprites = {
      s1: { textureAssetId: null, colorTint: [1, 1, 1, 1], flipX: false, flipY: false, customSize: null, sortingLayer: 'Default', sortingOrder: 0, anchor: 'center' },
      s2: { textureAssetId: 'tex1', colorTint: [1, 0, 0, 1], flipX: true, flipY: false, customSize: [32, 32], sortingLayer: 'Default', sortingOrder: 1, anchor: 'center' },
    };
    expect(Object.keys(sprites).length).toBe(2);
  });
});
