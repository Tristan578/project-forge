import { describe, it, expect } from 'vitest';
import { buildSceneContext } from '../context';
import { makeEntity } from '@/test/utils/fixtures';

describe('scene context builder', () => {
  const mockState = {
    sceneGraph: {
      nodes: {
        'e1': { ...makeEntity({ entityId: 'e1', name: 'Box' }), components: ['Transform', 'Mesh3d'] },
        'e2': { ...makeEntity({ entityId: 'e2', name: 'Ball' }), components: ['Transform', 'Mesh3d'] },
      },
      rootIds: ['e1', 'e2'],
    },
    selectedIds: new Set(['e1']),
    primaryId: 'e1',
    primaryTransform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    primaryMaterial: { baseColor: [1, 1, 1, 1], metallic: 0, perceptualRoughness: 0.5 },
    primaryLight: null,
    ambientLight: { color: [1, 1, 1], brightness: 1 },
    environment: {},
    canUndo: false,
    canRedo: false,
    undoDescription: null,
    redoDescription: null,
  } as unknown as Parameters<typeof buildSceneContext>[0];

  it('builds basic context with scene info', () => {
    const context = buildSceneContext(mockState);

    expect(context).toContain('"Box" (mesh, id: e1)');
    expect(context).toContain('"Ball" (mesh, id: e2)');
    expect(context).toContain('Selected Entity');
  });

  it('reports empty scene correctly', () => {
    const emptyState = {
      ...mockState,
      sceneGraph: { nodes: {}, rootIds: [] },
      primaryId: null,
      selectedIds: new Set<string>(),
    };
    const context = buildSceneContext(emptyState);
    expect(context).toContain('(Empty scene — no entities yet)');
  });

  it('summarizes large scenes', () => {
    const nodes: Record<string, ReturnType<typeof makeEntity>> = {};
    for (let i = 0; i < 150; i++) {
      nodes[`e${i}`] = { ...makeEntity({ entityId: `e${i}`, name: `Cube ${i}` }), components: ['Transform', 'Mesh3d'] };
    }
    const bigState = {
      ...mockState,
      sceneGraph: { nodes, rootIds: Object.keys(nodes) },
      primaryId: null,
      selectedIds: new Set<string>(),
    };

    const context = buildSceneContext(bigState);
    expect(context).toContain('Scene summary: 150 meshes');
  });
});
