import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- Mocks ----------

// We build a fluent mock DB that mirrors drizzle's chainable + thenable API.
// Each call records what was chained and the terminal await resolves to whatever
// was queued via `queueResult`.

const resultQueue: unknown[] = [];

function queueResult(val: unknown) {
  resultQueue.push(val);
}

function nextResult(): unknown {
  return resultQueue.shift() ?? [];
}

/** Creates a chainable + thenable proxy that terminates on await */
function chain(): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const methods = ['from', 'where', 'limit', 'orderBy', 'returning', 'set', 'values'];
  for (const m of methods) {
    obj[m] = vi.fn(() => chain());
  }
  // Make it thenable so `await` resolves to the next queued result
  obj['then'] = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
    try {
      resolve(nextResult());
    } catch (e) {
      if (reject) reject(e);
    }
  };
  return obj;
}

const mockDb = {
  select: vi.fn(() => chain()),
  insert: vi.fn(() => chain()),
  update: vi.fn(() => chain()),
  delete: vi.fn(() => chain()),
};

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock('@/lib/db/schema', () => ({
  projects: {
    id: 'id',
    userId: 'user_id',
    name: 'name',
    sceneData: 'scene_data',
    thumbnail: 'thumbnail',
    entityCount: 'entity_count',
    formatVersion: 'format_version',
    updatedAt: 'updated_at',
    createdAt: 'created_at',
  },
  users: {
    id: 'id',
    tier: 'tier',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_a: unknown, _b: unknown) => 'eq-condition'),
  and: vi.fn((..._args: unknown[]) => 'and-condition'),
  desc: vi.fn((_col: unknown) => 'desc-order'),
  count: vi.fn(() => 'count-fn'),
}));

// ---------- Tests ----------

describe('listProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resultQueue.length = 0;
  });

  it('returns all projects for a user ordered by updatedAt desc', async () => {
    const { listProjects } = await import('../service');

    const mockProjects = [
      { id: 'p2', name: 'Project B', thumbnail: null, entityCount: 5, updatedAt: new Date('2026-02-15') },
      { id: 'p1', name: 'Project A', thumbnail: 'data:image/png', entityCount: 10, updatedAt: new Date('2026-01-10') },
    ];
    queueResult(mockProjects);

    const result = await listProjects('user-1');

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Project B');
    expect(result[1].name).toBe('Project A');
    expect(mockDb.select).toHaveBeenCalled();
  });

  it('returns empty array when user has no projects', async () => {
    const { listProjects } = await import('../service');

    queueResult([]);

    const result = await listProjects('user-1');

    expect(result).toEqual([]);
  });

  it('returns project fields in expected shape', async () => {
    const { listProjects } = await import('../service');

    const proj = {
      id: 'p1',
      name: 'My Game',
      thumbnail: 'base64data',
      entityCount: 42,
      updatedAt: new Date('2026-03-01'),
    };
    queueResult([proj]);

    const result = await listProjects('user-1');

    expect(result[0]).toHaveProperty('id', 'p1');
    expect(result[0]).toHaveProperty('name', 'My Game');
    expect(result[0]).toHaveProperty('thumbnail', 'base64data');
    expect(result[0]).toHaveProperty('entityCount', 42);
  });
});

describe('getProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resultQueue.length = 0;
  });

  it('returns the project when found', async () => {
    const { getProject } = await import('../service');

    const mockProject = {
      id: 'p1',
      userId: 'user-1',
      name: 'Test Project',
      sceneData: { entities: [] },
      thumbnail: null,
      entityCount: 3,
      formatVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    queueResult([mockProject]);

    const result = await getProject('user-1', 'p1');

    expect(result).toEqual(mockProject);
  });

  it('returns null when project not found', async () => {
    const { getProject } = await import('../service');

    queueResult([]);

    const result = await getProject('user-1', 'nonexistent');

    expect(result).toBeNull();
  });

  it('returns null when user does not own the project', async () => {
    const { getProject } = await import('../service');

    queueResult([]);

    const result = await getProject('wrong-user', 'p1');

    expect(result).toBeNull();
  });
});

describe('createProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resultQueue.length = 0;
  });

  it('creates a project when under the limit', async () => {
    const { createProject } = await import('../service');

    const newProject = {
      id: 'new-p',
      userId: 'user-1',
      name: 'New Game',
      sceneData: { entities: [] },
      thumbnail: null,
      entityCount: 0,
      formatVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // 1: getUserTier select
    queueResult([{ tier: 'creator' }]);
    // 2: getProjectCount select
    queueResult([{ count: 5 }]);
    // 3: insert returning
    queueResult([newProject]);

    const result = await createProject('user-1', 'New Game', { entities: [] });

    expect(result).toEqual(newProject);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('throws when project limit exceeded for starter', async () => {
    const { createProject } = await import('../service');

    // getUserTier
    queueResult([{ tier: 'starter' }]);
    // getProjectCount: starter limit is 3
    queueResult([{ count: 3 }]);

    await expect(
      createProject('user-1', 'Another', {})
    ).rejects.toThrow('Project limit exceeded');
  });

  it('throws with limit property on error', async () => {
    const { createProject } = await import('../service');

    queueResult([{ tier: 'starter' }]);
    queueResult([{ count: 3 }]);

    try {
      await createProject('user-1', 'Test', {});
      expect.fail('should have thrown');
    } catch (err: unknown) {
      const error = err as Error & { limit?: number };
      expect(error.message).toBe('Project limit exceeded');
      expect(error.limit).toBe(3);
    }
  });

  it('throws when user not found', async () => {
    const { createProject } = await import('../service');

    queueResult([]);

    await expect(
      createProject('ghost', 'Test', {})
    ).rejects.toThrow('User not found');
  });

  it('allows pro tier unlimited projects', async () => {
    const { createProject } = await import('../service');

    const newProject = {
      id: 'pro-p',
      userId: 'user-1',
      name: 'Pro Project',
      sceneData: {},
      thumbnail: null,
      entityCount: 0,
      formatVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    queueResult([{ tier: 'pro' }]);
    queueResult([{ count: 999 }]);
    queueResult([newProject]);

    const result = await createProject('user-1', 'Pro Project', {});

    expect(result.id).toBe('pro-p');
  });

  it('allows hobbyist at exactly 9 projects (under limit of 10)', async () => {
    const { createProject } = await import('../service');

    const newProject = {
      id: 'hob-p',
      userId: 'user-1',
      name: 'Hobbyist 10',
      sceneData: {},
      thumbnail: null,
      entityCount: 0,
      formatVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    queueResult([{ tier: 'hobbyist' }]);
    queueResult([{ count: 9 }]);
    queueResult([newProject]);

    const result = await createProject('user-1', 'Hobbyist 10', {});

    expect(result.id).toBe('hob-p');
  });

  it('rejects hobbyist at exactly 10 projects (at limit)', async () => {
    const { createProject } = await import('../service');

    queueResult([{ tier: 'hobbyist' }]);
    queueResult([{ count: 10 }]);

    await expect(
      createProject('user-1', 'Over Limit', {})
    ).rejects.toThrow('Project limit exceeded');
  });

  it('rejects creator at exactly 50 projects (at limit)', async () => {
    const { createProject } = await import('../service');

    queueResult([{ tier: 'creator' }]);
    queueResult([{ count: 50 }]);

    await expect(
      createProject('user-1', 'Over Limit', {})
    ).rejects.toThrow('Project limit exceeded');
  });
});

describe('updateProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resultQueue.length = 0;
  });

  it('updates and returns the project', async () => {
    const { updateProject } = await import('../service');

    const updated = {
      id: 'p1',
      userId: 'user-1',
      name: 'Updated Name',
      sceneData: { entities: [1, 2] },
      thumbnail: null,
      entityCount: 2,
      formatVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    queueResult([updated]);

    const result = await updateProject('user-1', 'p1', { name: 'Updated Name' });

    expect(result).toEqual(updated);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('returns null when project not found or not owned', async () => {
    const { updateProject } = await import('../service');

    queueResult([]);

    const result = await updateProject('user-1', 'nonexistent', { name: 'X' });

    expect(result).toBeNull();
  });

  it('updates only provided fields', async () => {
    const { updateProject } = await import('../service');

    const updated = {
      id: 'p1',
      userId: 'user-1',
      name: 'Unchanged',
      sceneData: {},
      thumbnail: 'new-thumb',
      entityCount: 5,
      formatVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    queueResult([updated]);

    const result = await updateProject('user-1', 'p1', { thumbnail: 'new-thumb' });

    expect(result?.thumbnail).toBe('new-thumb');
  });

  it('can update entityCount', async () => {
    const { updateProject } = await import('../service');

    const updated = {
      id: 'p1',
      userId: 'user-1',
      name: 'Test',
      sceneData: {},
      thumbnail: null,
      entityCount: 42,
      formatVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    queueResult([updated]);

    const result = await updateProject('user-1', 'p1', { entityCount: 42 });

    expect(result?.entityCount).toBe(42);
  });

  it('can update sceneData', async () => {
    const { updateProject } = await import('../service');

    const sceneData = { entities: [{ id: 'e1', type: 'cube' }] };
    const updated = {
      id: 'p1',
      userId: 'user-1',
      name: 'Test',
      sceneData,
      thumbnail: null,
      entityCount: 1,
      formatVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    queueResult([updated]);

    const result = await updateProject('user-1', 'p1', { sceneData });

    expect(result?.sceneData).toEqual(sceneData);
  });

  it('can clear thumbnail by setting to null', async () => {
    const { updateProject } = await import('../service');

    const updated = {
      id: 'p1',
      userId: 'user-1',
      name: 'Test',
      sceneData: {},
      thumbnail: null,
      entityCount: 0,
      formatVersion: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    queueResult([updated]);

    const result = await updateProject('user-1', 'p1', { thumbnail: null });

    expect(result?.thumbnail).toBeNull();
  });
});

describe('deleteProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resultQueue.length = 0;
  });

  it('returns true when project deleted successfully', async () => {
    const { deleteProject } = await import('../service');

    queueResult([{ id: 'p1' }]);

    const result = await deleteProject('user-1', 'p1');

    expect(result).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('returns false when project not found', async () => {
    const { deleteProject } = await import('../service');

    queueResult([]);

    const result = await deleteProject('user-1', 'nonexistent');

    expect(result).toBe(false);
  });

  it('returns false when user does not own the project', async () => {
    const { deleteProject } = await import('../service');

    queueResult([]);

    const result = await deleteProject('wrong-user', 'p1');

    expect(result).toBe(false);
  });
});

describe('getProjectCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resultQueue.length = 0;
  });

  it('returns correct project count', async () => {
    const { getProjectCount } = await import('../service');

    queueResult([{ count: 7 }]);

    const result = await getProjectCount('user-1');

    expect(result).toBe(7);
  });

  it('returns 0 when user has no projects', async () => {
    const { getProjectCount } = await import('../service');

    queueResult([{ count: 0 }]);

    const result = await getProjectCount('user-1');

    expect(result).toBe(0);
  });

  it('returns 0 when query returns empty array', async () => {
    const { getProjectCount } = await import('../service');

    queueResult([]);

    const result = await getProjectCount('user-1');

    expect(result).toBe(0);
  });
});
