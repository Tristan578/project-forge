import { describe, it, expect } from 'vitest';
import {
  generateQuestChain,
  validateGenerateOptions,
  validateQuest,
  validateQuestChain,
  exportQuestChainToScript,
  CHAIN_TEMPLATES,
  type GenerateOptions,
  type QuestChain,
  type ChainTemplateId,
} from '../questGenerator';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function defaultOptions(overrides?: Partial<GenerateOptions>): GenerateOptions {
  return {
    templateId: 'hero_origin',
    playerDescription: 'brave adventurer',
    difficulty: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Chain Templates
// ---------------------------------------------------------------------------

describe('CHAIN_TEMPLATES', () => {
  it('has exactly 5 templates', () => {
    expect(Object.keys(CHAIN_TEMPLATES)).toHaveLength(5);
  });

  it('each template has matching questTypes length to questCount', () => {
    for (const template of Object.values(CHAIN_TEMPLATES)) {
      expect(template.questTypes.length).toBeLessThanOrEqual(template.questCount);
      expect(template.questTypes.length).toBeGreaterThan(0);
    }
  });

  it('each template has all required fields', () => {
    for (const template of Object.values(CHAIN_TEMPLATES)) {
      expect(template.id).not.toBe('');
      expect(template.name).not.toBe('');
      expect(template.description).not.toBe('');
      expect(template.arcDescription).not.toBe('');
      expect(template.questCount).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Validation: GenerateOptions
// ---------------------------------------------------------------------------

describe('validateGenerateOptions', () => {
  it('returns no errors for valid options', () => {
    const errors = validateGenerateOptions(defaultOptions());
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid templateId', () => {
    const errors = validateGenerateOptions(
      defaultOptions({ templateId: 'nonexistent' as ChainTemplateId }),
    );
    expect(errors.some((e) => e.includes('templateId'))).toBe(true);
  });

  it('rejects empty playerDescription', () => {
    const errors = validateGenerateOptions(defaultOptions({ playerDescription: '' }));
    expect(errors.some((e) => e.includes('playerDescription'))).toBe(true);
  });

  it('rejects whitespace-only playerDescription', () => {
    const errors = validateGenerateOptions(defaultOptions({ playerDescription: '   ' }));
    expect(errors.some((e) => e.includes('playerDescription'))).toBe(true);
  });

  it('rejects playerDescription over 200 characters', () => {
    const errors = validateGenerateOptions(
      defaultOptions({ playerDescription: 'x'.repeat(201) }),
    );
    expect(errors.some((e) => e.includes('200'))).toBe(true);
  });

  it('rejects difficulty below 1', () => {
    const errors = validateGenerateOptions(defaultOptions({ difficulty: 0 }));
    expect(errors.some((e) => e.includes('difficulty'))).toBe(true);
  });

  it('rejects difficulty above 10', () => {
    const errors = validateGenerateOptions(defaultOptions({ difficulty: 11 }));
    expect(errors.some((e) => e.includes('difficulty'))).toBe(true);
  });

  it('rejects questCount below 1', () => {
    const errors = validateGenerateOptions(defaultOptions({ questCount: 0 }));
    expect(errors.some((e) => e.includes('questCount'))).toBe(true);
  });

  it('rejects questCount above 20', () => {
    const errors = validateGenerateOptions(defaultOptions({ questCount: 21 }));
    expect(errors.some((e) => e.includes('questCount'))).toBe(true);
  });

  it('allows undefined questCount', () => {
    const errors = validateGenerateOptions(defaultOptions({ questCount: undefined }));
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Validation: Quest
// ---------------------------------------------------------------------------

describe('validateQuest', () => {
  it('returns no errors for a valid quest', () => {
    const chain = generateQuestChain(defaultOptions());
    const errors = validateQuest(chain.quests[0]);
    expect(errors).toHaveLength(0);
  });

  it('reports missing id', () => {
    const chain = generateQuestChain(defaultOptions());
    const quest = { ...chain.quests[0], id: '' };
    expect(validateQuest(quest).some((e) => e.includes('id'))).toBe(true);
  });

  it('reports missing objectives', () => {
    const chain = generateQuestChain(defaultOptions());
    const quest = { ...chain.quests[0], objectives: [] };
    expect(validateQuest(quest).some((e) => e.includes('objective'))).toBe(true);
  });

  it('reports missing rewards', () => {
    const chain = generateQuestChain(defaultOptions());
    const quest = { ...chain.quests[0], rewards: [] };
    expect(validateQuest(quest).some((e) => e.includes('reward'))).toBe(true);
  });

  it('reports level below 1', () => {
    const chain = generateQuestChain(defaultOptions());
    const quest = { ...chain.quests[0], level: 0 };
    expect(validateQuest(quest).some((e) => e.includes('level'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Validation: QuestChain
// ---------------------------------------------------------------------------

describe('validateQuestChain', () => {
  it('returns no errors for a valid chain', () => {
    const chain = generateQuestChain(defaultOptions());
    const errors = validateQuestChain(chain);
    expect(errors).toHaveLength(0);
  });

  it('reports missing chain id', () => {
    const chain = generateQuestChain(defaultOptions());
    const bad: QuestChain = { ...chain, id: '' };
    expect(validateQuestChain(bad).some((e) => e.includes('Chain must have an id'))).toBe(true);
  });

  it('reports empty quests array', () => {
    const chain = generateQuestChain(defaultOptions());
    const bad: QuestChain = { ...chain, quests: [] };
    expect(validateQuestChain(bad).some((e) => e.includes('at least one quest'))).toBe(true);
  });

  it('reports duplicate quest ids', () => {
    const chain = generateQuestChain(defaultOptions());
    const duped: QuestChain = {
      ...chain,
      quests: [chain.quests[0], { ...chain.quests[0] }],
    };
    expect(validateQuestChain(duped).some((e) => e.includes('Duplicate'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

describe('generateQuestChain', () => {
  it('generates a chain with the correct number of quests for hero_origin', () => {
    const chain = generateQuestChain(defaultOptions());
    expect(chain.quests).toHaveLength(5);
  });

  it('generates a chain with custom questCount', () => {
    const chain = generateQuestChain(defaultOptions({ questCount: 3 }));
    expect(chain.quests).toHaveLength(3);
  });

  it('generates for all 5 templates without error', () => {
    const templateIds: ChainTemplateId[] = [
      'hero_origin',
      'mystery_investigation',
      'faction_loyalty',
      'resource_expedition',
      'revenge_arc',
    ];
    for (const templateId of templateIds) {
      const chain = generateQuestChain(defaultOptions({ templateId }));
      expect(chain.quests.length).toBeGreaterThan(0);
      expect(chain.templateId).toBe(templateId);
    }
  });

  it('first quest is available, rest are locked', () => {
    const chain = generateQuestChain(defaultOptions());
    expect(chain.quests[0].status).toBe('available');
    for (let i = 1; i < chain.quests.length; i++) {
      expect(chain.quests[i].status).toBe('locked');
    }
  });

  it('each quest after first has prerequisite pointing to previous quest', () => {
    const chain = generateQuestChain(defaultOptions());
    for (let i = 1; i < chain.quests.length; i++) {
      expect(chain.quests[i].prerequisites).toContain(chain.quests[i - 1].id);
    }
  });

  it('all quests have at least one objective', () => {
    const chain = generateQuestChain(defaultOptions());
    for (const quest of chain.quests) {
      expect(quest.objectives.length).toBeGreaterThan(0);
    }
  });

  it('all quests have at least 2 rewards (xp + gold)', () => {
    const chain = generateQuestChain(defaultOptions());
    for (const quest of chain.quests) {
      expect(quest.rewards.length).toBeGreaterThanOrEqual(2);
      expect(quest.rewards.some((r) => r.type === 'experience')).toBe(true);
      expect(quest.rewards.some((r) => r.type === 'gold')).toBe(true);
    }
  });

  it('later quests have bonus item rewards', () => {
    const chain = generateQuestChain(defaultOptions());
    const lastQuest = chain.quests[chain.quests.length - 1];
    expect(lastQuest.rewards.some((r) => r.type === 'item')).toBe(true);
  });

  it('quest levels increase with index', () => {
    const chain = generateQuestChain(defaultOptions({ difficulty: 2 }));
    for (let i = 1; i < chain.quests.length; i++) {
      expect(chain.quests[i].level).toBeGreaterThanOrEqual(chain.quests[i - 1].level);
    }
  });

  it('all quests have giverNpc and location', () => {
    const chain = generateQuestChain(defaultOptions());
    for (const quest of chain.quests) {
      expect(quest.giverNpc).not.toBe('');
      expect(quest.location).not.toBe('');
    }
  });

  it('produces deterministic output for same input', () => {
    const chain1 = generateQuestChain(defaultOptions());
    const chain2 = generateQuestChain(defaultOptions());
    // Everything except createdAt should match
    expect(chain1.quests.map((q) => q.id)).toEqual(chain2.quests.map((q) => q.id));
    expect(chain1.quests.map((q) => q.title)).toEqual(chain2.quests.map((q) => q.title));
  });

  it('different descriptions produce different chains', () => {
    const chain1 = generateQuestChain(defaultOptions({ playerDescription: 'warrior' }));
    const chain2 = generateQuestChain(defaultOptions({ playerDescription: 'mage' }));
    expect(chain1.id).not.toBe(chain2.id);
  });

  it('throws on invalid options', () => {
    expect(() =>
      generateQuestChain(defaultOptions({ difficulty: 0 })),
    ).toThrow('Invalid options');
  });

  it('chain name includes template name and description', () => {
    const chain = generateQuestChain(defaultOptions());
    expect(chain.name).toContain('Hero Origin');
    expect(chain.name).toContain('brave adventurer');
  });

  it('first quest has a narrative hook from the template pool', () => {
    const chain = generateQuestChain(defaultOptions());
    expect(chain.quests[0].narrativeHook.length).toBeGreaterThan(10);
  });

  it('resource_expedition generates 4 quests by default', () => {
    const chain = generateQuestChain(
      defaultOptions({ templateId: 'resource_expedition' }),
    );
    expect(chain.quests).toHaveLength(4);
  });

  it('higher difficulty produces higher reward amounts', () => {
    const easy = generateQuestChain(defaultOptions({ difficulty: 1 }));
    const hard = generateQuestChain(defaultOptions({ difficulty: 10 }));
    const easyGold = easy.quests[0].rewards.find((r) => r.type === 'gold')!.amount;
    const hardGold = hard.quests[0].rewards.find((r) => r.type === 'gold')!.amount;
    expect(hardGold).toBeGreaterThan(easyGold);
  });

  it('objectives have correct current = 0', () => {
    const chain = generateQuestChain(defaultOptions());
    for (const quest of chain.quests) {
      for (const obj of quest.objectives) {
        expect(obj.current).toBe(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Script Export
// ---------------------------------------------------------------------------

describe('exportQuestChainToScript', () => {
  it('produces valid JavaScript-like output', () => {
    const chain = generateQuestChain(defaultOptions());
    const script = exportQuestChainToScript(chain);
    expect(script).toContain('const questChain');
    expect(script).toContain('function getActiveQuest');
    expect(script).toContain('function completeQuest');
  });

  it('includes all quest ids in the output', () => {
    const chain = generateQuestChain(defaultOptions());
    const script = exportQuestChainToScript(chain);
    for (const quest of chain.quests) {
      expect(script).toContain(quest.id);
    }
  });

  it('includes template info in header comment', () => {
    const chain = generateQuestChain(defaultOptions());
    const script = exportQuestChainToScript(chain);
    expect(script).toContain('hero_origin');
    expect(script).toContain('Auto-generated Quest Chain Script');
  });

  it('escapes special characters in strings', () => {
    const chain = generateQuestChain(defaultOptions());
    // Modify a quest title to include quotes
    chain.quests[0].title = 'The "Big" Quest';
    const script = exportQuestChainToScript(chain);
    expect(script).toContain('The \\"Big\\" Quest');
  });

  it('includes objective and reward data', () => {
    const chain = generateQuestChain(defaultOptions());
    const script = exportQuestChainToScript(chain);
    expect(script).toContain('objectives:');
    expect(script).toContain('rewards:');
    expect(script).toContain('experience');
    expect(script).toContain('gold');
  });
});
