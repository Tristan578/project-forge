/**
 * Tests for questHandlers — generate, list, get, update objective, delete.
 *
 * The questStore is mocked so tests are isolated from Zustand internals.
 * The questGenerator is mocked so generation tests don't rely on seeded
 * determinism or internal data tables.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { questHandlers } from '../questHandlers';
import type { QuestChain, Quest, Objective } from '@/stores/questStore';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_OBJECTIVE: Objective = {
  id: 'obj-001',
  type: 'kill_count',
  description: 'Defeat 5 Shadow Wolves',
  target: 'Shadow Wolves',
  required: 5,
  current: 0,
  optional: false,
};

const SAMPLE_QUEST: Quest = {
  id: 'quest-001',
  title: 'The Call to Arms',
  description: 'An unexpected event thrusts you into danger.',
  type: 'kill',
  status: 'available',
  level: 1,
  objectives: [SAMPLE_OBJECTIVE],
  rewards: [
    { type: 'experience', name: 'Experience', amount: 150 },
    { type: 'gold', name: 'Gold', amount: 60 },
  ],
  prerequisites: [],
  narrativeHook: 'A stranger arrives with an urgent plea for help.',
  giverNpc: 'Elder Maren',
  location: 'Silverbrook Village',
};

const SAMPLE_CHAIN: QuestChain = {
  id: 'chain-abc',
  name: 'Hero Origin: brave adventurer',
  description: 'A classic hero journey.',
  templateId: 'hero_origin',
  quests: [SAMPLE_QUEST],
  createdAt: 1711000000000,
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAddChain = vi.fn();
const mockRemoveChain = vi.fn();
const mockUpdateObjective = vi.fn();
const mockGetChain = vi.fn();
const mockGetQuest = vi.fn();
const mockListChains = vi.fn();

vi.mock('@/stores/questStore', () => ({
  useQuestStore: {
    getState: () => ({
      addChain: (...args: unknown[]) => mockAddChain(...args),
      removeChain: (...args: unknown[]) => mockRemoveChain(...args),
      updateObjective: (...args: unknown[]) => mockUpdateObjective(...args),
      getChain: (...args: unknown[]) => mockGetChain(...args),
      getQuest: (...args: unknown[]) => mockGetQuest(...args),
      listChains: () => mockListChains(),
    }),
  },
}));

const mockGenerateQuestChain = vi.fn();
const mockValidateQuestChain = vi.fn();

vi.mock('@/lib/ai/questGenerator', () => ({
  generateQuestChain: (...args: unknown[]) => mockGenerateQuestChain(...args),
  validateQuestChain: (...args: unknown[]) => mockValidateQuestChain(...args),
}));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateQuestChain.mockReturnValue(SAMPLE_CHAIN);
  mockValidateQuestChain.mockReturnValue([]);
  mockGetChain.mockReturnValue(SAMPLE_CHAIN);
  mockGetQuest.mockReturnValue(SAMPLE_QUEST);
  mockListChains.mockReturnValue([SAMPLE_CHAIN]);
});

// ---------------------------------------------------------------------------
// generate_quest
// ---------------------------------------------------------------------------

describe('generate_quest', () => {
  it('returns chainId and quest summary on success', async () => {
    const { result } = await invokeHandler(questHandlers, 'generate_quest', {
      templateId: 'hero_origin',
      playerDescription: 'brave adventurer',
      difficulty: 3,
    });
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(data.chainId).toBe('chain-abc');
    expect(data.questCount).toBe(1);
    expect(Array.isArray(data.quests)).toBe(true);
  });

  it('calls addChain with the generated chain', async () => {
    await invokeHandler(questHandlers, 'generate_quest', {
      templateId: 'hero_origin',
      playerDescription: 'brave adventurer',
      difficulty: 3,
    });
    expect(mockAddChain).toHaveBeenCalledWith(SAMPLE_CHAIN);
  });

  it('accepts optional questCount', async () => {
    await invokeHandler(questHandlers, 'generate_quest', {
      templateId: 'mystery_investigation',
      playerDescription: 'detective',
      difficulty: 5,
      questCount: 3,
    });
    expect(mockGenerateQuestChain).toHaveBeenCalledWith(
      expect.objectContaining({ questCount: 3 }),
    );
  });

  it('fails validation on missing templateId', async () => {
    const { result } = await invokeHandler(questHandlers, 'generate_quest', {
      playerDescription: 'brave adventurer',
      difficulty: 3,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments');
  });

  it('fails validation on invalid templateId', async () => {
    const { result } = await invokeHandler(questHandlers, 'generate_quest', {
      templateId: 'nonexistent_template',
      playerDescription: 'brave adventurer',
      difficulty: 3,
    });
    expect(result.success).toBe(false);
  });

  it('fails validation on missing playerDescription', async () => {
    const { result } = await invokeHandler(questHandlers, 'generate_quest', {
      templateId: 'hero_origin',
      difficulty: 3,
    });
    expect(result.success).toBe(false);
  });

  it('fails validation on playerDescription too long (>200 chars)', async () => {
    const { result } = await invokeHandler(questHandlers, 'generate_quest', {
      templateId: 'hero_origin',
      playerDescription: 'x'.repeat(201),
      difficulty: 3,
    });
    expect(result.success).toBe(false);
  });

  it('fails validation on difficulty below 1', async () => {
    const { result } = await invokeHandler(questHandlers, 'generate_quest', {
      templateId: 'hero_origin',
      playerDescription: 'brave adventurer',
      difficulty: 0,
    });
    expect(result.success).toBe(false);
  });

  it('fails validation on difficulty above 10', async () => {
    const { result } = await invokeHandler(questHandlers, 'generate_quest', {
      templateId: 'hero_origin',
      playerDescription: 'brave adventurer',
      difficulty: 11,
    });
    expect(result.success).toBe(false);
  });

  it('fails validation on questCount above 20', async () => {
    const { result } = await invokeHandler(questHandlers, 'generate_quest', {
      templateId: 'hero_origin',
      playerDescription: 'brave adventurer',
      difficulty: 3,
      questCount: 21,
    });
    expect(result.success).toBe(false);
  });

  it('returns error when generator throws', async () => {
    mockGenerateQuestChain.mockImplementation(() => {
      throw new Error('Invalid options: difficulty must be ...');
    });
    const { result } = await invokeHandler(questHandlers, 'generate_quest', {
      templateId: 'hero_origin',
      playerDescription: 'brave adventurer',
      difficulty: 3,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid options');
  });

  it('returns error when generated chain fails validation', async () => {
    mockValidateQuestChain.mockReturnValue(['Quest must have an id', 'Quest must have a title']);
    const { result } = await invokeHandler(questHandlers, 'generate_quest', {
      templateId: 'hero_origin',
      playerDescription: 'brave adventurer',
      difficulty: 3,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('validation');
  });

  it('does not call addChain when generator throws', async () => {
    mockGenerateQuestChain.mockImplementation(() => { throw new Error('fail'); });
    await invokeHandler(questHandlers, 'generate_quest', {
      templateId: 'hero_origin',
      playerDescription: 'brave adventurer',
      difficulty: 3,
    });
    expect(mockAddChain).not.toHaveBeenCalled();
  });

  it('accepts all 5 valid template ids', async () => {
    const templates = [
      'hero_origin',
      'mystery_investigation',
      'faction_loyalty',
      'resource_expedition',
      'revenge_arc',
    ];
    for (const templateId of templates) {
      vi.clearAllMocks();
      mockGenerateQuestChain.mockReturnValue(SAMPLE_CHAIN);
      mockValidateQuestChain.mockReturnValue([]);
      const { result } = await invokeHandler(questHandlers, 'generate_quest', {
        templateId,
        playerDescription: 'test hero',
        difficulty: 5,
      });
      expect(result.success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// list_quests
// ---------------------------------------------------------------------------

describe('list_quests', () => {
  it('returns chain summaries', async () => {
    const { result } = await invokeHandler(questHandlers, 'list_quests', {});
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(data.total).toBe(1);
    const chains = data.chains as Array<Record<string, unknown>>;
    expect(chains[0].chainId).toBe('chain-abc');
    expect(chains[0].name).toBe('Hero Origin: brave adventurer');
    expect(chains[0].questCount).toBe(1);
  });

  it('returns empty list when no chains exist', async () => {
    mockListChains.mockReturnValue([]);
    const { result } = await invokeHandler(questHandlers, 'list_quests', {});
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(data.total).toBe(0);
    expect(data.chains).toEqual([]);
  });

  it('includes templateId and createdAt in summary', async () => {
    const { result } = await invokeHandler(questHandlers, 'list_quests', {});
    const chains = (result.result as Record<string, unknown>).chains as Array<Record<string, unknown>>;
    expect(chains[0].templateId).toBe('hero_origin');
    expect(chains[0].createdAt).toBe(1711000000000);
  });
});

// ---------------------------------------------------------------------------
// get_quest
// ---------------------------------------------------------------------------

describe('get_quest', () => {
  it('returns full chain data', async () => {
    const { result } = await invokeHandler(questHandlers, 'get_quest', {
      chainId: 'chain-abc',
    });
    expect(result.success).toBe(true);
    expect(result.result).toEqual(SAMPLE_CHAIN);
  });

  it('returns error for unknown chainId', async () => {
    mockGetChain.mockReturnValue(undefined);
    const { result } = await invokeHandler(questHandlers, 'get_quest', {
      chainId: 'nonexistent',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('fails validation when chainId is missing', async () => {
    const { result } = await invokeHandler(questHandlers, 'get_quest', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments');
  });

  it('fails validation when chainId is empty string', async () => {
    const { result } = await invokeHandler(questHandlers, 'get_quest', {
      chainId: '',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// update_quest_objective
// ---------------------------------------------------------------------------

describe('update_quest_objective', () => {
  it('updates objective description', async () => {
    const { result } = await invokeHandler(questHandlers, 'update_quest_objective', {
      chainId: 'chain-abc',
      questId: 'quest-001',
      objectiveId: 'obj-001',
      description: 'Defeat 10 Shadow Wolves',
    });
    expect(result.success).toBe(true);
    expect(mockUpdateObjective).toHaveBeenCalledWith(
      'chain-abc',
      'quest-001',
      'obj-001',
      expect.objectContaining({ description: 'Defeat 10 Shadow Wolves' }),
    );
  });

  it('updates required count', async () => {
    await invokeHandler(questHandlers, 'update_quest_objective', {
      chainId: 'chain-abc',
      questId: 'quest-001',
      objectiveId: 'obj-001',
      required: 10,
    });
    expect(mockUpdateObjective).toHaveBeenCalledWith(
      'chain-abc',
      'quest-001',
      'obj-001',
      expect.objectContaining({ required: 10 }),
    );
  });

  it('updates optional flag to true', async () => {
    await invokeHandler(questHandlers, 'update_quest_objective', {
      chainId: 'chain-abc',
      questId: 'quest-001',
      objectiveId: 'obj-001',
      optional: true,
    });
    expect(mockUpdateObjective).toHaveBeenCalledWith(
      'chain-abc',
      'quest-001',
      'obj-001',
      expect.objectContaining({ optional: true }),
    );
  });

  it('updates objective type', async () => {
    await invokeHandler(questHandlers, 'update_quest_objective', {
      chainId: 'chain-abc',
      questId: 'quest-001',
      objectiveId: 'obj-001',
      type: 'collect_items',
    });
    expect(mockUpdateObjective).toHaveBeenCalledWith(
      'chain-abc',
      'quest-001',
      'obj-001',
      expect.objectContaining({ type: 'collect_items' }),
    );
  });

  it('returns error when chain not found', async () => {
    mockGetChain.mockReturnValue(undefined);
    const { result } = await invokeHandler(questHandlers, 'update_quest_objective', {
      chainId: 'bad-chain',
      questId: 'quest-001',
      objectiveId: 'obj-001',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error when quest not found in chain', async () => {
    mockGetQuest.mockReturnValue(undefined);
    const { result } = await invokeHandler(questHandlers, 'update_quest_objective', {
      chainId: 'chain-abc',
      questId: 'bad-quest',
      objectiveId: 'obj-001',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('returns error when objective not found in quest', async () => {
    const { result } = await invokeHandler(questHandlers, 'update_quest_objective', {
      chainId: 'chain-abc',
      questId: 'quest-001',
      objectiveId: 'nonexistent-obj',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('fails validation when chainId missing', async () => {
    const { result } = await invokeHandler(questHandlers, 'update_quest_objective', {
      questId: 'quest-001',
      objectiveId: 'obj-001',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments');
  });

  it('fails validation on invalid objective type', async () => {
    const { result } = await invokeHandler(questHandlers, 'update_quest_objective', {
      chainId: 'chain-abc',
      questId: 'quest-001',
      objectiveId: 'obj-001',
      type: 'invalid_type',
    });
    expect(result.success).toBe(false);
  });

  it('does not include undefined values in patch', async () => {
    await invokeHandler(questHandlers, 'update_quest_objective', {
      chainId: 'chain-abc',
      questId: 'quest-001',
      objectiveId: 'obj-001',
      description: 'Updated',
    });
    const call = mockUpdateObjective.mock.calls[0][3] as Record<string, unknown>;
    expect(Object.keys(call)).not.toContain('type');
    expect(Object.keys(call)).not.toContain('required');
  });
});

// ---------------------------------------------------------------------------
// delete_quest
// ---------------------------------------------------------------------------

describe('delete_quest', () => {
  it('removes the chain and returns success message', async () => {
    const { result } = await invokeHandler(questHandlers, 'delete_quest', {
      chainId: 'chain-abc',
    });
    expect(result.success).toBe(true);
    expect(mockRemoveChain).toHaveBeenCalledWith('chain-abc');
    const data = result.result as Record<string, unknown>;
    expect(typeof data.message).toBe('string');
  });

  it('returns error when chain not found', async () => {
    mockGetChain.mockReturnValue(undefined);
    const { result } = await invokeHandler(questHandlers, 'delete_quest', {
      chainId: 'nonexistent',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
    expect(mockRemoveChain).not.toHaveBeenCalled();
  });

  it('fails validation when chainId is missing', async () => {
    const { result } = await invokeHandler(questHandlers, 'delete_quest', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments');
  });

  it('fails validation when chainId is empty string', async () => {
    const { result } = await invokeHandler(questHandlers, 'delete_quest', {
      chainId: '',
    });
    expect(result.success).toBe(false);
  });

  it('includes chain name in success message', async () => {
    const { result } = await invokeHandler(questHandlers, 'delete_quest', {
      chainId: 'chain-abc',
    });
    const data = result.result as Record<string, unknown>;
    expect(data.message).toContain('Hero Origin: brave adventurer');
  });
});
