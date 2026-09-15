// @vitest-environment jsdom
/**
 * Atomic saves and recovery checkpoints — scene.FR-3.OP-02.
 *
 * These tests exercise the REAL sceneManager against a real jsdom localStorage.
 * The parity handler tests in
 * `web/src/lib/chat/handlers/__tests__/sceneManagementHandlers.test.ts` assert
 * that the in-app AI path drives these same functions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createInitialProject,
  loadProjectScenes,
  saveProjectScenes,
  createCheckpoint,
  listCheckpoints,
  restoreCheckpoint,
  deleteCheckpoint,
  MAX_CHECKPOINTS,
  type ProjectScenes,
} from '../sceneManager';

const SCENES_STORAGE_KEY = 'forge-project-scenes';
const CHECKPOINTS_STORAGE_KEY = 'forge-project-scene-checkpoints';

function makeProject(activeName: string, sceneCount = 1): ProjectScenes {
  const scenes = Array.from({ length: sceneCount }, (_, i) => ({
    id: `scene_${i + 1}`,
    name: i === 0 ? activeName : `Scene ${i + 1}`,
    isStartScene: i === 0,
    data:
      i === 0
        ? { formatVersion: 3, sceneName: activeName, entities: [{ id: 'e1', tag: activeName }] }
        : null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  return { version: '1.0', activeSceneId: 'scene_1', scenes };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Atomic save
// ---------------------------------------------------------------------------

describe('saveProjectScenes — atomic write', () => {
  it('an interrupted write never replaces the last valid project with a partial scene', () => {
    const good = makeProject('Level A');
    saveProjectScenes(good);
    // The last valid project is on disk and reloads.
    expect(loadProjectScenes()).toEqual(good);

    // Simulate an interruption: the very next write throws mid-save (e.g. a
    // QuotaExceededError). setItem is all-or-nothing, so nothing is written.
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    const attempted = makeProject('Level B (should not land)');
    expect(() => saveProjectScenes(attempted)).toThrow();

    setItemSpy.mockRestore();

    // The previously stored project is unchanged and still loads.
    expect(loadProjectScenes()).toEqual(good);
    expect(loadProjectScenes()).not.toEqual(attempted);
  });

  it('rejects a structurally invalid payload without overwriting the stored project', () => {
    const good = makeProject('Level A');
    saveProjectScenes(good);

    // A payload that serializes but has no scenes must be refused before write.
    const empty = { version: '1.0', activeSceneId: 'scene_1', scenes: [] } as ProjectScenes;
    expect(() => saveProjectScenes(empty)).toThrow(/validation/i);

    // Raw storage still holds the last valid project byte-for-byte.
    expect(localStorage.getItem(SCENES_STORAGE_KEY)).toBe(JSON.stringify(good));
    expect(loadProjectScenes()).toEqual(good);
  });

  it('refuses a payload that cannot be serialized, leaving the prior value intact', () => {
    const good = makeProject('Level A');
    saveProjectScenes(good);

    const circular = makeProject('Circular') as unknown as Record<string, unknown>;
    circular.self = circular; // JSON.stringify throws on a cycle
    expect(() => saveProjectScenes(circular as unknown as ProjectScenes)).toThrow(
      /serialize/i
    );

    expect(loadProjectScenes()).toEqual(good);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint create / list / restore round-trip
// ---------------------------------------------------------------------------

describe('checkpoints — create/list/restore round-trip', () => {
  it('creates, lists, and restores a checkpoint (newest first)', () => {
    const v1 = makeProject('Version 1');
    saveProjectScenes(v1);

    const { checkpoint } = createCheckpoint(v1, 'before big change');
    expect(checkpoint.label).toBe('before big change');

    const list = listCheckpoints();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(checkpoint.id);
    // The snapshot is a deep copy, decoupled from the live project.
    expect(list[0].snapshot).toEqual(v1);

    // Move the active project forward, then restore the checkpoint.
    const v2 = makeProject('Version 2');
    saveProjectScenes(v2);
    expect(loadProjectScenes()).toEqual(v2);

    const restored = restoreCheckpoint(checkpoint.id);
    expect('project' in restored && restored.project).toEqual(v1);
    expect(loadProjectScenes()).toEqual(v1);
  });

  it('restores an OLDER checkpoint after newer saves and newer checkpoints exist', () => {
    const v1 = makeProject('Oldest');
    saveProjectScenes(v1);
    const first = createCheckpoint(v1, 'oldest').checkpoint;

    const v2 = makeProject('Middle');
    saveProjectScenes(v2);
    createCheckpoint(v2, 'middle');

    const v3 = makeProject('Newest');
    saveProjectScenes(v3);
    createCheckpoint(v3, 'newest');

    // Restoring the very first checkpoint brings back its snapshot exactly.
    const restored = restoreCheckpoint(first.id);
    expect('project' in restored && restored.project).toEqual(v1);
    expect(loadProjectScenes()).toEqual(v1);
  });

  it('the snapshot is immutable to later edits of the source project', () => {
    const project = makeProject('Snapshot source');
    createCheckpoint(project, 'snap');
    // Mutate the source object AFTER the checkpoint was taken.
    project.scenes[0].name = 'MUTATED';
    (project.scenes[0].data as { sceneName: string }).sceneName = 'MUTATED';
    expect(listCheckpoints()[0].snapshot.scenes[0].name).toBe('Snapshot source');
  });

  it('restoreCheckpoint returns an error for an unknown id and does not touch storage', () => {
    const v1 = makeProject('Keep me');
    saveProjectScenes(v1);
    const result = restoreCheckpoint('ckpt_does_not_exist');
    expect('error' in result).toBe(true);
    expect(loadProjectScenes()).toEqual(v1);
  });

  it('deleteCheckpoint removes only the named checkpoint', () => {
    const a = createCheckpoint(makeProject('A'), 'a').checkpoint;
    const b = createCheckpoint(makeProject('B'), 'b').checkpoint;
    const remaining = deleteCheckpoint(a.id);
    expect(remaining.map((c) => c.id)).toEqual([b.id]);
    expect(listCheckpoints().map((c) => c.id)).toEqual([b.id]);
  });
});

// ---------------------------------------------------------------------------
// Eviction safety
// ---------------------------------------------------------------------------

describe('checkpoints — cap/eviction', () => {
  it('caps stored checkpoints and never drops the most recent valid one', () => {
    let latestId = '';
    for (let i = 0; i < MAX_CHECKPOINTS + 5; i++) {
      // Force a distinct id even when Date.now() does not advance within a tick.
      vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000 + i);
      latestId = createCheckpoint(makeProject(`v${i}`), `cp-${i}`).checkpoint.id;
      vi.restoreAllMocks();
    }
    const list = listCheckpoints();
    expect(list).toHaveLength(MAX_CHECKPOINTS);
    // Newest is at the head and is the one we just created.
    expect(list[0].id).toBe(latestId);
    expect(list[0].label).toBe(`cp-${MAX_CHECKPOINTS + 4}`);
  });

  it('eviction does not corrupt the active project', () => {
    const active = makeProject('Active project');
    saveProjectScenes(active);
    for (let i = 0; i < MAX_CHECKPOINTS + 3; i++) {
      createCheckpoint(makeProject(`snap-${i}`), `cp-${i}`);
    }
    // The active project storage key is untouched by checkpoint churn.
    expect(loadProjectScenes()).toEqual(active);
    expect(listCheckpoints()).toHaveLength(MAX_CHECKPOINTS);
  });

  it('under quota pressure it evicts oldest and keeps the newest checkpoint', () => {
    // Seed a full checkpoint store the normal way.
    for (let i = 0; i < MAX_CHECKPOINTS; i++) {
      createCheckpoint(makeProject(`seed-${i}`), `seed-${i}`);
    }
    const active = makeProject('Active');
    saveProjectScenes(active);

    // Now make the checkpoint write fail once, then succeed — the persist loop
    // should drop the oldest and retry, keeping the brand-new checkpoint.
    let calls = 0;
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (key === CHECKPOINTS_STORAGE_KEY) {
        calls += 1;
        if (calls === 1) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      return real.call(this, key, value);
    });

    const created = createCheckpoint(makeProject('fresh'), 'fresh');
    spy.mockRestore();

    expect(calls).toBeGreaterThanOrEqual(2); // failed once, retried
    const list = listCheckpoints();
    expect(list[0].id).toBe(created.checkpoint.id);
    expect(list.length).toBeLessThanOrEqual(MAX_CHECKPOINTS);
    // Active project never corrupted by the checkpoint quota dance.
    expect(loadProjectScenes()).toEqual(active);
  });
});

// Guard: createInitialProject stays a valid input to the atomic save.
describe('createInitialProject', () => {
  it('produces a project the atomic save accepts', () => {
    const project = createInitialProject();
    expect(() => saveProjectScenes(project)).not.toThrow();
    expect(loadProjectScenes()).toEqual(project);
  });
});
