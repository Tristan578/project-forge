import { describe, it, expect } from 'vitest';
import {
  validateBalance,
  economyToScript,
  generateEconomy,
  ECONOMY_PRESETS,
  type GameEconomy,
  type Currency,
  type ShopItem,
  type LootTable,
  type LootEntry,
  type ProgressionCurve,
  type BalanceReport,
} from '../economyDesigner';

// ---------------------------------------------------------------------------
// Type smoke tests
// ---------------------------------------------------------------------------

describe('Economy types', () => {
  it('Currency type has required fields', () => {
    const c: Currency = { name: 'Gold', icon: 'coin', earnRate: 10, sinks: ['shop'] };
    expect(c.name).toBe('Gold');
    expect(c.earnRate).toBe(10);
  });

  it('ShopItem supports optional stats', () => {
    const item: ShopItem = { name: 'Sword', category: 'weapon', price: 100, currency: 'Gold', unlockLevel: 1 };
    expect(item.stats).toBeUndefined();

    const itemWithStats: ShopItem = { ...item, stats: { attack: 5 } };
    expect(itemWithStats.stats?.attack).toBe(5);
  });

  it('LootEntry requires weight and quantity bounds', () => {
    const entry: LootEntry = { item: 'Gold', weight: 50, minQuantity: 1, maxQuantity: 10 };
    expect(entry.weight).toBe(50);
    expect(entry.minQuantity).toBeLessThanOrEqual(entry.maxQuantity);
  });

  it('LootTable supports guaranteed drops', () => {
    const table: LootTable = {
      name: 'Boss',
      entries: [{ item: 'Gold', weight: 100, minQuantity: 10, maxQuantity: 20 }],
      guaranteedDrops: ['Gold'],
    };
    expect(table.guaranteedDrops).toContain('Gold');
  });

  it('ProgressionCurve has matching array lengths', () => {
    const curve: ProgressionCurve = {
      levels: 3,
      xpPerLevel: [100, 200, 300],
      rewardsPerLevel: [
        { currency: 'Gold', amount: 10 },
        { currency: 'Gold', amount: 20 },
        { currency: 'Gold', amount: 30 },
      ],
    };
    expect(curve.xpPerLevel.length).toBe(curve.levels);
  });
});

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

describe('ECONOMY_PRESETS', () => {
  it('contains all 5 presets', () => {
    const keys = Object.keys(ECONOMY_PRESETS);
    expect(keys).toContain('casual_mobile');
    expect(keys).toContain('rpg_classic');
    expect(keys).toContain('roguelike');
    expect(keys).toContain('idle_incremental');
    expect(keys).toContain('competitive_pvp');
    expect(keys).toHaveLength(5);
  });

  it.each(Object.entries(ECONOMY_PRESETS))('%s has valid structure', (_name, economy) => {
    expect(economy.currencies.length).toBeGreaterThan(0);
    expect(economy.shop.length).toBeGreaterThan(0);
    expect(economy.lootTables.length).toBeGreaterThan(0);
    expect(economy.progression.levels).toBeGreaterThan(0);
    expect(economy.progression.xpPerLevel.length).toBe(economy.progression.levels);
    expect(economy.balanceScore).toBeGreaterThanOrEqual(0);
    expect(economy.balanceScore).toBeLessThanOrEqual(100);
  });

  it('casual_mobile has single currency', () => {
    expect(ECONOMY_PRESETS.casual_mobile.currencies).toHaveLength(1);
    expect(ECONOMY_PRESETS.casual_mobile.currencies[0].name).toBe('Coins');
  });

  it('rpg_classic has gold and gems', () => {
    const names = ECONOMY_PRESETS.rpg_classic.currencies.map((c) => c.name);
    expect(names).toContain('Gold');
    expect(names).toContain('Gems');
  });

  it('competitive_pvp has only cosmetic shop items', () => {
    for (const item of ECONOMY_PRESETS.competitive_pvp.shop) {
      expect(item.category).toBe('cosmetic');
    }
  });

  it('idle_incremental has three currencies', () => {
    expect(ECONOMY_PRESETS.idle_incremental.currencies).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validateBalance', () => {
  function makeValidEconomy(): GameEconomy {
    return {
      currencies: [{ name: 'Gold', icon: 'coin', earnRate: 10, sinks: ['shop'] }],
      shop: [{ name: 'Sword', category: 'weapon', price: 100, currency: 'Gold', unlockLevel: 1 }],
      lootTables: [
        {
          name: 'Drops',
          entries: [{ item: 'Gold', weight: 100, minQuantity: 1, maxQuantity: 5 }],
        },
      ],
      progression: {
        levels: 5,
        xpPerLevel: [100, 200, 300, 400, 500],
        rewardsPerLevel: [
          { currency: 'Gold', amount: 10 },
          { currency: 'Gold', amount: 20 },
          { currency: 'Gold', amount: 30 },
          { currency: 'Gold', amount: 40 },
          { currency: 'Gold', amount: 50 },
        ],
      },
      balanceScore: 80,
    };
  }

  it('passes for valid economy', () => {
    const report = validateBalance(makeValidEconomy());
    expect(report.passed).toBe(true);
    expect(report.score).toBeGreaterThan(0);
  });

  it('detects missing currency reference', () => {
    const eco = makeValidEconomy();
    eco.shop[0].currency = 'Diamonds';
    const report = validateBalance(eco);
    expect(report.passed).toBe(false);
    expect(report.issues.some((i) => i.type === 'missing_currency')).toBe(true);
  });

  it('detects negative earn rate', () => {
    const eco = makeValidEconomy();
    eco.currencies[0].earnRate = -5;
    const report = validateBalance(eco);
    expect(report.issues.some((i) => i.type === 'negative_value')).toBe(true);
  });

  it('detects negative shop price', () => {
    const eco = makeValidEconomy();
    eco.shop[0].price = -10;
    const report = validateBalance(eco);
    expect(report.issues.some((i) => i.type === 'negative_value')).toBe(true);
  });

  it('detects unreachable content', () => {
    const eco = makeValidEconomy();
    eco.shop[0].unlockLevel = 999;
    const report = validateBalance(eco);
    expect(report.issues.some((i) => i.type === 'unreachable_content')).toBe(true);
  });

  it('detects empty loot table', () => {
    const eco = makeValidEconomy();
    eco.lootTables = [{ name: 'Empty', entries: [] }];
    const report = validateBalance(eco);
    expect(report.issues.some((i) => i.type === 'empty_loot_table')).toBe(true);
  });

  it('detects XP curve mismatch', () => {
    const eco = makeValidEconomy();
    eco.progression.xpPerLevel = [100, 200]; // only 2 but levels = 5
    const report = validateBalance(eco);
    expect(report.issues.some((i) => i.type === 'xp_curve_mismatch')).toBe(true);
  });

  it('detects currency with no sinks', () => {
    const eco = makeValidEconomy();
    eco.currencies[0].sinks = [];
    const report = validateBalance(eco);
    expect(report.issues.some((i) => i.type === 'no_sink')).toBe(true);
  });

  it('detects weight imbalance in loot table', () => {
    const eco = makeValidEconomy();
    eco.lootTables = [
      {
        name: 'Skewed',
        entries: [
          { item: 'Gold', weight: 95, minQuantity: 1, maxQuantity: 1 },
          { item: 'Rare', weight: 5, minQuantity: 1, maxQuantity: 1 },
        ],
      },
    ];
    const report = validateBalance(eco);
    expect(report.issues.some((i) => i.type === 'weight_imbalance')).toBe(true);
  });

  it('detects dead-end items', () => {
    const eco = makeValidEconomy();
    eco.shop.push({
      name: 'Orphan Item',
      category: 'misc',
      price: 50,
      currency: 'Gold',
      unlockLevel: 1,
    });
    const report = validateBalance(eco);
    expect(report.issues.some((i) => i.type === 'dead_end_item')).toBe(true);
  });

  it('detects inflation risk', () => {
    const eco = makeValidEconomy();
    eco.currencies[0].earnRate = 99999;
    eco.shop[0].price = 10;
    const report = validateBalance(eco);
    expect(report.issues.some((i) => i.type === 'inflation_risk')).toBe(true);
  });

  it('score decreases with errors and warnings', () => {
    const eco = makeValidEconomy();
    eco.shop[0].currency = 'Diamonds'; // error
    eco.currencies[0].sinks = []; // warning
    const report = validateBalance(eco);
    expect(report.score).toBeLessThan(100);
  });

  it('score is clamped to 0-100', () => {
    const eco = makeValidEconomy();
    // Create many errors
    for (let i = 0; i < 10; i++) {
      eco.shop.push({ name: `Bad${i}`, category: 'x', price: -1, currency: 'None', unlockLevel: -1 });
    }
    const report = validateBalance(eco);
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });

  it('detects negative loot weight', () => {
    const eco = makeValidEconomy();
    eco.lootTables[0].entries[0].weight = -5;
    const report = validateBalance(eco);
    expect(report.issues.some((i) => i.type === 'negative_value')).toBe(true);
  });

  it('detects min > max quantity', () => {
    const eco = makeValidEconomy();
    eco.lootTables[0].entries[0].minQuantity = 10;
    eco.lootTables[0].entries[0].maxQuantity = 1;
    const report = validateBalance(eco);
    expect(report.issues.some((i) => i.type === 'negative_value')).toBe(true);
  });

  it('all presets pass validation', () => {
    for (const [name, economy] of Object.entries(ECONOMY_PRESETS)) {
      const report = validateBalance(economy);
      expect(report.passed).toBe(true);
      // Capture preset name in assertion message
      expect(report.score).toBeGreaterThan(0);
      void name;
    }
  });

  it('returns BalanceReport with correct shape', () => {
    const report: BalanceReport = validateBalance(makeValidEconomy());
    expect(typeof report.score).toBe('number');
    expect(Array.isArray(report.issues)).toBe(true);
    expect(typeof report.passed).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// Script generation
// ---------------------------------------------------------------------------

describe('economyToScript', () => {
  it('generates valid JavaScript', () => {
    const script = economyToScript(ECONOMY_PRESETS.casual_mobile);
    expect(script).toContain('const currencies');
    expect(script).toContain('const shopItems');
    expect(script).toContain('const lootTables');
    expect(script).toContain('function buyItem');
    expect(script).toContain('function rollLootTable');
    expect(script).toContain('function addXp');
  });

  it('includes wallet management', () => {
    const script = economyToScript(ECONOMY_PRESETS.casual_mobile);
    expect(script).toContain('const wallet');
    expect(script).toContain('function earnCurrency');
    expect(script).toContain('function getWallet');
  });

  it('includes progression helpers', () => {
    const script = economyToScript(ECONOMY_PRESETS.rpg_classic);
    expect(script).toContain('function getLevel');
    expect(script).toContain('function getXp');
    expect(script).toContain('function getXpToNextLevel');
  });

  it('contains currency data from preset', () => {
    const script = economyToScript(ECONOMY_PRESETS.rpg_classic);
    expect(script).toContain('"Gold"');
    expect(script).toContain('"Gems"');
  });

  it('contains shop items from preset', () => {
    const script = economyToScript(ECONOMY_PRESETS.rpg_classic);
    expect(script).toContain('Iron Sword');
    expect(script).toContain('Health Potion');
  });
});

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

describe('generateEconomy', () => {
  it('returns matching preset when specified', async () => {
    const eco = await generateEconomy('anything', 'roguelike');
    expect(eco.currencies[0].name).toBe('Souls');
  });

  it('selects idle preset for idle descriptions', async () => {
    const eco = await generateEconomy('An idle clicker game');
    expect(eco.currencies.length).toBe(3);
    expect(eco.currencies.some((c) => c.name === 'Prestige Points')).toBe(true);
  });

  it('selects roguelike preset for roguelike descriptions', async () => {
    const eco = await generateEconomy('A roguelike dungeon crawler with permadeath');
    expect(eco.currencies[0].name).toBe('Souls');
  });

  it('selects pvp preset for competitive descriptions', async () => {
    const eco = await generateEconomy('A competitive PVP arena');
    expect(eco.currencies.some((c) => c.name === 'Ranking Points')).toBe(true);
  });

  it('selects rpg preset for adventure descriptions', async () => {
    const eco = await generateEconomy('An RPG with quests and exploration');
    expect(eco.currencies.some((c) => c.name === 'Gold')).toBe(true);
  });

  it('defaults to casual_mobile for generic descriptions', async () => {
    const eco = await generateEconomy('A fun game');
    expect(eco.currencies[0].name).toBe('Coins');
    expect(eco.currencies).toHaveLength(1);
  });

  it('returns a deep copy (not a reference)', async () => {
    const eco1 = await generateEconomy('test', 'casual_mobile');
    const eco2 = await generateEconomy('test', 'casual_mobile');
    eco1.currencies[0].name = 'Modified';
    expect(eco2.currencies[0].name).toBe('Coins');
    expect(ECONOMY_PRESETS.casual_mobile.currencies[0].name).toBe('Coins');
  });
});
