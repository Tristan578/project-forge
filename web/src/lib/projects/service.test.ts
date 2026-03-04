import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDb } from '../db/client';
import {
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getProjectCount,
} from './service';

vi.mock('../db/client');
vi.mock('../db/schema', () => ({
  projects: {
    id: 'id', userId: 'userId', name: 'name', thumbnail: 'thumbnail',
    entityCount: 'entityCount', updatedAt: 'updatedAt', sceneData: 'sceneData',
    formatVersion: 'formatVersion',
  },
  users: { id: 'id', tier: 'tier' },
}));
vi.mock('./limits', () => ({
  PROJECT_LIMITS: {
    starter: 3,
    hobbyist: 10,
    creator: 50,
    pro: Infinity,
  },
}));

/** Build a mock chain that resolves to `data` for select/insert/update/delete */
function mockChain(data: unknown[] = []) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: Record<string, any> = {};
  const methods = ['select', 'from', 'where', 'orderBy', 'limit', 'insert', 'values', 'returning', 'update', 'set', 'delete'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(data).then(resolve, reject);
  return chain;
}

describe('listProjects', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns project list ordered by updatedAt', async () => {
    const projectList = [
      { id: 'p1', name: 'Game 1', thumbnail: null, entityCount: 5, updatedAt: new Date() },
    ];
    const chain = mockChain(projectList);
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(chain) } as never);

    const result = await listProjects('user-1');
    expect(result).toEqual(projectList);
  });

  it('returns empty array when user has no projects', async () => {
    const chain = mockChain([]);
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(chain) } as never);

    const result = await listProjects('user-1');
    expect(result).toEqual([]);
  });
});

describe('getProject', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns project when found', async () => {
    const project = { id: 'p1', userId: 'user-1', name: 'Game', sceneData: {} };
    const chain = mockChain([project]);
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(chain) } as never);

    const result = await getProject('user-1', 'p1');
    expect(result).toEqual(project);
  });

  it('returns null when project not found', async () => {
    const chain = mockChain([]);
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(chain) } as never);

    const result = await getProject('user-1', 'p-nonexistent');
    expect(result).toBeNull();
  });
});

describe('createProject', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('creates project when under limit', async () => {
    const createdProject = { id: 'p-new', userId: 'user-1', name: 'New Game', sceneData: {}, entityCount: 0, formatVersion: 1 };
    // First select: user tier
    const userChain = mockChain([{ tier: 'creator' }]);
    // Second select: project count
    const countChain = mockChain([{ count: 2 }]);
    // Insert
    const insertChain = mockChain([createdProject]);

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(userChain)
        .mockReturnValueOnce(countChain),
      insert: vi.fn().mockReturnValue(insertChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const result = await createProject('user-1', 'New Game', {});
    expect(result).toEqual(createdProject);
  });

  it('throws when user not found', async () => {
    const userChain = mockChain([]);
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(userChain) } as never);

    await expect(createProject('unknown-user', 'Game', {})).rejects.toThrow('User not found');
  });

  it('throws when project limit exceeded', async () => {
    // User is on starter tier (limit 3) with 3 projects already
    const userChain = mockChain([{ tier: 'starter' }]);
    const countChain = mockChain([{ count: 3 }]);

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(userChain)
        .mockReturnValueOnce(countChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    await expect(createProject('user-1', 'One Too Many', {})).rejects.toThrow('Project limit exceeded');
  });

  it('attaches limit property to error when limit exceeded', async () => {
    const userChain = mockChain([{ tier: 'starter' }]);
    const countChain = mockChain([{ count: 3 }]);

    const mockDb = {
      select: vi.fn()
        .mockReturnValueOnce(userChain)
        .mockReturnValueOnce(countChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    try {
      await createProject('user-1', 'Over Limit', {});
      expect.fail('Should have thrown');
    } catch (error) {
      expect((error as Error & { limit?: number }).limit).toBe(3);
    }
  });
});

describe('updateProject', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns updated project on success', async () => {
    const updated = { id: 'p1', userId: 'user-1', name: 'Updated', updatedAt: new Date() };
    const chain = mockChain([updated]);
    vi.mocked(getDb).mockReturnValue({ update: vi.fn().mockReturnValue(chain) } as never);

    const result = await updateProject('user-1', 'p1', { name: 'Updated' });
    expect(result).toEqual(updated);
  });

  it('returns null when project not found', async () => {
    const chain = mockChain([]);
    vi.mocked(getDb).mockReturnValue({ update: vi.fn().mockReturnValue(chain) } as never);

    const result = await updateProject('user-1', 'p-nonexistent', { name: 'X' });
    expect(result).toBeNull();
  });
});

describe('deleteProject', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns true when project deleted', async () => {
    const chain = mockChain([{ id: 'p1' }]);
    vi.mocked(getDb).mockReturnValue({ delete: vi.fn().mockReturnValue(chain) } as never);

    const result = await deleteProject('user-1', 'p1');
    expect(result).toBe(true);
  });

  it('returns false when project not found', async () => {
    const chain = mockChain([]);
    vi.mocked(getDb).mockReturnValue({ delete: vi.fn().mockReturnValue(chain) } as never);

    const result = await deleteProject('user-1', 'p-nonexistent');
    expect(result).toBe(false);
  });
});

describe('getProjectCount', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns count of user projects', async () => {
    const chain = mockChain([{ count: 7 }]);
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(chain) } as never);

    const result = await getProjectCount('user-1');
    expect(result).toBe(7);
  });

  it('returns 0 when no projects found', async () => {
    const chain = mockChain([]);
    vi.mocked(getDb).mockReturnValue({ select: vi.fn().mockReturnValue(chain) } as never);

    const result = await getProjectCount('user-1');
    expect(result).toBe(0);
  });
});
