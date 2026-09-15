import { describe, it, expect, beforeEach, vi } from 'vitest';
import { attachFixtureValidator } from './__tests__/sceneFixture';
import {
  createInitialProject,
  createScene,
  deleteScene,
  renameScene,
  duplicateScene,
  setStartScene,
  getSceneById,
  getSceneByName,
  getActiveScene,
  saveCurrentSceneData,
  switchScene,
  getSceneNames,
  getSceneCount,
  importSingleScene,
  loadProjectScenes,
  saveProjectScenes,
  writePrefabInstances,
  readPrefabInstances,
  writePrefabDefinitions,
  readPrefabDefinitions,
  type SceneFileData,
} from './sceneManager';
import type { PrefabInstance } from '../prefabs/prefabInstance';
import type { Prefab } from '../prefabs/prefabStore';

// Mock localStorage
let storage: Record<string, string> = {};
beforeEach(() => {
  attachFixtureValidator();
  storage = {};
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => storage[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { storage[key] = value; }),
    removeItem: vi.fn((key: string) => { delete storage[key]; }),
  });
});

describe('sceneManager', () => {
  describe('Initialization', () => {
    it('createInitialProject returns project with one scene named "Main"', () => {
      const project = createInitialProject();
      expect(project.scenes).toHaveLength(1);
      expect(project.scenes[0].name).toBe('Main');
      expect(project.activeSceneId).toBe(project.scenes[0].id);
    });

    it('initial scene is start scene', () => {
      const project = createInitialProject();
      expect(project.scenes[0].isStartScene).toBe(true);
    });

    it('loadProjectScenes returns initial project when nothing stored', () => {
      const project = loadProjectScenes();
      expect(project.scenes).toHaveLength(1);
      expect(project.scenes[0].name).toBe('Main');
    });
  });

  describe('Create', () => {
    it('createScene adds new scene to list', () => {
      const project = createInitialProject();
      const { project: updated } = createScene(project, 'Level 2');
      expect(updated.scenes).toHaveLength(2);
      expect(updated.scenes[1].name).toBe('Level 2');
    });

    it('new scene has unique ID', () => {
      const project = createInitialProject();
      const { project: updated1, sceneId: id1 } = createScene(project, 'A');
      const { project: updated2, sceneId: id2 } = createScene(updated1, 'B');
      expect(id1).not.toBe(id2);
      expect(updated2.scenes).toHaveLength(3);
    });

    it('new scene is not start scene', () => {
      const project = createInitialProject();
      const { project: updated } = createScene(project, 'Level 2');
      expect(updated.scenes[1].isStartScene).toBe(false);
    });
  });

  describe('Delete', () => {
    it('deleteScene removes scene by ID', () => {
      const project = createInitialProject();
      const { project: withTwo, sceneId } = createScene(project, 'ToDelete');
      const { project: updated } = deleteScene(withTwo, sceneId);
      expect(updated.scenes).toHaveLength(1);
      expect(updated.scenes.find(s => s.id === sceneId)).toBeUndefined();
    });

    it('cannot delete the last scene', () => {
      const project = createInitialProject();
      const result = deleteScene(project, project.scenes[0].id);
      expect(result.error).toBe('Cannot delete the last scene');
      expect(result.project.scenes).toHaveLength(1);
    });

    it('cannot delete the active scene', () => {
      const project = createInitialProject();
      const { project: withTwo } = createScene(project, 'Level 2');
      const result = deleteScene(withTwo, withTwo.activeSceneId);
      expect(result.error).toBe('Cannot delete the active scene. Switch to another scene first.');
    });

    it('delete nonexistent scene returns error', () => {
      const project = createInitialProject();
      const result = deleteScene(project, 'fake_id');
      expect(result.error).toBe('Scene not found');
    });

    it('if deleted scene was start scene, first remaining becomes start', () => {
      const project = createInitialProject();
      const { project: withTwo, sceneId } = createScene(project, 'Level 2');
      const withStartChanged = setStartScene(withTwo, sceneId);
      const { project: withThree, sceneId: thirdId } = createScene(withStartChanged, 'Level 3');
      const switched = { ...withThree, activeSceneId: thirdId };
      const { project: updated } = deleteScene(switched, sceneId);
      expect(updated.scenes.find(s => s.isStartScene)?.id).toBe(project.scenes[0].id);
    });
  });

  describe('Rename', () => {
    it('renameScene updates name', () => {
      const project = createInitialProject();
      const sceneId = project.scenes[0].id;
      const updated = renameScene(project, sceneId, 'NewName');
      expect(updated.scenes[0].name).toBe('NewName');
    });

    it('rename does not affect other scenes', () => {
      const project = createInitialProject();
      const { project: withTwo, sceneId } = createScene(project, 'Level 2');
      const updated = renameScene(withTwo, sceneId, 'Renamed');
      expect(updated.scenes[0].name).toBe('Main');
      expect(updated.scenes[1].name).toBe('Renamed');
    });
  });

  describe('Duplicate', () => {
    it('duplicateScene creates deep copy with new ID', () => {
      const project = createInitialProject();
      const sceneId = project.scenes[0].id;
      const result = duplicateScene(project, sceneId);
      if ('error' in result) throw new Error(result.error);
      expect(result.project.scenes).toHaveLength(2);
      expect(result.newSceneId).not.toBe(sceneId);
    });

    it('duplicate uses "Name Copy" format by default', () => {
      const project = createInitialProject();
      const sceneId = project.scenes[0].id;
      const result = duplicateScene(project, sceneId);
      if ('error' in result) throw new Error(result.error);
      expect(result.project.scenes[1].name).toBe('Main Copy');
    });

    it('duplicate custom name works', () => {
      const project = createInitialProject();
      const sceneId = project.scenes[0].id;
      const result = duplicateScene(project, sceneId, 'Custom');
      if ('error' in result) throw new Error(result.error);
      expect(result.project.scenes[1].name).toBe('Custom');
    });

    it('duplicate nonexistent returns error', () => {
      const project = createInitialProject();
      const result = duplicateScene(project, 'fake_id');
      expect('error' in result && result.error).toBe('Scene not found');
    });
  });

  describe('Start Scene', () => {
    it('setStartScene marks only one scene as start', () => {
      const project = createInitialProject();
      const { project: withTwo, sceneId } = createScene(project, 'Level 2');
      const updated = setStartScene(withTwo, sceneId);
      const startScenes = updated.scenes.filter(s => s.isStartScene);
      expect(startScenes).toHaveLength(1);
      expect(startScenes[0].id).toBe(sceneId);
    });

    it('previous start scene is unflagged', () => {
      const project = createInitialProject();
      const firstId = project.scenes[0].id;
      const { project: withTwo, sceneId } = createScene(project, 'Level 2');
      const updated = setStartScene(withTwo, sceneId);
      expect(updated.scenes.find(s => s.id === firstId)?.isStartScene).toBe(false);
    });
  });

  describe('Switch', () => {
    it('switchScene changes activeSceneId and returns scene data', () => {
      const project = createInitialProject();
      const { project: withTwo, sceneId } = createScene(project, 'Level 2');
      const result = switchScene(withTwo, sceneId);
      if ('error' in result) throw new Error(result.error);
      expect(result.project.activeSceneId).toBe(sceneId);
      expect(result.sceneToLoad).toEqual(expect.objectContaining({ metadata: expect.objectContaining({ name: 'Level 2' }) }));
    });

    it('switch to nonexistent scene returns error', () => {
      const project = createInitialProject();
      const result = switchScene(project, 'fake_id');
      expect('error' in result && result.error).toBe('Scene not found');
    });

    it('switch to already-active scene returns error', () => {
      const project = createInitialProject();
      const result = switchScene(project, project.activeSceneId);
      expect('error' in result && result.error).toBe('Already on this scene');
    });
  });

  describe('Lookup', () => {
    it('getSceneById finds scene', () => {
      const project = createInitialProject();
      const scene = getSceneById(project, project.scenes[0].id);
      expect(scene).toEqual(expect.objectContaining({ name: 'Main' }));
      expect(scene?.name).toBe('Main');
    });

    it('getSceneByName finds scene', () => {
      const project = createInitialProject();
      const scene = getSceneByName(project, 'Main');
      expect(scene).toEqual(expect.objectContaining({ id: project.scenes[0].id }));
      expect(scene?.id).toBe(project.scenes[0].id);
    });

    it('getActiveScene returns active scene', () => {
      const project = createInitialProject();
      const active = getActiveScene(project);
      expect(active).toEqual(expect.objectContaining({ id: project.activeSceneId }));
      expect(active?.id).toBe(project.activeSceneId);
    });
  });

  describe('Save/Load', () => {
    it('saveCurrentSceneData updates active scene data', () => {
      const project = createInitialProject();
      const sceneData: SceneFileData = {
        formatVersion: 1,
        sceneName: 'Main',
        entities: [{ id: '123', name: 'Cube' }],
      };
      const updated = saveCurrentSceneData(project, sceneData);
      const active = getActiveScene(updated);
      expect(active?.data).toEqual(sceneData);
    });

    it('saveProjectScenes + loadProjectScenes round-trips', () => {
      const project = createInitialProject();
      const { project: withTwo } = createScene(project, 'Level 2');
      saveProjectScenes(withTwo);
      const loaded = loadProjectScenes();
      expect(loaded.scenes).toHaveLength(2);
      expect(loaded.scenes[1].name).toBe('Level 2');
    });
  });

  describe('Import/Export', () => {
    it('importSingleScene wraps old format as single scene', () => {
      const sceneData: SceneFileData = {
        formatVersion: 1,
        sceneName: 'OldScene',
        entities: [{ id: '1', name: 'Cube' }],
      };
      const project = importSingleScene(sceneData);
      expect(project.scenes).toHaveLength(1);
      expect(project.scenes[0].name).toBe('OldScene');
      expect(project.scenes[0].isStartScene).toBe(true);
    });

    it('getSceneNames returns all scene names', () => {
      const project = createInitialProject();
      const { project: withTwo } = createScene(project, 'Level 2');
      const { project: withThree } = createScene(withTwo, 'Level 3');
      const names = getSceneNames(withThree);
      expect(names).toEqual(['Main', 'Level 2', 'Level 3']);
    });
  });

  describe('Utilities', () => {
    it('getSceneCount returns correct count', () => {
      const project = createInitialProject();
      expect(getSceneCount(project)).toBe(1);
      const { project: withTwo } = createScene(project, 'Level 2');
      expect(getSceneCount(withTwo)).toBe(2);
    });
  });

  describe('Prefab-instance persistence (scene.FR-1 N1)', () => {
    const baseScene: SceneFileData = { formatVersion: 1, sceneName: 'Main', entities: [] };
    const instances: PrefabInstance[] = [
      { instanceId: 'pfi_a', prefabId: 'prefab_src', overrides: { name: 'Kept', entityType: 'sphere' } },
      { instanceId: 'pfi_b', prefabId: 'prefab_src', overrides: {}, entityId: 'ent_2' },
    ];

    it('writePrefabInstances does not mutate the input scene', () => {
      const written = writePrefabInstances(baseScene, instances);
      expect(baseScene.prefabInstances).toBeUndefined();
      expect(written.prefabInstances).toHaveLength(2);
    });

    it('save -> reopen preserves stable ids, links and overrides with zero loss', () => {
      const written = writePrefabInstances(baseScene, instances);
      // Simulate a full save/reopen: serialize to the project file and parse back.
      const reopened = JSON.parse(JSON.stringify(written)) as SceneFileData;
      const restored = readPrefabInstances(reopened);

      expect(restored).toHaveLength(2);
      expect(restored[0].instanceId).toBe('pfi_a'); // stable id preserved
      expect(restored[0].prefabId).toBe('prefab_src'); // source link preserved
      expect(restored[0].overrides).toEqual({ name: 'Kept', entityType: 'sphere' }); // overrides intact
      expect(restored[1].entityId).toBe('ent_2'); // entity binding preserved
    });

    it('readPrefabInstances returns [] for a legacy scene without the field', () => {
      expect(readPrefabInstances(baseScene)).toEqual([]);
      expect(readPrefabInstances(null)).toEqual([]);
    });

    it('readPrefabInstances drops a malformed record rather than installing it (SEC)', () => {
      const crafted = {
        ...baseScene,
        prefabInstances: [instances[0], { prefabId: 'missing-instanceId' }, 'garbage'],
      } as unknown as SceneFileData;
      const restored = readPrefabInstances(crafted);
      expect(restored).toHaveLength(1);
      expect(restored[0].instanceId).toBe('pfi_a');
    });

    it('readPrefabInstances caps an oversized array rather than installing it whole (SEC)', () => {
      const many: PrefabInstance[] = Array.from({ length: 5010 }, (_, i) => ({
        instanceId: `pfi_${i}`,
        prefabId: 'src',
        overrides: {},
      }));
      const crafted = { ...baseScene, prefabInstances: many };
      expect(readPrefabInstances(crafted).length).toBe(5000);
    });

    it('readPrefabInstances returns [] when the field is not an array', () => {
      // @ts-expect-error — deliberately malformed for the untrusted-input guard
      expect(readPrefabInstances({ ...baseScene, prefabInstances: 'not-an-array' })).toEqual([]);
    });
  });

  describe('Prefab-definition portability (scene.FR-1 N1)', () => {
    const baseScene: SceneFileData = { formatVersion: 1, sceneName: 'Main', entities: [] };
    const now = new Date().toISOString();
    const def: Prefab = {
      id: 'prefab_src', name: 'Source', category: 'cat', description: '',
      snapshot: { entityType: 'cube', name: 'Source', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      createdAt: now, updatedAt: now,
    };

    it('writePrefabInstances does not mutate the input, and is a no-op for an empty list', () => {
      const written = writePrefabDefinitions(baseScene, []);
      expect(written).toBe(baseScene); // same reference — nothing to embed
      expect(written.prefabDefinitions).toBeUndefined();
    });

    it('save -> reopen round-trips an embedded definition intact', () => {
      const written = writePrefabDefinitions(baseScene, [def]);
      expect(baseScene.prefabDefinitions).toBeUndefined(); // input untouched
      const reopened = JSON.parse(JSON.stringify(written)) as SceneFileData;
      const restored = readPrefabDefinitions(reopened);
      expect(restored).toEqual([def]);
    });

    it('readPrefabDefinitions returns [] for a legacy scene without the field', () => {
      expect(readPrefabDefinitions(baseScene)).toEqual([]);
      expect(readPrefabDefinitions(null)).toEqual([]);
    });

    it('readPrefabDefinitions drops an entry missing id/name/snapshot (SEC)', () => {
      const crafted = {
        ...baseScene,
        prefabDefinitions: [def, { name: 'NoId' }, { id: 'no-name-or-snapshot' }],
      } as unknown as SceneFileData;
      const restored = readPrefabDefinitions(crafted);
      expect(restored).toEqual([def]);
    });
  });
});
