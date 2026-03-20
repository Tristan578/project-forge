/**
 * Procedural Quest/Mission Generator
 *
 * Generates varied quest chains with objectives, rewards, and narrative hooks.
 * Supports 5 chain templates and exports to game scripts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuestType =
  | 'fetch'
  | 'kill'
  | 'escort'
  | 'defend'
  | 'explore'
  | 'puzzle'
  | 'dialogue'
  | 'collect'
  | 'craft'
  | 'deliver';

export type QuestStatus = 'locked' | 'available' | 'active' | 'completed' | 'failed';

export type RewardType = 'experience' | 'gold' | 'item' | 'reputation' | 'skill' | 'unlock';

export interface Reward {
  type: RewardType;
  name: string;
  amount: number;
  description?: string;
}

export type ObjectiveType =
  | 'kill_count'
  | 'collect_items'
  | 'reach_location'
  | 'talk_to_npc'
  | 'survive_time'
  | 'protect_target'
  | 'solve_puzzle'
  | 'craft_item'
  | 'deliver_item'
  | 'explore_area';

export interface Objective {
  id: string;
  type: ObjectiveType;
  description: string;
  target: string;
  required: number;
  current: number;
  optional: boolean;
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  type: QuestType;
  status: QuestStatus;
  level: number;
  objectives: Objective[];
  rewards: Reward[];
  prerequisites: string[];
  narrativeHook: string;
  giverNpc: string;
  location: string;
  timeLimit?: number;
}

export type ChainTemplateId =
  | 'hero_origin'
  | 'mystery_investigation'
  | 'faction_loyalty'
  | 'resource_expedition'
  | 'revenge_arc';

export interface ChainTemplate {
  id: ChainTemplateId;
  name: string;
  description: string;
  questCount: number;
  arcDescription: string;
  questTypes: QuestType[];
}

export interface QuestChain {
  id: string;
  name: string;
  description: string;
  templateId: ChainTemplateId;
  quests: Quest[];
  createdAt: number;
}

export interface GenerateOptions {
  templateId: ChainTemplateId;
  playerDescription: string;
  difficulty: number;
  questCount?: number;
}

// ---------------------------------------------------------------------------
// Chain Templates
// ---------------------------------------------------------------------------

export const CHAIN_TEMPLATES: Record<ChainTemplateId, ChainTemplate> = {
  hero_origin: {
    id: 'hero_origin',
    name: 'Hero Origin',
    description: 'A classic hero journey from humble beginnings to legendary status.',
    questCount: 5,
    arcDescription: 'Humble beginnings -> First challenge -> Mentor discovery -> Trial by fire -> Heroic deed',
    questTypes: ['fetch', 'kill', 'explore', 'defend', 'kill'],
  },
  mystery_investigation: {
    id: 'mystery_investigation',
    name: 'Mystery Investigation',
    description: 'Uncover clues and solve a deep mystery through interrogation and exploration.',
    questCount: 5,
    arcDescription: 'Crime scene -> Witness interviews -> Clue gathering -> Suspect chase -> Confrontation',
    questTypes: ['explore', 'dialogue', 'collect', 'escort', 'puzzle'],
  },
  faction_loyalty: {
    id: 'faction_loyalty',
    name: 'Faction Loyalty',
    description: 'Prove your worth to a faction through escalating tests of loyalty.',
    questCount: 5,
    arcDescription: 'Initiation -> Resource gathering -> Rival sabotage -> Defense mission -> Leadership trial',
    questTypes: ['fetch', 'collect', 'kill', 'defend', 'dialogue'],
  },
  resource_expedition: {
    id: 'resource_expedition',
    name: 'Resource Expedition',
    description: 'Venture into dangerous territory to secure valuable resources.',
    questCount: 4,
    arcDescription: 'Scouting -> Resource extraction -> Transport defense -> Delivery',
    questTypes: ['explore', 'collect', 'defend', 'deliver'],
  },
  revenge_arc: {
    id: 'revenge_arc',
    name: 'Revenge Arc',
    description: 'Track down a villain through a chain of encounters and confrontations.',
    questCount: 5,
    arcDescription: 'Inciting incident -> Trail pickup -> Ally recruitment -> Ambush -> Final showdown',
    questTypes: ['explore', 'collect', 'dialogue', 'kill', 'kill'],
  },
};

// ---------------------------------------------------------------------------
// Generation Helpers
// ---------------------------------------------------------------------------

const QUEST_TYPE_OBJECTIVES: Record<QuestType, ObjectiveType[]> = {
  fetch: ['collect_items', 'deliver_item'],
  kill: ['kill_count'],
  escort: ['protect_target', 'reach_location'],
  defend: ['survive_time', 'protect_target', 'kill_count'],
  explore: ['reach_location', 'explore_area'],
  puzzle: ['solve_puzzle'],
  dialogue: ['talk_to_npc'],
  collect: ['collect_items'],
  craft: ['craft_item', 'collect_items'],
  deliver: ['deliver_item', 'reach_location'],
};

const NARRATIVE_HOOKS: Record<ChainTemplateId, string[]> = {
  hero_origin: [
    'A mysterious stranger arrives with an urgent plea for help.',
    'Strange lights have been seen in the mountains above the village.',
    'The village elder senses a disturbance in the ancient wards.',
    'A childhood friend returns with tales of danger on the frontier.',
  ],
  mystery_investigation: [
    'A priceless artifact has vanished from the royal vault.',
    'Townspeople report hearing strange whispers at midnight.',
    'A respected merchant is found unconscious with no memory.',
    'Coded messages appear on the notice board each dawn.',
  ],
  faction_loyalty: [
    'The guild leader offers you a chance to prove your worth.',
    'A border dispute threatens the fragile peace between factions.',
    'Rumors of a traitor within the ranks demand investigation.',
    'A rival faction has issued a direct challenge.',
  ],
  resource_expedition: [
    'Scouts report a rich vein of rare ore in uncharted territory.',
    'The winter stores are dangerously low and time is running out.',
    'A map to a forgotten supply cache has surfaced at the market.',
    'Alchemists need rare ingredients found only in the deep wilds.',
  ],
  revenge_arc: [
    'A shadowy figure has destroyed everything you held dear.',
    'The villain has escaped justice and left a trail of suffering.',
    'An old wound reopens when the perpetrator resurfaces.',
    'A dying witness names the one responsible for the tragedy.',
  ],
};

const NPC_NAMES = [
  'Elder Maren', 'Captain Thorne', 'Scholar Elise', 'Blacksmith Doran',
  'Herbalist Yara', 'Scout Ravi', 'Merchant Luca', 'Priestess Amara',
  'Ranger Kael', 'Alchemist Fenn', 'Guard Sergeant Isla', 'Wanderer Nyx',
];

const LOCATIONS = [
  'Silverbrook Village', 'The Whispering Woods', 'Iron Peak Mines',
  'Dragonmaw Pass', 'Sunken Temple Ruins', 'Frosthollow Caverns',
  'Amber Plains', 'Thornwall Keep', 'Mistfall Harbor', 'Obsidian Crater',
];

function seededIndex(seed: string, arrayLength: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % arrayLength;
}

function generateId(prefix: string, index: number, seed: string): string {
  const hash = seededIndex(`${seed}-${index}`, 99999);
  return `${prefix}-${hash.toString(16).padStart(5, '0')}`;
}

function objectiveTypeToDescription(type: ObjectiveType, target: string, required: number): string {
  switch (type) {
    case 'kill_count':
      return `Defeat ${required} ${target}`;
    case 'collect_items':
      return `Collect ${required} ${target}`;
    case 'reach_location':
      return `Reach ${target}`;
    case 'talk_to_npc':
      return `Speak with ${target}`;
    case 'survive_time':
      return `Survive for ${required} seconds at ${target}`;
    case 'protect_target':
      return `Protect ${target}`;
    case 'solve_puzzle':
      return `Solve the ${target}`;
    case 'craft_item':
      return `Craft ${required} ${target}`;
    case 'deliver_item':
      return `Deliver ${target}`;
    case 'explore_area':
      return `Explore ${target}`;
  }
}

const OBJECTIVE_TARGETS: Record<ObjectiveType, string[]> = {
  kill_count: ['Shadow Wolves', 'Bandits', 'Goblins', 'Undead Warriors', 'Giant Spiders'],
  collect_items: ['Ancient Relics', 'Healing Herbs', 'Crystal Shards', 'Iron Ore', 'Lost Scrolls'],
  reach_location: ['The Summit', 'Hidden Grove', 'Ancient Shrine', 'Underground River', 'Signal Tower'],
  talk_to_npc: ['Village Elder', 'Traveling Merchant', 'Prison Warden', 'Local Historian', 'Hermit Sage'],
  survive_time: ['The Arena', 'Cursed Clearing', 'Siege Point', 'Haunted Ruins', 'Dragon Nest'],
  protect_target: ['The Caravan', 'Village Gate', 'Sacred Tree', 'Wounded Ally', 'Supply Wagon'],
  solve_puzzle: ['Ancient Lock', 'Rune Cipher', 'Bridge Mechanism', 'Light Alignment', 'Crystal Puzzle'],
  craft_item: ['Healing Potion', 'Silver Sword', 'Ward Amulet', 'Fire Arrow', 'Climbing Rope'],
  deliver_item: ['Medical Supplies', 'Secret Letter', 'Treaty Scroll', 'Rare Component', 'Map Fragment'],
  explore_area: ['Forgotten Catacombs', 'Misty Highlands', 'Abandoned Mine', 'Coral Caves', 'Cloud Peaks'],
};

function generateObjectives(
  questType: QuestType,
  difficulty: number,
  questIndex: number,
  seed: string,
): Objective[] {
  const possibleTypes = QUEST_TYPE_OBJECTIVES[questType];
  const objectives: Objective[] = [];

  for (let i = 0; i < possibleTypes.length; i++) {
    const objType = possibleTypes[i];
    const targets = OBJECTIVE_TARGETS[objType];
    const targetIdx = seededIndex(`${seed}-obj-${questIndex}-${i}`, targets.length);
    const target = targets[targetIdx];
    const required = objType === 'reach_location' || objType === 'talk_to_npc' || objType === 'solve_puzzle'
      ? 1
      : Math.max(1, Math.floor(difficulty * 3) + questIndex);

    objectives.push({
      id: generateId('obj', questIndex * 10 + i, seed),
      type: objType,
      description: objectiveTypeToDescription(objType, target, required),
      target,
      required,
      current: 0,
      optional: i > 0 && possibleTypes.length > 1,
    });
  }

  return objectives;
}

function generateRewards(difficulty: number, questIndex: number, seed: string): Reward[] {
  const rewards: Reward[] = [];
  const baseXp = 50 * (questIndex + 1) * difficulty;
  const baseGold = 20 * (questIndex + 1) * difficulty;

  rewards.push({
    type: 'experience',
    name: 'Experience',
    amount: Math.round(baseXp),
  });

  rewards.push({
    type: 'gold',
    name: 'Gold',
    amount: Math.round(baseGold),
  });

  // Bonus item reward for later quests
  if (questIndex >= 2) {
    const items = ['Enchanted Ring', 'Steel Shield', 'Health Elixir', 'Shadow Cloak', 'Flame Blade'];
    const idx = seededIndex(`${seed}-reward-${questIndex}`, items.length);
    rewards.push({
      type: 'item',
      name: items[idx],
      amount: 1,
      description: `A rare ${items[idx].toLowerCase()} awarded for completing this quest.`,
    });
  }

  return rewards;
}

// ---------------------------------------------------------------------------
// Quest Title Templates
// ---------------------------------------------------------------------------

const QUEST_TITLE_TEMPLATES: Record<ChainTemplateId, string[]> = {
  hero_origin: [
    'The Call to Arms',
    'Proving Grounds',
    'Wisdom of the Mentor',
    'Trial by Fire',
    'A Hero Rises',
  ],
  mystery_investigation: [
    'The Scene of the Crime',
    'Whispers and Shadows',
    'Gathering the Pieces',
    'The Chase Begins',
    'The Truth Revealed',
  ],
  faction_loyalty: [
    'The Initiation',
    'Gathering Resources',
    'Striking the Rival',
    'Hold the Line',
    'The Final Test',
  ],
  resource_expedition: [
    'Scouting the Route',
    'Into the Depths',
    'Guarding the Haul',
    'Safe Passage Home',
  ],
  revenge_arc: [
    'Ashes of the Past',
    'Picking Up the Trail',
    'Unlikely Allies',
    'The Ambush',
    'Reckoning',
  ],
};

const QUEST_DESC_TEMPLATES: Record<ChainTemplateId, string[]> = {
  hero_origin: [
    'An unexpected event thrusts you into a world of danger and opportunity.',
    'Face your first real challenge and prove you have what it takes.',
    'Seek out a wise mentor who can teach you the skills you need.',
    'Push through a grueling trial that will test every fiber of your being.',
    'Rise to the occasion and perform a deed worthy of legend.',
  ],
  mystery_investigation: [
    'Investigate the initial scene and look for anything out of place.',
    'Track down witnesses and piece together what happened.',
    'Follow the clues to uncover hidden evidence.',
    'Pursue a suspect before they can cover their tracks.',
    'Confront the truth and bring resolution to the mystery.',
  ],
  faction_loyalty: [
    'Complete a task to earn entry into the faction ranks.',
    'Gather valuable resources to strengthen the faction position.',
    'Undermine a rival faction that threatens your allies.',
    'Defend faction territory from a coordinated assault.',
    'Pass the ultimate test of loyalty and claim your place.',
  ],
  resource_expedition: [
    'Scout the terrain and identify the safest route to the resources.',
    'Venture deep into the wilderness to extract what is needed.',
    'Protect the gathered resources from those who would take them.',
    'Deliver the resources safely back to civilization.',
  ],
  revenge_arc: [
    'Survey the wreckage and vow to bring the perpetrator to justice.',
    'Follow a trail of clues left by the one you seek.',
    'Recruit allies who share your cause and prepare for the fight.',
    'Spring a trap on the villain before they can strike again.',
    'Face your nemesis in a final, decisive confrontation.',
  ],
};

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export function generateQuestChain(options: GenerateOptions): QuestChain {
  const errors = validateGenerateOptions(options);
  if (errors.length > 0) {
    throw new Error(`Invalid options: ${errors.join(', ')}`);
  }

  const template = CHAIN_TEMPLATES[options.templateId];
  const questCount = options.questCount ?? template.questCount;
  const seed = `${options.templateId}-${options.playerDescription}`;
  const chainId = generateId('chain', 0, seed);

  const hookIdx = seededIndex(seed, NARRATIVE_HOOKS[options.templateId].length);
  const narrativeHook = NARRATIVE_HOOKS[options.templateId][hookIdx];

  const quests: Quest[] = [];

  for (let i = 0; i < questCount; i++) {
    const questType = template.questTypes[i % template.questTypes.length];
    const titles = QUEST_TITLE_TEMPLATES[options.templateId];
    const descs = QUEST_DESC_TEMPLATES[options.templateId];
    const title = titles[i % titles.length];
    const description = descs[i % descs.length];

    const npcIdx = seededIndex(`${seed}-npc-${i}`, NPC_NAMES.length);
    const locIdx = seededIndex(`${seed}-loc-${i}`, LOCATIONS.length);

    const questId = generateId('quest', i, seed);
    const prerequisites = i > 0 ? [quests[i - 1].id] : [];

    quests.push({
      id: questId,
      title,
      description,
      type: questType,
      status: i === 0 ? 'available' : 'locked',
      level: Math.max(1, Math.round(options.difficulty * (i + 1))),
      objectives: generateObjectives(questType, options.difficulty, i, seed),
      rewards: generateRewards(options.difficulty, i, seed),
      prerequisites,
      narrativeHook: i === 0 ? narrativeHook : `Continue the journey: ${title.toLowerCase()}.`,
      giverNpc: NPC_NAMES[npcIdx],
      location: LOCATIONS[locIdx],
    });
  }

  return {
    id: chainId,
    name: `${template.name}: ${options.playerDescription}`,
    description: template.description,
    templateId: options.templateId,
    quests,
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateGenerateOptions(options: GenerateOptions): string[] {
  const errors: string[] = [];

  if (!options.templateId || !CHAIN_TEMPLATES[options.templateId]) {
    errors.push(`Invalid templateId: ${options.templateId}`);
  }

  if (!options.playerDescription || options.playerDescription.trim().length === 0) {
    errors.push('playerDescription is required');
  }

  if (options.playerDescription && options.playerDescription.length > 200) {
    errors.push('playerDescription must be 200 characters or fewer');
  }

  if (typeof options.difficulty !== 'number' || options.difficulty < 1 || options.difficulty > 10) {
    errors.push('difficulty must be a number between 1 and 10');
  }

  if (options.questCount !== undefined) {
    if (typeof options.questCount !== 'number' || options.questCount < 1 || options.questCount > 20) {
      errors.push('questCount must be between 1 and 20');
    }
  }

  return errors;
}

export function validateQuest(quest: Quest): string[] {
  const errors: string[] = [];

  if (!quest.id) errors.push('Quest must have an id');
  if (!quest.title) errors.push('Quest must have a title');
  if (!quest.description) errors.push('Quest must have a description');
  if (!quest.type) errors.push('Quest must have a type');
  if (!quest.objectives || quest.objectives.length === 0) {
    errors.push('Quest must have at least one objective');
  }
  if (!quest.rewards || quest.rewards.length === 0) {
    errors.push('Quest must have at least one reward');
  }
  if (quest.level < 1) errors.push('Quest level must be at least 1');

  return errors;
}

export function validateQuestChain(chain: QuestChain): string[] {
  const errors: string[] = [];

  if (!chain.id) errors.push('Chain must have an id');
  if (!chain.name) errors.push('Chain must have a name');
  if (!chain.quests || chain.quests.length === 0) {
    errors.push('Chain must have at least one quest');
  }

  const questIds = new Set<string>();
  for (const quest of chain.quests) {
    if (questIds.has(quest.id)) {
      errors.push(`Duplicate quest id: ${quest.id}`);
    }
    questIds.add(quest.id);

    for (const prereq of quest.prerequisites) {
      if (!questIds.has(prereq)) {
        errors.push(`Quest "${quest.title}" has prerequisite "${prereq}" that is not defined before it`);
      }
    }

    errors.push(...validateQuest(quest));
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Script Export
// ---------------------------------------------------------------------------

export function exportQuestChainToScript(chain: QuestChain): string {
  const lines: string[] = [];

  lines.push('// Auto-generated Quest Chain Script');
  lines.push(`// Chain: ${chain.name}`);
  lines.push(`// Template: ${chain.templateId}`);
  lines.push(`// Generated: ${new Date(chain.createdAt).toISOString()}`);
  lines.push('');
  lines.push('const questChain = {');
  lines.push(`  id: "${chain.id}",`);
  lines.push(`  name: "${escapeString(chain.name)}",`);
  lines.push(`  description: "${escapeString(chain.description)}",`);
  lines.push(`  templateId: "${chain.templateId}",`);
  lines.push('  quests: [');

  for (const quest of chain.quests) {
    lines.push('    {');
    lines.push(`      id: "${quest.id}",`);
    lines.push(`      title: "${escapeString(quest.title)}",`);
    lines.push(`      description: "${escapeString(quest.description)}",`);
    lines.push(`      type: "${quest.type}",`);
    lines.push(`      status: "${quest.status}",`);
    lines.push(`      level: ${quest.level},`);
    lines.push(`      giverNpc: "${escapeString(quest.giverNpc)}",`);
    lines.push(`      location: "${escapeString(quest.location)}",`);
    lines.push(`      narrativeHook: "${escapeString(quest.narrativeHook)}",`);
    lines.push(`      prerequisites: [${quest.prerequisites.map((p) => `"${p}"`).join(', ')}],`);
    if (quest.timeLimit !== undefined) {
      lines.push(`      timeLimit: ${quest.timeLimit},`);
    }

    // Objectives
    lines.push('      objectives: [');
    for (const obj of quest.objectives) {
      lines.push('        {');
      lines.push(`          id: "${obj.id}",`);
      lines.push(`          type: "${obj.type}",`);
      lines.push(`          description: "${escapeString(obj.description)}",`);
      lines.push(`          target: "${escapeString(obj.target)}",`);
      lines.push(`          required: ${obj.required},`);
      lines.push(`          current: ${obj.current},`);
      lines.push(`          optional: ${obj.optional},`);
      lines.push('        },');
    }
    lines.push('      ],');

    // Rewards
    lines.push('      rewards: [');
    for (const reward of quest.rewards) {
      lines.push('        {');
      lines.push(`          type: "${reward.type}",`);
      lines.push(`          name: "${escapeString(reward.name)}",`);
      lines.push(`          amount: ${reward.amount},`);
      if (reward.description) {
        lines.push(`          description: "${escapeString(reward.description)}",`);
      }
      lines.push('        },');
    }
    lines.push('      ],');

    lines.push('    },');
  }

  lines.push('  ],');
  lines.push('};');
  lines.push('');
  lines.push('// Quest progression helpers');
  lines.push('function getActiveQuest() {');
  lines.push('  return questChain.quests.find(q => q.status === "active") ||');
  lines.push('    questChain.quests.find(q => q.status === "available");');
  lines.push('}');
  lines.push('');
  lines.push('function completeQuest(questId) {');
  lines.push('  const quest = questChain.quests.find(q => q.id === questId);');
  lines.push('  if (quest) {');
  lines.push('    quest.status = "completed";');
  lines.push('    // Unlock next quests whose prerequisites are all completed');
  lines.push('    for (const q of questChain.quests) {');
  lines.push('      if (q.status === "locked") {');
  lines.push('        const allMet = q.prerequisites.every(pid =>');
  lines.push('          questChain.quests.find(pq => pq.id === pid)?.status === "completed"');
  lines.push('        );');
  lines.push('        if (allMet) q.status = "available";');
  lines.push('      }');
  lines.push('    }');
  lines.push('  }');
  lines.push('}');

  return lines.join('\n');
}

function escapeString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
