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
import { attachFixtureValidator, sceneFixture } from './sceneFixture';
import { setSceneValidator } from '../sceneValidation';
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
const CHECKPOINTS_STORAGE_KEY = 'forge-project-scene-checkpoints:v2';

function makeProject(activeName: string, sceneCount = 1): ProjectScenes {
  const scenes = Array.from({ length: sceneCount }, (_, i) => ({
    id: `scene_${i + 1}`,
    name: i === 0 ? activeName : `Scene ${i + 1}`,
    isStartScene: i === 0,
    data:
      i === 0
        ? sceneFixture(activeName)
        : null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  return { version: '1.0', activeSceneId: 'scene_1', scenes };
}

beforeEach(() => {
  attachFixtureValidator();
  localStorage.clear();
});

afterEach(() => {
  setSceneValidator(null);
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

  it('rejects a payload whose activeSceneId names no scene', () => {
    // #9813 review finding: the round-trip check only proved the JSON shape
    // parsed, not that activeSceneId pointed at a real entry — a dangling id
    // replaced the last valid project and stranded its saved scene behind an
    // active scene nothing could find.
    const good = makeProject('Level A');
    saveProjectScenes(good);

    const dangling: ProjectScenes = { ...makeProject('Level B'), activeSceneId: 'missing' };
    expect(() => saveProjectScenes(dangling)).toThrow(/validation/i);
    expect(loadProjectScenes()).toEqual(good);
  });

  it('rejects a payload with a malformed or duplicate-id scene entry', () => {
    const good = makeProject('Level A');
    saveProjectScenes(good);

    const missingName = {
      ...makeProject('Level B'),
      scenes: [{ id: 'scene_1', isStartScene: true, data: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
    } as unknown as ProjectScenes;
    expect(() => saveProjectScenes(missingName)).toThrow(/validation/i);

    const duplicateIds = makeProject('Duplicate IDs', 2);
    duplicateIds.scenes[1].id = duplicateIds.scenes[0].id;
    expect(() => saveProjectScenes(duplicateIds)).toThrow(/validation/i);

    expect(loadProjectScenes()).toEqual(good);
  });

  it('normalizes a stored numeric legacy version before the next save', () => {
    const legacy = { ...makeProject('Legacy'), version: 1 };
    const originalBytes = JSON.stringify(legacy);
    localStorage.setItem(SCENES_STORAGE_KEY, originalBytes);
    const loaded = loadProjectScenes();
    expect(loaded).toEqual({ ...legacy, version: '1.0' });
    expect(localStorage.getItem(SCENES_STORAGE_KEY)).toBe(originalBytes);
    expect(() => saveProjectScenes(loaded)).not.toThrow();
    expect(loadProjectScenes()).toEqual(loaded);
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
    // Reading a recovery point cannot replace storage before engine confirmation.
    expect(loadProjectScenes()).not.toEqual(v1);
    if ('project' in restored) saveProjectScenes(restored.project);
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
    // Reading a recovery point cannot replace storage before engine confirmation.
    expect(loadProjectScenes()).not.toEqual(v1);
    if ('project' in restored) saveProjectScenes(restored.project);
    expect(loadProjectScenes()).toEqual(v1);
  });

  it('the snapshot is immutable to later edits of the source project', () => {
    const project = makeProject('Snapshot source');
    createCheckpoint(project, 'snap');
    // Mutate the source object AFTER the checkpoint was taken.
    project.scenes[0].name = 'MUTATED';
    project.scenes[0].data!.metadata!.name = 'MUTATED';
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

  it('listCheckpoints drops a checkpoint whose snapshot has a dangling activeSceneId, not just a missing scenes array', () => {
    // #9813 review finding: the old filter only checked
    // `Array.isArray(snapshot.scenes)`, so a damaged snapshot with a real
    // array but an activeSceneId pointing nowhere still reached
    // restoreCheckpoint and could replace the active project with it.
    const good = createCheckpoint(makeProject('Good'), 'good').checkpoint;
    const stored = JSON.parse(localStorage.getItem(CHECKPOINTS_STORAGE_KEY)!) as Array<
      Record<string, unknown>
    >;
    stored.push({
      ...good,
      id: 'ckpt_damaged',
      label: 'damaged',
      createdAt: '2026-01-01T00:00:00.000Z',
      snapshot: { ...makeProject('Damaged'), activeSceneId: 'nowhere' },
    });
    localStorage.setItem(CHECKPOINTS_STORAGE_KEY, JSON.stringify(stored));

    const savedBytes = localStorage.getItem(CHECKPOINTS_STORAGE_KEY);
    const list = listCheckpoints();
    expect(list.map((c) => c.id)).toEqual([good.id]);
    expect(localStorage.getItem(CHECKPOINTS_STORAGE_KEY)).toBe(savedBytes);
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

describe('checkpoint validation and identity', () => {
  it.each([
    ['missing scene metadata', (project: ProjectScenes) => { delete project.scenes[0].data!.metadata; }],
    ['invalid entities', (project: ProjectScenes) => { project.scenes[0].data!.entities = [null]; }],
    ['unsupported version', (project: ProjectScenes) => { project.scenes[0].data!.formatVersion = 99; }],
    ['invalid timestamp', (project: ProjectScenes) => { project.scenes[0].updatedAt = 'not-a-date'; }],
  ])('rejects %s before replacing or evicting any saved data', (_name, damage) => {
    const good = makeProject('Good');
    saveProjectScenes(good);
    createCheckpoint(good, 'Keep');
    const priorProject = localStorage.getItem(SCENES_STORAGE_KEY);
    const priorCheckpoints = localStorage.getItem(CHECKPOINTS_STORAGE_KEY);
    const damaged = makeProject('Damaged');
    damage(damaged);
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    expect(() => saveProjectScenes(damaged)).toThrow(/validation/i);
    expect(() => createCheckpoint(damaged)).toThrow(/validation/i);
    expect(writes).not.toHaveBeenCalled();
    expect(localStorage.getItem(SCENES_STORAGE_KEY)).toBe(priorProject);
    expect(localStorage.getItem(CHECKPOINTS_STORAGE_KEY)).toBe(priorCheckpoints);
  });

  it('filters invalid labels and timestamps rather than rendering unsafe records', () => {
    const good = createCheckpoint(makeProject('Good'), 'Good').checkpoint;
    localStorage.setItem(CHECKPOINTS_STORAGE_KEY, JSON.stringify([
      good, { ...good, id: 'bad-label', label: {} }, { ...good, id: 'bad-time', createdAt: 'invalid' },
    ]));
    expect(listCheckpoints().map((cp) => cp.id)).toEqual([good.id]);
  });

  it('migrates numeric legacy project version 1 to the writable 1.0 container', () => {
    const project = makeProject('Legacy');
    localStorage.setItem(SCENES_STORAGE_KEY, JSON.stringify({ ...project, version: 1 }));
    expect(loadProjectScenes()).toEqual(project);
    expect(() => saveProjectScenes(loadProjectScenes())).not.toThrow();
  });

  it('does not import old anonymous checkpoint records into any project namespace', () => {
    localStorage.setItem('forge-project-scene-checkpoints', JSON.stringify([{ id: 'legacy', snapshot: makeProject('Other') }]));
    expect(listCheckpoints()).toEqual([]);
    expect(listCheckpoints('A')).toEqual([]);
  });

  it('does not evict any old checkpoints when the incoming label is invalid', () => {
    createCheckpoint(makeProject('Keep'), 'Keep');
    const before = localStorage.getItem(CHECKPOINTS_STORAGE_KEY);
    expect(() => createCheckpoint(makeProject('Bad'), {} as string)).toThrow(/label/i);
    expect(localStorage.getItem(CHECKPOINTS_STORAGE_KEY)).toBe(before);
  });

  it('does not retry or evict entries for non-quota storage failures', () => {
    createCheckpoint(makeProject('Keep'), 'Keep');
    const before = localStorage.getItem(CHECKPOINTS_STORAGE_KEY);
    const writes = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Disabled'); });
    expect(() => createCheckpoint(makeProject('New'))).toThrow('Disabled');
    expect(writes).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CHECKPOINTS_STORAGE_KEY)).toBe(before);
  });
  it('reads stored scenes before the engine is attached without replacing them with an initial project', () => {
    const project = makeProject('Saved before startup');
    saveProjectScenes(project);
    createCheckpoint(project, 'Keep');
    const before = localStorage.getItem(SCENES_STORAGE_KEY);
    setSceneValidator(null);
    expect(loadProjectScenes()).toEqual(project);
    expect(listCheckpoints().map((cp) => cp.label)).toEqual(['Keep']);
    expect(localStorage.getItem(SCENES_STORAGE_KEY)).toBe(before);
  });

  it('normalizes the known legacy empty-scene shape without requiring an engine', () => {
    const project = makeProject('Empty legacy');
    const raw = JSON.stringify({ ...project, scenes: [{ ...project.scenes[0], data: { formatVersion: 3, sceneName: 'Empty legacy', entities: [] } }] });
    localStorage.setItem(SCENES_STORAGE_KEY, raw);
    setSceneValidator(null);
    expect(loadProjectScenes().scenes[0].data).toEqual(sceneFixture('Empty legacy'));
    expect(localStorage.getItem(SCENES_STORAGE_KEY)).toBe(raw);
    attachFixtureValidator();
    expect(() => saveProjectScenes(loadProjectScenes())).not.toThrow();
  });

  it.each([
    { formatVersion: 3, sceneName: 'Legacy entities', entities: [{ id: 'must-not-disappear' }] },
    { formatVersion: 99, sceneName: 'Future', entities: [] },
  ])('preserves unsupported saved data instead of treating it as absent: %j', (data) => {
    const project = makeProject('Preserve');
    const raw = JSON.stringify({ ...project, scenes: [{ ...project.scenes[0], data }] });
    localStorage.setItem(SCENES_STORAGE_KEY, raw);
    expect(() => loadProjectScenes()).toThrow(/preserved/);
    expect(localStorage.getItem(SCENES_STORAGE_KEY)).toBe(raw);
  });

});
