/**
 * Unit tests for questStore — addChain, removeChain, updateObjective,
 * updateQuest, clearAll, and selector helpers.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useQuestStore } from '../questStore';
import type { QuestChain, Quest } from '../questStore';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeObjective(id: string) {
  return {
    id,
    type: 'kill_count' as const,
    description: `Defeat enemies (${id})`,
    target: 'Bandits',
    required: 3,
    current: 0,
    optional: false,
  };
}

function makeQuest(id: string, prereqs: string[] = []): Quest {
  return {
    id,
    title: `Quest ${id}`,
    description: `Description for ${id}`,
    type: 'kill',
    status: prereqs.length === 0 ? 'available' : 'locked',
    level: 1,
    objectives: [makeObjective(`obj-${id}`)],
    rewards: [
      { type: 'experience', name: 'Experience', amount: 100 },
      { type: 'gold', name: 'Gold', amount: 50 },
    ],
    prerequisites: prereqs,
    narrativeHook: 'A stranger arrives.',
    giverNpc: 'Elder Maren',
    location: 'Silverbrook Village',
  };
}

function makeChain(id: string, questCount = 2): QuestChain {
  const quests = Array.from({ length: questCount }, (_, i) => {
    const questId = `${id}-q${i}`;
    return makeQuest(questId, i > 0 ? [`${id}-q${i - 1}`] : []);
  });
  return {
    id,
    name: `Chain ${id}`,
    description: 'A test chain.',
    templateId: 'hero_origin',
    quests,
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  useQuestStore.setState({ chains: {} });
});

// ---------------------------------------------------------------------------
// addChain
// ---------------------------------------------------------------------------

describe('addChain', () => {
  it('stores a chain by id', () => {
    const chain = makeChain('chain-1');
    useQuestStore.getState().addChain(chain);
    expect(useQuestStore.getState().chains['chain-1']).toEqual(chain);
  });

  it('replaces an existing chain with the same id', () => {
    const chain1 = makeChain('chain-1');
    const chain2 = { ...makeChain('chain-1'), name: 'Updated Chain' };
    useQuestStore.getState().addChain(chain1);
    useQuestStore.getState().addChain(chain2);
    expect(useQuestStore.getState().chains['chain-1'].name).toBe('Updated Chain');
  });

  it('stores multiple chains independently', () => {
    useQuestStore.getState().addChain(makeChain('chain-1'));
    useQuestStore.getState().addChain(makeChain('chain-2'));
    expect(Object.keys(useQuestStore.getState().chains)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// removeChain
// ---------------------------------------------------------------------------

describe('removeChain', () => {
  it('removes a stored chain', () => {
    useQuestStore.getState().addChain(makeChain('chain-1'));
    useQuestStore.getState().removeChain('chain-1');
    expect(useQuestStore.getState().chains['chain-1']).toBeUndefined();
  });

  it('does not throw when chain does not exist', () => {
    expect(() => useQuestStore.getState().removeChain('nonexistent')).not.toThrow();
  });

  it('leaves other chains intact', () => {
    useQuestStore.getState().addChain(makeChain('chain-1'));
    useQuestStore.getState().addChain(makeChain('chain-2'));
    useQuestStore.getState().removeChain('chain-1');
    expect(useQuestStore.getState().chains['chain-2']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// updateObjective
// ---------------------------------------------------------------------------

describe('updateObjective', () => {
  it('patches objective description', () => {
    const chain = makeChain('chain-1', 1);
    const questId = chain.quests[0].id;
    const objectiveId = chain.quests[0].objectives[0].id;
    useQuestStore.getState().addChain(chain);
    useQuestStore.getState().updateObjective('chain-1', questId, objectiveId, {
      description: 'New description',
    });
    const updated = useQuestStore.getState().getQuest('chain-1', questId);
    expect(updated?.objectives[0].description).toBe('New description');
  });

  it('patches required count without touching other fields', () => {
    const chain = makeChain('chain-1', 1);
    const questId = chain.quests[0].id;
    const objectiveId = chain.quests[0].objectives[0].id;
    useQuestStore.getState().addChain(chain);
    useQuestStore.getState().updateObjective('chain-1', questId, objectiveId, {
      required: 10,
    });
    const obj = useQuestStore.getState().getQuest('chain-1', questId)?.objectives[0];
    expect(obj?.required).toBe(10);
    expect(obj?.type).toBe('kill_count');
    expect(obj?.target).toBe('Bandits');
  });

  it('does nothing when chainId does not match', () => {
    const chain = makeChain('chain-1', 1);
    useQuestStore.getState().addChain(chain);
    const before = JSON.stringify(useQuestStore.getState().chains);
    useQuestStore.getState().updateObjective('chain-999', 'x', 'y', { required: 99 });
    expect(JSON.stringify(useQuestStore.getState().chains)).toBe(before);
  });

  it('patches optional flag', () => {
    const chain = makeChain('chain-1', 1);
    const questId = chain.quests[0].id;
    const objectiveId = chain.quests[0].objectives[0].id;
    useQuestStore.getState().addChain(chain);
    useQuestStore.getState().updateObjective('chain-1', questId, objectiveId, {
      optional: true,
    });
    const obj = useQuestStore.getState().getQuest('chain-1', questId)?.objectives[0];
    expect(obj?.optional).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateQuest
// ---------------------------------------------------------------------------

describe('updateQuest', () => {
  it('patches quest title', () => {
    const chain = makeChain('chain-1', 1);
    const questId = chain.quests[0].id;
    useQuestStore.getState().addChain(chain);
    useQuestStore.getState().updateQuest('chain-1', questId, { title: 'New Title' });
    expect(useQuestStore.getState().getQuest('chain-1', questId)?.title).toBe('New Title');
  });

  it('patches quest status', () => {
    const chain = makeChain('chain-1', 2);
    const questId = chain.quests[1].id;
    useQuestStore.getState().addChain(chain);
    useQuestStore.getState().updateQuest('chain-1', questId, { status: 'active' });
    expect(useQuestStore.getState().getQuest('chain-1', questId)?.status).toBe('active');
  });

  it('does nothing when chainId does not match', () => {
    const chain = makeChain('chain-1', 1);
    useQuestStore.getState().addChain(chain);
    const before = JSON.stringify(useQuestStore.getState().chains);
    useQuestStore.getState().updateQuest('chain-999', 'x', { title: 'nope' });
    expect(JSON.stringify(useQuestStore.getState().chains)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// clearAll
// ---------------------------------------------------------------------------

describe('clearAll', () => {
  it('removes all chains', () => {
    useQuestStore.getState().addChain(makeChain('chain-1'));
    useQuestStore.getState().addChain(makeChain('chain-2'));
    useQuestStore.getState().clearAll();
    expect(Object.keys(useQuestStore.getState().chains)).toHaveLength(0);
  });

  it('is safe to call on empty store', () => {
    expect(() => useQuestStore.getState().clearAll()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

describe('getChain', () => {
  it('returns the chain when it exists', () => {
    const chain = makeChain('chain-1');
    useQuestStore.getState().addChain(chain);
    expect(useQuestStore.getState().getChain('chain-1')).toEqual(chain);
  });

  it('returns undefined for unknown chainId', () => {
    expect(useQuestStore.getState().getChain('nope')).toBeUndefined();
  });
});

describe('getQuest', () => {
  it('returns the quest when both ids match', () => {
    const chain = makeChain('chain-1', 2);
    useQuestStore.getState().addChain(chain);
    const questId = chain.quests[1].id;
    expect(useQuestStore.getState().getQuest('chain-1', questId)).toEqual(chain.quests[1]);
  });

  it('returns undefined when chain not found', () => {
    expect(useQuestStore.getState().getQuest('bad-chain', 'q1')).toBeUndefined();
  });

  it('returns undefined when quest not found in chain', () => {
    const chain = makeChain('chain-1', 1);
    useQuestStore.getState().addChain(chain);
    expect(useQuestStore.getState().getQuest('chain-1', 'nonexistent-quest')).toBeUndefined();
  });
});

describe('listChains', () => {
  it('returns all chains as array', () => {
    useQuestStore.getState().addChain(makeChain('chain-1'));
    useQuestStore.getState().addChain(makeChain('chain-2'));
    expect(useQuestStore.getState().listChains()).toHaveLength(2);
  });

  it('returns empty array when no chains', () => {
    expect(useQuestStore.getState().listChains()).toEqual([]);
  });
});
