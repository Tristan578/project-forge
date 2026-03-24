/**
 * Economy Designer — AI-powered in-game economy generation.
 *
 * Provides types, presets, validation, and script generation for
 * balanced in-game economies (currencies, shops, loot tables, progression).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Currency {
  name: string;
  icon: string;
  earnRate: number;
  sinks: string[];
}

export interface ShopItem {
  name: string;
  category: string;
  price: number;
  currency: string;
  unlockLevel: number;
  stats?: Record<string, number>;
}

export interface LootEntry {
  item: string;
  weight: number;
  minQuantity: number;
  maxQuantity: number;
}

export interface LootTable {
  name: string;
  entries: LootEntry[];
  guaranteedDrops?: string[];
}

export interface RewardConfig {
  currency: string;
  amount: number;
  items?: string[];
}

export interface ProgressionCurve {
  levels: number;
  xpPerLevel: number[];
  rewardsPerLevel: RewardConfig[];
}

export interface GameEconomy {
  currencies: Currency[];
  shop: ShopItem[];
  lootTables: LootTable[];
  progression: ProgressionCurve;
  balanceScore: number;
}

// ---------------------------------------------------------------------------
// Balance report
// ---------------------------------------------------------------------------

export type BalanceIssueType =
  | 'inflation_risk'
  | 'dead_end_item'
  | 'unreachable_content'
  | 'empty_loot_table'
  | 'xp_curve_mismatch'
  | 'negative_value'
  | 'missing_currency'
  | 'weight_imbalance'
  | 'no_sink';

export type BalanceSeverity = 'error' | 'warning' | 'info';

export interface BalanceIssue {
  type: BalanceIssueType;
  severity: BalanceSeverity;
  message: string;
}

export interface BalanceReport {
  score: number;
  issues: BalanceIssue[];
  passed: boolean;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const ECONOMY_PRESETS: Record<string, GameEconomy> = {
  casual_mobile: {
    currencies: [
      { name: 'Coins', icon: 'coin', earnRate: 50, sinks: ['shop', 'upgrades'] },
    ],
    shop: [
      { name: 'Speed Boost', category: 'powerup', price: 100, currency: 'Coins', unlockLevel: 1, stats: { speed: 1.5 } },
      { name: 'Shield', category: 'powerup', price: 150, currency: 'Coins', unlockLevel: 2, stats: { defense: 2 } },
      { name: 'Double Jump', category: 'ability', price: 300, currency: 'Coins', unlockLevel: 5, stats: { jumps: 2 } },
      { name: 'Magnet', category: 'powerup', price: 200, currency: 'Coins', unlockLevel: 3, stats: { range: 3 } },
    ],
    lootTables: [
      {
        name: 'Level Reward',
        entries: [
          { item: 'Coins', weight: 70, minQuantity: 10, maxQuantity: 30 },
          { item: 'Speed Boost', weight: 20, minQuantity: 1, maxQuantity: 1 },
          { item: 'Shield', weight: 10, minQuantity: 1, maxQuantity: 1 },
        ],
      },
    ],
    progression: {
      levels: 20,
      xpPerLevel: Array.from({ length: 20 }, (_, i) => 100 + i * 50),
      rewardsPerLevel: Array.from({ length: 20 }, (_, i) => ({
        currency: 'Coins',
        amount: 50 + i * 25,
      })),
    },
    balanceScore: 85,
  },

  rpg_classic: {
    currencies: [
      { name: 'Gold', icon: 'gold', earnRate: 20, sinks: ['shop', 'repairs', 'enchanting'] },
      { name: 'Gems', icon: 'gem', earnRate: 2, sinks: ['premium_shop', 'revives'] },
    ],
    shop: [
      { name: 'Iron Sword', category: 'weapon', price: 100, currency: 'Gold', unlockLevel: 1, stats: { attack: 5 } },
      { name: 'Steel Sword', category: 'weapon', price: 500, currency: 'Gold', unlockLevel: 10, stats: { attack: 15 } },
      { name: 'Leather Armor', category: 'armor', price: 80, currency: 'Gold', unlockLevel: 1, stats: { defense: 3 } },
      { name: 'Chain Mail', category: 'armor', price: 400, currency: 'Gold', unlockLevel: 8, stats: { defense: 10 } },
      { name: 'Health Potion', category: 'consumable', price: 25, currency: 'Gold', unlockLevel: 1, stats: { heal: 50 } },
      { name: 'Revive Scroll', category: 'consumable', price: 5, currency: 'Gems', unlockLevel: 5, stats: { revive: 1 } },
    ],
    lootTables: [
      {
        name: 'Common Monster',
        entries: [
          { item: 'Gold', weight: 60, minQuantity: 5, maxQuantity: 15 },
          { item: 'Health Potion', weight: 25, minQuantity: 1, maxQuantity: 1 },
          { item: 'Leather Armor', weight: 10, minQuantity: 1, maxQuantity: 1 },
          { item: 'Iron Sword', weight: 5, minQuantity: 1, maxQuantity: 1 },
        ],
      },
      {
        name: 'Boss',
        entries: [
          { item: 'Gold', weight: 40, minQuantity: 50, maxQuantity: 100 },
          { item: 'Gems', weight: 20, minQuantity: 1, maxQuantity: 3 },
          { item: 'Steel Sword', weight: 20, minQuantity: 1, maxQuantity: 1 },
          { item: 'Chain Mail', weight: 20, minQuantity: 1, maxQuantity: 1 },
        ],
        guaranteedDrops: ['Gold'],
      },
    ],
    progression: {
      levels: 50,
      xpPerLevel: Array.from({ length: 50 }, (_, i) => Math.round(100 * Math.pow(1.15, i))),
      rewardsPerLevel: Array.from({ length: 50 }, (_, i) => ({
        currency: 'Gold',
        amount: 30 + i * 20,
        items: i % 10 === 0 && i > 0 ? ['Gems'] : undefined,
      })),
    },
    balanceScore: 80,
  },

  roguelike: {
    currencies: [
      { name: 'Souls', icon: 'skull', earnRate: 5, sinks: ['meta_upgrades', 'unlocks'] },
    ],
    shop: [
      { name: 'Extra Health', category: 'meta_upgrade', price: 10, currency: 'Souls', unlockLevel: 1, stats: { maxHp: 10 } },
      { name: 'Dash Range', category: 'meta_upgrade', price: 15, currency: 'Souls', unlockLevel: 1, stats: { dashRange: 1.5 } },
      { name: 'Critical Chance', category: 'meta_upgrade', price: 25, currency: 'Souls', unlockLevel: 5, stats: { critChance: 0.05 } },
      { name: 'Weapon Unlock: Bow', category: 'unlock', price: 50, currency: 'Souls', unlockLevel: 3 },
    ],
    lootTables: [
      {
        name: 'Room Clear',
        entries: [
          { item: 'Souls', weight: 50, minQuantity: 1, maxQuantity: 3 },
          { item: 'Health Pickup', weight: 30, minQuantity: 1, maxQuantity: 1 },
          { item: 'Damage Buff', weight: 15, minQuantity: 1, maxQuantity: 1 },
          { item: 'Shield Buff', weight: 5, minQuantity: 1, maxQuantity: 1 },
        ],
      },
      {
        name: 'Boss Kill',
        entries: [
          { item: 'Souls', weight: 100, minQuantity: 5, maxQuantity: 10 },
        ],
        guaranteedDrops: ['Souls'],
      },
    ],
    progression: {
      levels: 10,
      xpPerLevel: Array.from({ length: 10 }, (_, i) => 50 + i * 30),
      rewardsPerLevel: Array.from({ length: 10 }, (_, i) => ({
        currency: 'Souls',
        amount: 3 + i * 2,
      })),
    },
    balanceScore: 82,
  },

  idle_incremental: {
    currencies: [
      { name: 'Coins', icon: 'coin', earnRate: 100, sinks: ['generators', 'upgrades'] },
      { name: 'Prestige Points', icon: 'star', earnRate: 0, sinks: ['prestige_upgrades'] },
      { name: 'Crystals', icon: 'crystal', earnRate: 1, sinks: ['automation', 'boosts'] },
    ],
    shop: [
      { name: 'Auto-Clicker Lv1', category: 'generator', price: 50, currency: 'Coins', unlockLevel: 1, stats: { cps: 1 } },
      { name: 'Auto-Clicker Lv2', category: 'generator', price: 500, currency: 'Coins', unlockLevel: 5, stats: { cps: 5 } },
      { name: 'Multiplier x2', category: 'upgrade', price: 1000, currency: 'Coins', unlockLevel: 10, stats: { multiplier: 2 } },
      { name: 'Prestige Boost', category: 'prestige_upgrade', price: 5, currency: 'Prestige Points', unlockLevel: 1, stats: { earnMultiplier: 1.5 } },
      { name: 'Offline Earnings', category: 'automation', price: 10, currency: 'Crystals', unlockLevel: 3, stats: { offlineRate: 0.5 } },
    ],
    lootTables: [
      {
        name: 'Milestone Bonus',
        entries: [
          { item: 'Coins', weight: 50, minQuantity: 100, maxQuantity: 500 },
          { item: 'Crystals', weight: 30, minQuantity: 1, maxQuantity: 3 },
          { item: 'Prestige Points', weight: 20, minQuantity: 1, maxQuantity: 1 },
        ],
      },
    ],
    progression: {
      levels: 100,
      xpPerLevel: Array.from({ length: 100 }, (_, i) => Math.round(50 * Math.pow(1.2, i))),
      rewardsPerLevel: Array.from({ length: 100 }, (_, i) => ({
        currency: 'Coins',
        amount: Math.round(100 * Math.pow(1.15, i)),
      })),
    },
    balanceScore: 78,
  },

  competitive_pvp: {
    currencies: [
      { name: 'Ranking Points', icon: 'trophy', earnRate: 10, sinks: ['ranked_rewards'] },
      { name: 'Tokens', icon: 'token', earnRate: 15, sinks: ['cosmetic_shop'] },
    ],
    shop: [
      { name: 'Victory Emote', category: 'cosmetic', price: 100, currency: 'Tokens', unlockLevel: 1 },
      { name: 'Gold Skin', category: 'cosmetic', price: 500, currency: 'Tokens', unlockLevel: 10 },
      { name: 'Diamond Skin', category: 'cosmetic', price: 1000, currency: 'Tokens', unlockLevel: 25 },
      { name: 'Champion Trail', category: 'cosmetic', price: 2000, currency: 'Tokens', unlockLevel: 50 },
    ],
    lootTables: [
      {
        name: 'Match Reward',
        entries: [
          { item: 'Tokens', weight: 60, minQuantity: 5, maxQuantity: 15 },
          { item: 'Ranking Points', weight: 40, minQuantity: 5, maxQuantity: 25 },
        ],
      },
    ],
    progression: {
      levels: 100,
      xpPerLevel: Array.from({ length: 100 }, (_, i) => 200 + i * 100),
      rewardsPerLevel: Array.from({ length: 100 }, (_, i) => ({
        currency: 'Tokens',
        amount: 20 + i * 5,
      })),
    },
    balanceScore: 90,
  },
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateBalance(economy: GameEconomy): BalanceReport {
  const issues: BalanceIssue[] = [];

  // Check for negative values
  for (const currency of economy.currencies) {
    if (currency.earnRate < 0) {
      issues.push({
        type: 'negative_value',
        severity: 'error',
        message: `Currency "${currency.name}" has negative earn rate (${currency.earnRate}).`,
      });
    }
    if (currency.sinks.length === 0) {
      issues.push({
        type: 'no_sink',
        severity: 'warning',
        message: `Currency "${currency.name}" has no sinks — risk of inflation.`,
      });
    }
  }

  // Check shop items reference valid currencies
  const currencyNames = new Set(economy.currencies.map((c) => c.name));
  for (const item of economy.shop) {
    if (!currencyNames.has(item.currency)) {
      issues.push({
        type: 'missing_currency',
        severity: 'error',
        message: `Shop item "${item.name}" references unknown currency "${item.currency}".`,
      });
    }
    if (item.price < 0) {
      issues.push({
        type: 'negative_value',
        severity: 'error',
        message: `Shop item "${item.name}" has negative price (${item.price}).`,
      });
    }
    if (item.unlockLevel < 0) {
      issues.push({
        type: 'negative_value',
        severity: 'error',
        message: `Shop item "${item.name}" has negative unlock level (${item.unlockLevel}).`,
      });
    }
  }

  // Check for unreachable shop items (unlock level > max progression level)
  const maxLevel = economy.progression.levels;
  for (const item of economy.shop) {
    if (item.unlockLevel > maxLevel) {
      issues.push({
        type: 'unreachable_content',
        severity: 'error',
        message: `Shop item "${item.name}" unlocks at level ${item.unlockLevel} but max level is ${maxLevel}.`,
      });
    }
  }

  // Check loot tables
  for (const table of economy.lootTables) {
    if (table.entries.length === 0) {
      issues.push({
        type: 'empty_loot_table',
        severity: 'error',
        message: `Loot table "${table.name}" has no entries.`,
      });
      continue;
    }

    const totalWeight = table.entries.reduce((sum, e) => sum + e.weight, 0);
    const maxWeight = table.entries.reduce((a, e) => (e.weight > a ? e.weight : a), 0);
    if (totalWeight > 0 && maxWeight / totalWeight > 0.9) {
      issues.push({
        type: 'weight_imbalance',
        severity: 'warning',
        message: `Loot table "${table.name}" is heavily skewed — one entry has >${Math.round((maxWeight / totalWeight) * 100)}% weight.`,
      });
    }

    for (const entry of table.entries) {
      if (entry.weight < 0) {
        issues.push({
          type: 'negative_value',
          severity: 'error',
          message: `Loot entry "${entry.item}" in table "${table.name}" has negative weight.`,
        });
      }
      if (entry.minQuantity < 0 || entry.maxQuantity < 0) {
        issues.push({
          type: 'negative_value',
          severity: 'error',
          message: `Loot entry "${entry.item}" in table "${table.name}" has negative quantity.`,
        });
      }
      if (entry.minQuantity > entry.maxQuantity) {
        issues.push({
          type: 'negative_value',
          severity: 'error',
          message: `Loot entry "${entry.item}" in table "${table.name}" has min > max quantity.`,
        });
      }
    }
  }

  // Check XP curve length matches level count
  if (economy.progression.xpPerLevel.length !== economy.progression.levels) {
    issues.push({
      type: 'xp_curve_mismatch',
      severity: 'error',
      message: `XP curve has ${economy.progression.xpPerLevel.length} entries but progression has ${economy.progression.levels} levels.`,
    });
  }

  // Check rewards per level length matches
  if (economy.progression.rewardsPerLevel.length !== economy.progression.levels) {
    issues.push({
      type: 'xp_curve_mismatch',
      severity: 'warning',
      message: `Rewards array has ${economy.progression.rewardsPerLevel.length} entries but progression has ${economy.progression.levels} levels.`,
    });
  }

  // Check for dead-end items (shop items that are never in any loot table and never a reward)
  const allLootItems = new Set<string>();
  for (const table of economy.lootTables) {
    for (const entry of table.entries) {
      allLootItems.add(entry.item);
    }
    if (table.guaranteedDrops) {
      for (const drop of table.guaranteedDrops) {
        allLootItems.add(drop);
      }
    }
  }
  for (const reward of economy.progression.rewardsPerLevel) {
    allLootItems.add(reward.currency);
    if (reward.items) {
      for (const item of reward.items) {
        allLootItems.add(item);
      }
    }
  }

  for (const item of economy.shop) {
    if (!allLootItems.has(item.name) && !currencyNames.has(item.name)) {
      issues.push({
        type: 'dead_end_item',
        severity: 'info',
        message: `Shop item "${item.name}" is never found in loot tables or progression rewards.`,
      });
    }
  }

  // Inflation check: total earn rate vs total sink capacity
  const totalEarnRate = economy.currencies.reduce((sum, c) => sum + c.earnRate, 0);
  const avgShopPrice = economy.shop.length > 0
    ? economy.shop.reduce((sum, i) => sum + i.price, 0) / economy.shop.length
    : 0;
  if (totalEarnRate > 0 && avgShopPrice > 0 && totalEarnRate > avgShopPrice * 2) {
    issues.push({
      type: 'inflation_risk',
      severity: 'warning',
      message: `High inflation risk: combined earn rate (${totalEarnRate}/tick) greatly exceeds average shop price (${avgShopPrice}).`,
    });
  }

  // Compute score
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const score = Math.max(0, Math.min(100, 100 - errorCount * 15 - warningCount * 5));

  return {
    score,
    issues,
    passed: errorCount === 0,
  };
}

// ---------------------------------------------------------------------------
// Script generation
// ---------------------------------------------------------------------------

export function economyToScript(economy: GameEconomy): string {
  const lines: string[] = [];

  lines.push('// Auto-generated Economy Script');
  lines.push('// Generated by SpawnForge Economy Designer');
  lines.push('');

  // Currencies
  lines.push('// --- Currencies ---');
  lines.push(`const currencies = ${JSON.stringify(economy.currencies, null, 2)};`);
  lines.push('');

  // Player wallet
  lines.push('// --- Player Wallet ---');
  lines.push('const wallet = {};');
  lines.push('for (const c of currencies) {');
  lines.push('  wallet[c.name] = 0;');
  lines.push('}');
  lines.push('');

  // Earn currency function
  lines.push('function earnCurrency(name, amount) {');
  lines.push('  if (wallet[name] !== undefined) {');
  lines.push('    wallet[name] += amount;');
  lines.push('  }');
  lines.push('}');
  lines.push('');

  // Shop
  lines.push('// --- Shop ---');
  lines.push(`const shopItems = ${JSON.stringify(economy.shop, null, 2)};`);
  lines.push('');
  lines.push('function buyItem(itemName, playerLevel) {');
  lines.push('  const item = shopItems.find(i => i.name === itemName);');
  lines.push('  if (!item) return { success: false, reason: "Item not found" };');
  lines.push('  if (playerLevel < item.unlockLevel) return { success: false, reason: "Level too low" };');
  lines.push('  if ((wallet[item.currency] || 0) < item.price) return { success: false, reason: "Not enough " + item.currency };');
  lines.push('  wallet[item.currency] -= item.price;');
  lines.push('  return { success: true, item };');
  lines.push('}');
  lines.push('');

  // Loot tables
  lines.push('// --- Loot Tables ---');
  lines.push(`const lootTables = ${JSON.stringify(economy.lootTables, null, 2)};`);
  lines.push('');
  lines.push('function rollLootTable(tableName) {');
  lines.push('  const table = lootTables.find(t => t.name === tableName);');
  lines.push('  if (!table) return [];');
  lines.push('  const drops = [];');
  lines.push('  if (table.guaranteedDrops) {');
  lines.push('    for (const drop of table.guaranteedDrops) {');
  lines.push('      drops.push({ item: drop, quantity: 1 });');
  lines.push('    }');
  lines.push('  }');
  lines.push('  const totalWeight = table.entries.reduce((s, e) => s + e.weight, 0);');
  lines.push('  if (totalWeight <= 0) return drops;');
  lines.push('  let roll = Math.random() * totalWeight;');
  lines.push('  for (const entry of table.entries) {');
  lines.push('    roll -= entry.weight;');
  lines.push('    if (roll <= 0) {');
  lines.push('      const qty = Math.floor(Math.random() * (entry.maxQuantity - entry.minQuantity + 1)) + entry.minQuantity;');
  lines.push('      drops.push({ item: entry.item, quantity: qty });');
  lines.push('      break;');
  lines.push('    }');
  lines.push('  }');
  lines.push('  return drops;');
  lines.push('}');
  lines.push('');

  // Progression
  lines.push('// --- Progression ---');
  lines.push(`const xpPerLevel = ${JSON.stringify(economy.progression.xpPerLevel)};`);
  lines.push(`const rewardsPerLevel = ${JSON.stringify(economy.progression.rewardsPerLevel)};`);
  lines.push('let currentLevel = 1;');
  lines.push('let currentXp = 0;');
  lines.push('');
  lines.push('function addXp(amount) {');
  lines.push('  currentXp += amount;');
  lines.push('  const results = [];');
  lines.push('  while (currentLevel <= xpPerLevel.length && currentXp >= xpPerLevel[currentLevel - 1]) {');
  lines.push('    currentXp -= xpPerLevel[currentLevel - 1];');
  lines.push('    currentLevel++;');
  lines.push('    const reward = rewardsPerLevel[currentLevel - 2];');
  lines.push('    if (reward) {');
  lines.push('      earnCurrency(reward.currency, reward.amount);');
  lines.push('      results.push({ level: currentLevel, reward });');
  lines.push('    }');
  lines.push('  }');
  lines.push('  return results;');
  lines.push('}');
  lines.push('');

  // Getters
  lines.push('function getWallet() { return { ...wallet }; }');
  lines.push('function getLevel() { return currentLevel; }');
  lines.push('function getXp() { return currentXp; }');
  lines.push('function getXpToNextLevel() {');
  lines.push('  if (currentLevel > xpPerLevel.length) return 0;');
  lines.push('  return xpPerLevel[currentLevel - 1] - currentXp;');
  lines.push('}');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// AI generation (stub — calls the AI chat endpoint in production)
// ---------------------------------------------------------------------------

export async function generateEconomy(
  gameDescription: string,
  preset?: string,
): Promise<GameEconomy> {
  // If a preset is specified, start from that template
  if (preset && ECONOMY_PRESETS[preset]) {
    return structuredClone(ECONOMY_PRESETS[preset]);
  }

  // In production this would call the AI endpoint.
  // For now, select a preset based on keyword matching from the description.
  const desc = gameDescription.toLowerCase();

  if (desc.includes('idle') || desc.includes('incremental') || desc.includes('clicker')) {
    return structuredClone(ECONOMY_PRESETS.idle_incremental);
  }
  if (desc.includes('roguelike') || desc.includes('rogue') || desc.includes('permadeath')) {
    return structuredClone(ECONOMY_PRESETS.roguelike);
  }
  if (desc.includes('pvp') || desc.includes('competitive') || desc.includes('ranked')) {
    return structuredClone(ECONOMY_PRESETS.competitive_pvp);
  }
  if (desc.includes('rpg') || desc.includes('quest') || desc.includes('adventure')) {
    return structuredClone(ECONOMY_PRESETS.rpg_classic);
  }

  // Default to casual mobile
  return structuredClone(ECONOMY_PRESETS.casual_mobile);
}
