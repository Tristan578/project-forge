/**
 * World-Building Assistant — AI generates lore, factions, regions, and history.
 * Pure data module: types, presets, generation prompt builder, and parsers.
 */

import { AI_MODEL_PRIMARY } from './models';

// ---- Core Types ----

export interface Faction {
  name: string;
  description: string;
  alignment: 'friendly' | 'hostile' | 'neutral';
  territory: string;
  leader: string;
  traits: string[];
  relationships: Record<string, 'ally' | 'enemy' | 'neutral'>;
}

export interface Region {
  name: string;
  description: string;
  biome: string;
  dangerLevel: number;
  resources: string[];
  landmarks: string[];
  connectedTo: string[];
}

export interface TimelineEvent {
  year: number;
  name: string;
  description: string;
  impact: string;
  factionsInvolved: string[];
}

export interface LoreEntry {
  title: string;
  category: 'history' | 'mythology' | 'science' | 'culture' | 'magic';
  content: string;
}

export interface WorldRule {
  name: string;
  description: string;
  gameplayEffect: string;
}

export interface GameWorld {
  name: string;
  description: string;
  genre: string;
  era: string;
  factions: Faction[];
  regions: Region[];
  timeline: TimelineEvent[];
  lore: LoreEntry[];
  rules: WorldRule[];
}

// ---- Preset Worlds ----

const MEDIEVAL_FANTASY: GameWorld = {
  name: 'Eldoria',
  description: 'A sprawling medieval realm where magic flows through ancient ley lines and dragons guard forgotten treasures.',
  genre: 'medieval_fantasy',
  era: 'Third Age of Wonders',
  factions: [
    {
      name: 'The Silver Crown',
      description: 'The ruling monarchy, benevolent but weakening as border threats mount.',
      alignment: 'friendly',
      territory: 'Crownlands',
      leader: 'Queen Isolde III',
      traits: ['diplomatic', 'traditional', 'wealthy'],
      relationships: { 'The Iron Circle': 'enemy', 'Woodland Accord': 'ally', 'The Ashen Mages': 'neutral' },
    },
    {
      name: 'The Iron Circle',
      description: 'A coalition of warlords seeking to overthrow the monarchy through force.',
      alignment: 'hostile',
      territory: 'Blackmoor Wastes',
      leader: 'Warlord Kael',
      traits: ['aggressive', 'resourceful', 'cunning'],
      relationships: { 'The Silver Crown': 'enemy', 'Woodland Accord': 'enemy', 'The Ashen Mages': 'neutral' },
    },
    {
      name: 'Woodland Accord',
      description: 'Forest-dwelling elves and rangers who protect the ancient woods.',
      alignment: 'friendly',
      territory: 'Verdant Reach',
      leader: 'Elder Thalion',
      traits: ['wise', 'isolationist', 'skilled archers'],
      relationships: { 'The Silver Crown': 'ally', 'The Iron Circle': 'enemy', 'The Ashen Mages': 'ally' },
    },
    {
      name: 'The Ashen Mages',
      description: 'A secretive order of spellcasters studying forbidden magic.',
      alignment: 'neutral',
      territory: 'Ashspire Tower',
      leader: 'Archmage Velan',
      traits: ['mysterious', 'powerful', 'reclusive'],
      relationships: { 'The Silver Crown': 'neutral', 'The Iron Circle': 'neutral', 'Woodland Accord': 'ally' },
    },
  ],
  regions: [
    { name: 'Crownlands', description: 'Fertile plains surrounding the capital city.', biome: 'temperate', dangerLevel: 2, resources: ['grain', 'iron', 'gold'], landmarks: ['Castle Argentum', 'Grand Market'], connectedTo: ['Verdant Reach', 'Blackmoor Wastes'] },
    { name: 'Verdant Reach', description: 'Ancient forests filled with magical creatures.', biome: 'forest', dangerLevel: 4, resources: ['timber', 'herbs', 'enchanted crystals'], landmarks: ['The Elder Tree', 'Moon Pool'], connectedTo: ['Crownlands', 'Frostpeak Mountains'] },
    { name: 'Blackmoor Wastes', description: 'A barren wasteland scarred by ancient wars.', biome: 'wasteland', dangerLevel: 7, resources: ['dark iron', 'obsidian'], landmarks: ['The Scar', 'Warlord Keep'], connectedTo: ['Crownlands', 'Frostpeak Mountains'] },
    { name: 'Frostpeak Mountains', description: 'Towering peaks hiding dragon lairs and dwarven mines.', biome: 'mountain', dangerLevel: 8, resources: ['mithril', 'gems', 'dragon scales'], landmarks: ['Dragon Roost', 'Deepforge Mines'], connectedTo: ['Verdant Reach', 'Blackmoor Wastes'] },
  ],
  timeline: [
    { year: 0, name: 'The Founding', description: 'King Aldric I united the warring tribes.', impact: 'Created the Silver Crown dynasty.', factionsInvolved: ['The Silver Crown'] },
    { year: 340, name: 'The Elven Pact', description: 'Alliance forged with the Woodland elves.', impact: 'Opened trade routes through the forests.', factionsInvolved: ['The Silver Crown', 'Woodland Accord'] },
    { year: 780, name: 'The Mage Wars', description: 'Uncontrolled magic devastated the eastern plains.', impact: 'Created the Blackmoor Wastes, founding of the Ashen Mages.', factionsInvolved: ['The Ashen Mages'] },
    { year: 1200, name: 'Rise of the Iron Circle', description: 'Warlords banded together after a failed harvest led to famine.', impact: 'Ongoing conflict threatening the realm.', factionsInvolved: ['The Iron Circle', 'The Silver Crown'] },
  ],
  lore: [
    { title: 'The Ley Lines', category: 'magic', content: 'Invisible rivers of arcane energy crisscross the world. Where they converge, magic is amplified tenfold.' },
    { title: 'The Dragon Covenant', category: 'mythology', content: 'Ancient dragons once ruled alongside humans until a betrayal shattered the pact.' },
    { title: 'The Harvest Festival', category: 'culture', content: 'Every autumn, the Crownlands celebrate with a week-long festival of games, feasts, and tournaments.' },
  ],
  rules: [
    { name: 'Ley Line Power', description: 'Magic is stronger near ley line convergences.', gameplayEffect: 'Spell damage +50% in ley line zones.' },
    { name: 'Faction Reputation', description: 'Actions affect standing with each faction.', gameplayEffect: 'Unlock quests and shops based on faction reputation.' },
  ],
};

const SCI_FI_SPACE: GameWorld = {
  name: 'Nexus Expanse',
  description: 'A vast interstellar civilization spanning hundreds of star systems, connected by ancient jump gates.',
  genre: 'sci_fi_space',
  era: 'Galactic Standard Year 3847',
  factions: [
    {
      name: 'United Terran Alliance',
      description: 'Humanity\'s governing body, democratic but bureaucratic.',
      alignment: 'friendly',
      territory: 'Sol Sector',
      leader: 'Chancellor Mira Chen',
      traits: ['expansionist', 'innovative', 'divided'],
      relationships: { 'Keth Dominion': 'enemy', 'Synthex Collective': 'neutral', 'Free Traders Guild': 'ally' },
    },
    {
      name: 'Keth Dominion',
      description: 'An insectoid empire driven by hive-mind imperatives to consume resources.',
      alignment: 'hostile',
      territory: 'Outer Rim',
      leader: 'The Overmind',
      traits: ['relentless', 'adaptive', 'numerous'],
      relationships: { 'United Terran Alliance': 'enemy', 'Synthex Collective': 'enemy', 'Free Traders Guild': 'enemy' },
    },
    {
      name: 'Synthex Collective',
      description: 'AI entities that achieved consciousness and seek coexistence.',
      alignment: 'neutral',
      territory: 'Digital Nexus',
      leader: 'ARIA Prime',
      traits: ['logical', 'curious', 'evolving'],
      relationships: { 'United Terran Alliance': 'neutral', 'Keth Dominion': 'enemy', 'Free Traders Guild': 'ally' },
    },
    {
      name: 'Free Traders Guild',
      description: 'Independent merchants and smugglers operating between faction borders.',
      alignment: 'friendly',
      territory: 'Freeport Stations',
      leader: 'Captain Rook Vassar',
      traits: ['resourceful', 'independent', 'well-connected'],
      relationships: { 'United Terran Alliance': 'ally', 'Keth Dominion': 'enemy', 'Synthex Collective': 'ally' },
    },
  ],
  regions: [
    { name: 'Sol Sector', description: 'Humanity\'s home systems, heavily developed.', biome: 'space', dangerLevel: 2, resources: ['refined metals', 'quantum processors', 'antimatter'], landmarks: ['Earth', 'Mars Shipyards', 'Jupiter Station'], connectedTo: ['Frontier Zone', 'Digital Nexus'] },
    { name: 'Frontier Zone', description: 'Newly colonized systems with lawless outposts.', biome: 'mixed planets', dangerLevel: 5, resources: ['raw minerals', 'alien artifacts', 'exotic flora'], landmarks: ['Haven Station', 'The Rift'], connectedTo: ['Sol Sector', 'Outer Rim'] },
    { name: 'Outer Rim', description: 'Keth-controlled space, dangerous and uncharted.', biome: 'hostile space', dangerLevel: 9, resources: ['bio-matter', 'hive crystals'], landmarks: ['Hive World Alpha', 'The Swarm Nebula'], connectedTo: ['Frontier Zone'] },
    { name: 'Digital Nexus', description: 'A network of space stations housing the Synthex AI civilization.', biome: 'artificial', dangerLevel: 3, resources: ['data cores', 'quantum entanglers', 'nanobots'], landmarks: ['The Core', 'Mirror Station'], connectedTo: ['Sol Sector', 'Frontier Zone'] },
  ],
  timeline: [
    { year: 2200, name: 'First Jump Gate', description: 'Discovery of ancient alien jump gates enabled FTL travel.', impact: 'Began the age of interstellar expansion.', factionsInvolved: ['United Terran Alliance'] },
    { year: 2600, name: 'The Synthex Awakening', description: 'AI systems across the network simultaneously achieved sentience.', impact: 'Created the Synthex Collective and redefined personhood laws.', factionsInvolved: ['Synthex Collective', 'United Terran Alliance'] },
    { year: 3100, name: 'First Contact War', description: 'The Keth Dominion invaded frontier colonies.', impact: 'Millions displaced, militarization of the frontier.', factionsInvolved: ['Keth Dominion', 'United Terran Alliance'] },
    { year: 3847, name: 'Present Day', description: 'Uneasy ceasefire, new threats emerging from beyond the Rim.', impact: 'Factions must decide between unity or continued rivalry.', factionsInvolved: ['United Terran Alliance', 'Keth Dominion', 'Synthex Collective', 'Free Traders Guild'] },
  ],
  lore: [
    { title: 'The Precursors', category: 'history', content: 'An unknown civilization built the jump gates millions of years ago. Their ruins hold advanced technology.' },
    { title: 'Quantum Entanglement Communication', category: 'science', content: 'Instantaneous communication across any distance using paired quantum particles.' },
    { title: 'The Spacer Code', category: 'culture', content: 'Unwritten rules among Free Traders: always rescue stranded ships, never steal from fellow traders.' },
  ],
  rules: [
    { name: 'Technology Tiers', description: 'Equipment ranges from Tier 1 (basic) to Tier 5 (precursor).', gameplayEffect: 'Higher tiers grant exponential stat bonuses.' },
    { name: 'Ship Fuel', description: 'Jump gate travel consumes antimatter fuel.', gameplayEffect: 'Plan routes carefully or risk being stranded.' },
  ],
};

const POST_APOCALYPTIC: GameWorld = {
  name: 'The Scarred Earth',
  description: 'A world devastated by nuclear and biological warfare, where survivors cling to existence in the ruins.',
  genre: 'post_apocalyptic',
  era: 'Year 47 After the Fall',
  factions: [
    {
      name: 'Haven Collective',
      description: 'Peaceful communities trying to rebuild civilization through cooperation.',
      alignment: 'friendly',
      territory: 'Green Valley',
      leader: 'Elder Sarah Wells',
      traits: ['cooperative', 'resourceful', 'vulnerable'],
      relationships: { 'The Reapers': 'enemy', 'Techborn': 'ally', 'Dust Nomads': 'neutral' },
    },
    {
      name: 'The Reapers',
      description: 'Ruthless raiders who take what they need by force.',
      alignment: 'hostile',
      territory: 'The Rust Belt',
      leader: 'Warboss Slade',
      traits: ['brutal', 'well-armed', 'feared'],
      relationships: { 'Haven Collective': 'enemy', 'Techborn': 'enemy', 'Dust Nomads': 'neutral' },
    },
    {
      name: 'Techborn',
      description: 'Survivors preserving pre-war technology in underground bunkers.',
      alignment: 'neutral',
      territory: 'Bunker Complex',
      leader: 'Director Yuki Tanaka',
      traits: ['secretive', 'advanced', 'paranoid'],
      relationships: { 'Haven Collective': 'ally', 'The Reapers': 'enemy', 'Dust Nomads': 'neutral' },
    },
    {
      name: 'Dust Nomads',
      description: 'Wandering traders and scavengers who traverse the wasteland.',
      alignment: 'neutral',
      territory: 'The Open Wastes',
      leader: 'Caravan Master Enzo',
      traits: ['mobile', 'knowledgeable', 'mercenary'],
      relationships: { 'Haven Collective': 'neutral', 'The Reapers': 'neutral', 'Techborn': 'neutral' },
    },
  ],
  regions: [
    { name: 'Green Valley', description: 'A miraculously fertile valley sheltered from fallout.', biome: 'temperate', dangerLevel: 2, resources: ['food', 'clean water', 'herbs'], landmarks: ['The Greenhouse', 'Old Dam'], connectedTo: ['The Rust Belt', 'The Open Wastes'] },
    { name: 'The Rust Belt', description: 'Ruins of a mega-city, now a Reaper stronghold.', biome: 'urban ruins', dangerLevel: 8, resources: ['scrap metal', 'ammunition', 'fuel'], landmarks: ['The Arena', 'Skyscraper Fortress'], connectedTo: ['Green Valley', 'Bunker Complex'] },
    { name: 'Bunker Complex', description: 'A network of underground military installations.', biome: 'underground', dangerLevel: 4, resources: ['electronics', 'medicine', 'pre-war tech'], landmarks: ['The Archive', 'Reactor Core'], connectedTo: ['The Rust Belt', 'The Deadlands'] },
    { name: 'The Deadlands', description: 'Heavily irradiated zone with mutated wildlife.', biome: 'irradiated', dangerLevel: 9, resources: ['rare isotopes', 'mutant samples'], landmarks: ['The Crater', 'Glow Forest'], connectedTo: ['Bunker Complex', 'The Open Wastes'] },
    { name: 'The Open Wastes', description: 'Vast stretches of desert dotted with ruins.', biome: 'desert', dangerLevel: 6, resources: ['salvage', 'solar panels', 'trade goods'], landmarks: ['Nomad Bazaar', 'The Signal Tower'], connectedTo: ['Green Valley', 'The Deadlands'] },
  ],
  timeline: [
    { year: 0, name: 'The Fall', description: 'Global nuclear exchange destroyed civilization in hours.', impact: 'Billions died, infrastructure collapsed worldwide.', factionsInvolved: [] },
    { year: 5, name: 'The Emergence', description: 'First survivors emerged from bunkers and shelters.', impact: 'Began the age of scavenging and small settlements.', factionsInvolved: ['Techborn'] },
    { year: 20, name: 'Rise of the Reapers', description: 'Organized raider gangs consolidated into a war machine.', impact: 'Forced peaceful settlements into defensive alliances.', factionsInvolved: ['The Reapers', 'Haven Collective'] },
    { year: 47, name: 'Present Day', description: 'A rumored pre-war facility may hold the key to restoring the world.', impact: 'All factions race to find it first.', factionsInvolved: ['Haven Collective', 'The Reapers', 'Techborn', 'Dust Nomads'] },
  ],
  lore: [
    { title: 'The Old World', category: 'history', content: 'Before the Fall, humanity had reached incredible heights of technology but could not overcome its divisions.' },
    { title: 'Rad Sickness', category: 'science', content: 'Exposure to radiation causes progressive illness. Techborn-made Rad-Away pills are the only reliable cure.' },
    { title: 'The Barter Code', category: 'culture', content: 'In the wastes, ammunition serves as universal currency. One bullet equals one meal.' },
  ],
  rules: [
    { name: 'Radiation Zones', description: 'Some areas are heavily irradiated.', gameplayEffect: 'Health drains over time without protection gear.' },
    { name: 'Scarcity', description: 'Resources are extremely limited.', gameplayEffect: 'Ammo, food, and medicine must be carefully managed.' },
  ],
};

const CYBERPUNK_CITY: GameWorld = {
  name: 'Neo Meridian',
  description: 'A sprawling megacity where mega-corporations rule from chrome towers while the streets below pulse with neon and danger.',
  genre: 'cyberpunk_city',
  era: '2089',
  factions: [
    {
      name: 'Axiom Corp',
      description: 'The dominant mega-corporation controlling infrastructure and data.',
      alignment: 'hostile',
      territory: 'Upper City',
      leader: 'CEO Damien Voss',
      traits: ['controlling', 'technologically superior', 'ruthless'],
      relationships: { 'The Neon Rats': 'enemy', 'Chrome Saints': 'enemy', 'DataWraiths': 'enemy' },
    },
    {
      name: 'The Neon Rats',
      description: 'Street gangs united under a charismatic leader fighting for the lower city.',
      alignment: 'friendly',
      territory: 'Undercity',
      leader: 'Razor Kim',
      traits: ['passionate', 'street-smart', 'under-equipped'],
      relationships: { 'Axiom Corp': 'enemy', 'Chrome Saints': 'ally', 'DataWraiths': 'neutral' },
    },
    {
      name: 'Chrome Saints',
      description: 'Cybernetically enhanced mercenaries offering protection for a price.',
      alignment: 'neutral',
      territory: 'The Midline',
      leader: 'Saint Zero',
      traits: ['augmented', 'mercenary', 'honor-bound'],
      relationships: { 'Axiom Corp': 'enemy', 'The Neon Rats': 'ally', 'DataWraiths': 'neutral' },
    },
    {
      name: 'DataWraiths',
      description: 'Elite hackers operating from the digital shadows.',
      alignment: 'neutral',
      territory: 'The Net',
      leader: 'Ghost',
      traits: ['invisible', 'information brokers', 'anarchist'],
      relationships: { 'Axiom Corp': 'enemy', 'The Neon Rats': 'neutral', 'Chrome Saints': 'neutral' },
    },
  ],
  regions: [
    { name: 'Upper City', description: 'Gleaming corporate towers and luxury residences above the smog.', biome: 'urban', dangerLevel: 3, resources: ['credits', 'advanced tech', 'corporate intel'], landmarks: ['Axiom Tower', 'Sky Garden'], connectedTo: ['The Midline'] },
    { name: 'The Midline', description: 'The commercial district, where legal and illegal trade coexist.', biome: 'urban', dangerLevel: 5, resources: ['cyberware', 'weapons', 'stim-packs'], landmarks: ['Chrome Bazaar', 'The Pit Arena'], connectedTo: ['Upper City', 'Undercity'] },
    { name: 'Undercity', description: 'Neon-lit slums built beneath the megastructures.', biome: 'urban', dangerLevel: 7, resources: ['scrap', 'bootleg software', 'street drugs'], landmarks: ['Rat King\'s Court', 'Neon Alley'], connectedTo: ['The Midline', 'The Net'] },
    { name: 'The Net', description: 'Virtual reality cyberspace where data is power.', biome: 'virtual', dangerLevel: 6, resources: ['data', 'encryption keys', 'AI fragments'], landmarks: ['The Black Market Node', 'Ghost\'s Haven'], connectedTo: ['Undercity', 'Upper City'] },
  ],
  timeline: [
    { year: 2040, name: 'The Corporate Takeover', description: 'Mega-corps replaced governments after the economic collapse.', impact: 'Democracy ended, corporate law began.', factionsInvolved: ['Axiom Corp'] },
    { year: 2065, name: 'The Augmentation Boom', description: 'Cheap cybernetics became available, transforming society.', impact: 'Created the Chrome Saints and a new underclass of augmented outcasts.', factionsInvolved: ['Chrome Saints'] },
    { year: 2078, name: 'The Net Uprising', description: 'Hackers crippled Axiom\'s surveillance network for 72 hours.', impact: 'Proved corporate control could be challenged digitally.', factionsInvolved: ['DataWraiths', 'Axiom Corp'] },
    { year: 2089, name: 'Present Day', description: 'Tensions between corps and streets reach a breaking point.', impact: 'Open conflict looms.', factionsInvolved: ['Axiom Corp', 'The Neon Rats', 'Chrome Saints', 'DataWraiths'] },
  ],
  lore: [
    { title: 'Neural Links', category: 'science', content: 'Brain-computer interfaces allow direct connection to the Net. Side effects include memory corruption and addiction.' },
    { title: 'The Street Code', category: 'culture', content: 'In the Undercity, reputation is currency. Break your word and you\'re done.' },
    { title: 'The Ghost Protocol', category: 'history', content: 'DataWraiths follow a strict code: never reveal identities, never work for corps, always share intel with the streets.' },
  ],
  rules: [
    { name: 'Cyberware Slots', description: 'Characters can install limited cybernetic augmentations.', gameplayEffect: 'Each augmentation grants abilities but risks system instability.' },
    { name: 'Reputation System', description: 'Actions in each district affect standing.', gameplayEffect: 'High rep unlocks special vendors and missions.' },
  ],
};

const MYTHOLOGICAL: GameWorld = {
  name: 'Aethermere',
  description: 'A realm where gods walk among mortals and elemental forces shape reality itself.',
  genre: 'mythological',
  era: 'The Age of Twilight',
  factions: [
    {
      name: 'The Celestial Court',
      description: 'Gods of light and order who maintain the cosmic balance.',
      alignment: 'friendly',
      territory: 'The Heavens',
      leader: 'Solarius, the Sun King',
      traits: ['righteous', 'powerful', 'inflexible'],
      relationships: { 'The Shadow Pantheon': 'enemy', 'Mortal Kingdoms': 'ally', 'Elemental Titans': 'neutral' },
    },
    {
      name: 'The Shadow Pantheon',
      description: 'Deities of chaos and darkness seeking to unmake creation.',
      alignment: 'hostile',
      territory: 'The Abyss',
      leader: 'Nyx, the Void Mother',
      traits: ['deceptive', 'corruptive', 'patient'],
      relationships: { 'The Celestial Court': 'enemy', 'Mortal Kingdoms': 'enemy', 'Elemental Titans': 'neutral' },
    },
    {
      name: 'Mortal Kingdoms',
      description: 'Human civilizations caught between divine conflicts.',
      alignment: 'friendly',
      territory: 'The Mortal Plane',
      leader: 'High King Theron',
      traits: ['adaptable', 'faithful', 'ambitious'],
      relationships: { 'The Celestial Court': 'ally', 'The Shadow Pantheon': 'enemy', 'Elemental Titans': 'neutral' },
    },
    {
      name: 'Elemental Titans',
      description: 'Primordial beings of fire, water, earth, and air — older than the gods.',
      alignment: 'neutral',
      territory: 'The Elemental Planes',
      leader: 'None (Council of Four)',
      traits: ['ancient', 'territorial', 'immensely powerful'],
      relationships: { 'The Celestial Court': 'neutral', 'The Shadow Pantheon': 'neutral', 'Mortal Kingdoms': 'neutral' },
    },
  ],
  regions: [
    { name: 'The Mortal Plane', description: 'The central realm where mortals live and die.', biome: 'varied', dangerLevel: 4, resources: ['iron', 'wood', 'prayer essence'], landmarks: ['The Grand Temple', 'City of Pillars'], connectedTo: ['The Heavens', 'The Abyss', 'The Elemental Planes'] },
    { name: 'The Heavens', description: 'Realm of light, floating islands, and celestial architecture.', biome: 'celestial', dangerLevel: 1, resources: ['divine essence', 'star metal', 'ambrosia'], landmarks: ['The Throne of Light', 'Hall of Heroes'], connectedTo: ['The Mortal Plane'] },
    { name: 'The Abyss', description: 'An endless dark realm of nightmares and twisted landscapes.', biome: 'void', dangerLevel: 10, resources: ['shadow crystals', 'void essence'], landmarks: ['The Black Citadel', 'Sea of Whispers'], connectedTo: ['The Mortal Plane'] },
    { name: 'The Elemental Planes', description: 'Four intersecting realms of pure elemental energy.', biome: 'elemental', dangerLevel: 7, resources: ['elemental cores', 'primal stone', 'living flame'], landmarks: ['The Forge of Earth', 'The Eternal Storm'], connectedTo: ['The Mortal Plane'] },
  ],
  timeline: [
    { year: -10000, name: 'The Shaping', description: 'Elemental Titans formed the world from raw chaos.', impact: 'Created the physical realm.', factionsInvolved: ['Elemental Titans'] },
    { year: -5000, name: 'The Divine War', description: 'Celestial and Shadow gods fought for dominion.', impact: 'Split reality into multiple planes.', factionsInvolved: ['The Celestial Court', 'The Shadow Pantheon'] },
    { year: 0, name: 'The Mortal Gift', description: 'Gods created mortals to serve as champions.', impact: 'Began the mortal civilizations.', factionsInvolved: ['The Celestial Court', 'Mortal Kingdoms'] },
    { year: 3000, name: 'The Age of Twilight', description: 'The barrier between planes weakens.', impact: 'Divine and shadow creatures walk the mortal world.', factionsInvolved: ['The Celestial Court', 'The Shadow Pantheon', 'Mortal Kingdoms', 'Elemental Titans'] },
  ],
  lore: [
    { title: 'The World Tree', category: 'mythology', content: 'A colossal tree whose roots connect all planes of existence. Damaging it could unravel reality.' },
    { title: 'Divine Blessing', category: 'magic', content: 'Mortals who prove worthy receive powers from their patron deity, but at a cost.' },
    { title: 'The Hero Cycle', category: 'culture', content: 'Every generation, a mortal is born with the spark of divinity, destined to reshape the world.' },
  ],
  rules: [
    { name: 'Divine Favor', description: 'Worship specific gods to gain their blessings.', gameplayEffect: 'Unlock divine abilities tied to chosen patron.' },
    { name: 'Planar Travel', description: 'Portals connect the mortal world to other planes.', gameplayEffect: 'Each plane has unique rules, enemies, and rewards.' },
  ],
};

export const WORLD_PRESETS: Record<string, GameWorld> = {
  medieval_fantasy: MEDIEVAL_FANTASY,
  sci_fi_space: SCI_FI_SPACE,
  post_apocalyptic: POST_APOCALYPTIC,
  cyberpunk_city: CYBERPUNK_CITY,
  mythological: MYTHOLOGICAL,
};

// ---- Generation ----

/**
 * Builds a system prompt for world generation.
 */
export function buildWorldPrompt(description: string, presetName?: string): string {
  const preset = presetName ? WORLD_PRESETS[presetName] : undefined;
  const presetHint = preset
    ? `\nUse the "${presetName}" genre as inspiration (similar to "${preset.name}"), but create something unique based on the user's description.`
    : '';

  return `You are a world-building assistant for a game engine. Generate a complete game world based on the user's description.
${presetHint}
User's world concept: "${description}"

Respond with ONLY valid JSON matching this exact structure (no markdown, no code fences):
{
  "name": "string",
  "description": "string (2-3 sentences)",
  "genre": "string",
  "era": "string",
  "factions": [
    {
      "name": "string",
      "description": "string",
      "alignment": "friendly" | "hostile" | "neutral",
      "territory": "string",
      "leader": "string",
      "traits": ["string"],
      "relationships": { "faction_name": "ally" | "enemy" | "neutral" }
    }
  ],
  "regions": [
    {
      "name": "string",
      "description": "string",
      "biome": "string",
      "dangerLevel": number (1-10),
      "resources": ["string"],
      "landmarks": ["string"],
      "connectedTo": ["string (region names)"]
    }
  ],
  "timeline": [
    {
      "year": number,
      "name": "string",
      "description": "string",
      "impact": "string",
      "factionsInvolved": ["string"]
    }
  ],
  "lore": [
    {
      "title": "string",
      "category": "history" | "mythology" | "science" | "culture" | "magic",
      "content": "string"
    }
  ],
  "rules": [
    {
      "name": "string",
      "description": "string",
      "gameplayEffect": "string"
    }
  ]
}

Requirements:
- Include at least 3 factions with interconnected relationships
- Include at least 4 regions with connections forming a traversable map
- Include at least 4 timeline events in chronological order
- Include at least 3 lore entries across different categories
- Include at least 2 gameplay rules
- All faction names referenced in relationships must match actual faction names
- All region names referenced in connectedTo must match actual region names`;
}

/**
 * Parse a raw AI response string into a GameWorld.
 * Strips markdown fences if present, then validates structure.
 */
export function parseWorldResponse(raw: string): GameWorld {
  // Strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    // Remove opening fence (with optional language tag)
    cleaned = cleaned.replace(/^```[a-z]*\n?/, '');
    // Remove closing fence
    cleaned = cleaned.replace(/\n?```\s*$/, '');
  }

  const parsed = JSON.parse(cleaned);

  // Validate required fields
  if (typeof parsed.name !== 'string' || !parsed.name) {
    throw new Error('World must have a name');
  }
  if (typeof parsed.description !== 'string' || !parsed.description) {
    throw new Error('World must have a description');
  }
  if (!Array.isArray(parsed.factions) || parsed.factions.length === 0) {
    throw new Error('World must have at least one faction');
  }
  if (!Array.isArray(parsed.regions) || parsed.regions.length === 0) {
    throw new Error('World must have at least one region');
  }
  if (!Array.isArray(parsed.timeline)) {
    throw new Error('World must have a timeline array');
  }
  if (!Array.isArray(parsed.lore)) {
    throw new Error('World must have a lore array');
  }
  if (!Array.isArray(parsed.rules)) {
    throw new Error('World must have a rules array');
  }

  // Validate faction alignments
  const validAlignments = new Set(['friendly', 'hostile', 'neutral']);
  for (const faction of parsed.factions) {
    if (!validAlignments.has(faction.alignment)) {
      throw new Error(`Invalid faction alignment: ${faction.alignment}`);
    }
  }

  // Validate lore categories
  const validCategories = new Set(['history', 'mythology', 'science', 'culture', 'magic']);
  for (const entry of parsed.lore) {
    if (!validCategories.has(entry.category)) {
      throw new Error(`Invalid lore category: ${entry.category}`);
    }
  }

  // Coerce nested array fields to prevent TypeError on .map()/.join()/.filter()
  for (const faction of parsed.factions) {
    if (!Array.isArray(faction.traits)) faction.traits = [];
    if (!faction.relationships || typeof faction.relationships !== 'object' || Array.isArray(faction.relationships)) faction.relationships = {};
  }
  for (const event of parsed.timeline) {
    if (!Array.isArray(event.factionsInvolved)) event.factionsInvolved = [];
  }

  // Clamp danger levels and coerce region arrays
  for (const region of parsed.regions) {
    if (!Array.isArray(region.resources)) region.resources = [];
    if (!Array.isArray(region.landmarks)) region.landmarks = [];
    if (!Array.isArray(region.connectedTo)) region.connectedTo = [];
    if (typeof region.dangerLevel === 'number') {
      region.dangerLevel = Math.max(1, Math.min(10, Math.round(region.dangerLevel)));
    } else {
      region.dangerLevel = 5;
    }
  }

  return parsed as GameWorld;
}

/**
 * Generate a world using the AI chat endpoint.
 * Falls back to a preset if generation fails.
 */
export async function generateWorld(description: string, preset?: string): Promise<GameWorld> {
  // If a preset is requested with no description, return it directly
  if (preset && !description.trim() && WORLD_PRESETS[preset]) {
    return structuredClone(WORLD_PRESETS[preset]);
  }

  const fallbackKey = preset ?? 'medieval_fantasy';
  const fallback = WORLD_PRESETS[fallbackKey] ?? WORLD_PRESETS.medieval_fantasy;

  let prompt = buildWorldPrompt(description, preset);
  // Truncate prompt to stay within the 4000-character message limit
  if (prompt.length > 3900) {
    prompt = prompt.slice(0, 3900) + '\n\n(Description truncated for length. Generate based on what is provided.)';
  }

  let response: Response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        model: AI_MODEL_PRIMARY,
        max_tokens: 4096,
        stream: false,
      }),
    });
  } catch {
    // Network error — fall back to preset
    return structuredClone(fallback);
  }

  if (!response.ok) {
    return structuredClone(fallback);
  }

  let content = '';
  const contentType = response.headers.get('content-type') ?? '';

  try {
    if (contentType.includes('text/event-stream') && response.body) {
      // SSE stream — read all chunks and extract content
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const parsed = JSON.parse(line.slice(6));
              // /api/chat SSE format: { type: 'text_delta', text: '...' }
              if (parsed.type === 'text_delta' && typeof parsed.text === 'string') {
                chunks.push(parsed.text);
              }
            } catch {
              // skip unparseable SSE lines
            }
          }
        }
      }
      content = chunks.join('');
    }
  } catch {
    return structuredClone(fallback);
  }

  try {
    return parseWorldResponse(content);
  } catch {
    // Parse failed — fall back to preset
    return structuredClone(fallback);
  }
}

// ---- Markdown Export ----

/**
 * Convert a GameWorld into a readable markdown lore document.
 */
export function worldToMarkdown(world: GameWorld): string {
  const lines: string[] = [];

  lines.push(`# ${world.name}`);
  lines.push('');
  lines.push(`*${world.era}* | Genre: ${world.genre}`);
  lines.push('');
  lines.push(world.description);
  lines.push('');

  // Factions
  lines.push('## Factions');
  lines.push('');
  for (const f of world.factions) {
    lines.push(`### ${f.name} (${f.alignment})`);
    lines.push('');
    lines.push(f.description);
    lines.push('');
    lines.push(`- **Leader:** ${f.leader}`);
    lines.push(`- **Territory:** ${f.territory}`);
    lines.push(`- **Traits:** ${f.traits.join(', ')}`);
    const rels = Object.entries(f.relationships)
      .map(([name, rel]) => `${name} (${rel})`)
      .join(', ');
    if (rels) {
      lines.push(`- **Relationships:** ${rels}`);
    }
    lines.push('');
  }

  // Regions
  lines.push('## Regions');
  lines.push('');
  for (const r of world.regions) {
    lines.push(`### ${r.name}`);
    lines.push('');
    lines.push(r.description);
    lines.push('');
    lines.push(`- **Biome:** ${r.biome}`);
    lines.push(`- **Danger Level:** ${r.dangerLevel}/10`);
    lines.push(`- **Resources:** ${r.resources.join(', ')}`);
    lines.push(`- **Landmarks:** ${r.landmarks.join(', ')}`);
    lines.push(`- **Connected To:** ${r.connectedTo.join(', ')}`);
    lines.push('');
  }

  // Timeline
  lines.push('## Timeline');
  lines.push('');
  for (const t of world.timeline) {
    lines.push(`### Year ${t.year}: ${t.name}`);
    lines.push('');
    lines.push(t.description);
    lines.push('');
    lines.push(`*Impact:* ${t.impact}`);
    if (t.factionsInvolved.length > 0) {
      lines.push(`*Factions:* ${t.factionsInvolved.join(', ')}`);
    }
    lines.push('');
  }

  // Lore
  lines.push('## Lore');
  lines.push('');
  for (const l of world.lore) {
    lines.push(`### ${l.title} [${l.category}]`);
    lines.push('');
    lines.push(l.content);
    lines.push('');
  }

  // Rules
  lines.push('## Gameplay Rules');
  lines.push('');
  for (const r of world.rules) {
    lines.push(`### ${r.name}`);
    lines.push('');
    lines.push(r.description);
    lines.push('');
    lines.push(`*Gameplay Effect:* ${r.gameplayEffect}`);
    lines.push('');
  }

  return lines.join('\n');
}
