import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  WORLD_PRESETS,
  buildWorldPrompt,
  parseWorldResponse,
  generateWorld,
  worldToMarkdown,
  validateWorldConsistency,
  healWorldConsistency,
  type GameWorld,
  type Faction,
  type Region,
  type TimelineEvent,
  type LoreEntry,
  type WorldRule,
} from '../worldBuilder';

// ---- Type structure tests ----

describe('worldBuilder types', () => {
  it('Faction type has required fields', () => {
    const faction: Faction = {
      name: 'Test Faction',
      description: 'A test faction',
      alignment: 'neutral',
      territory: 'Testlands',
      leader: 'Test Leader',
      traits: ['brave'],
      relationships: { 'Other Faction': 'ally' },
    };
    expect(faction.name).toBe('Test Faction');
    expect(faction.alignment).toBe('neutral');
    expect(faction.relationships['Other Faction']).toBe('ally');
  });

  it('Region type has required fields', () => {
    const region: Region = {
      name: 'Test Region',
      description: 'A test region',
      biome: 'forest',
      dangerLevel: 5,
      resources: ['wood'],
      landmarks: ['Big Tree'],
      connectedTo: ['Other Region'],
    };
    expect(region.dangerLevel).toBe(5);
    expect(region.connectedTo).toContain('Other Region');
  });

  it('TimelineEvent type has required fields', () => {
    const event: TimelineEvent = {
      year: 100,
      name: 'Test Event',
      description: 'Something happened',
      impact: 'Changed things',
      factionsInvolved: ['Faction A'],
    };
    expect(event.year).toBe(100);
    expect(event.factionsInvolved).toHaveLength(1);
  });

  it('LoreEntry type has valid categories', () => {
    const categories: LoreEntry['category'][] = ['history', 'mythology', 'science', 'culture', 'magic'];
    for (const cat of categories) {
      const entry: LoreEntry = { title: 'Test', category: cat, content: 'Content' };
      expect(entry.category).toBe(cat);
    }
  });

  it('WorldRule type has required fields', () => {
    const rule: WorldRule = {
      name: 'Test Rule',
      description: 'A game rule',
      gameplayEffect: 'Affects gameplay',
    };
    expect(rule.gameplayEffect).toBe('Affects gameplay');
  });

  it('GameWorld type has all sections', () => {
    const world: GameWorld = {
      name: 'Test World',
      description: 'A test',
      genre: 'fantasy',
      era: 'Age 1',
      factions: [],
      regions: [],
      timeline: [],
      lore: [],
      rules: [],
    };
    expect(world.name).toBe('Test World');
    expect(Array.isArray(world.factions)).toBe(true);
    expect(Array.isArray(world.regions)).toBe(true);
    expect(Array.isArray(world.timeline)).toBe(true);
    expect(Array.isArray(world.lore)).toBe(true);
    expect(Array.isArray(world.rules)).toBe(true);
  });
});

// ---- Presets tests ----

describe('WORLD_PRESETS', () => {
  it('contains all 5 presets', () => {
    expect(Object.keys(WORLD_PRESETS)).toHaveLength(5);
    expect(WORLD_PRESETS).toHaveProperty('medieval_fantasy');
    expect(WORLD_PRESETS).toHaveProperty('sci_fi_space');
    expect(WORLD_PRESETS).toHaveProperty('post_apocalyptic');
    expect(WORLD_PRESETS).toHaveProperty('cyberpunk_city');
    expect(WORLD_PRESETS).toHaveProperty('mythological');
  });

  it.each(Object.entries(WORLD_PRESETS))('preset "%s" has valid structure', (_key, preset) => {
    expect(preset.name).toBeTruthy();
    expect(preset.description).toBeTruthy();
    expect(preset.genre).toBeTruthy();
    expect(preset.era).toBeTruthy();
    expect(preset.factions.length).toBeGreaterThanOrEqual(3);
    expect(preset.regions.length).toBeGreaterThanOrEqual(3);
    expect(preset.timeline.length).toBeGreaterThanOrEqual(3);
    expect(preset.lore.length).toBeGreaterThanOrEqual(2);
    expect(preset.rules.length).toBeGreaterThanOrEqual(2);
  });

  it.each(Object.entries(WORLD_PRESETS))('preset "%s" factions have valid alignments', (_key, preset) => {
    const valid = new Set(['friendly', 'hostile', 'neutral']);
    for (const faction of preset.factions) {
      expect(valid.has(faction.alignment)).toBe(true);
    }
  });

  it.each(Object.entries(WORLD_PRESETS))('preset "%s" faction relationships reference real factions', (_key, preset) => {
    const factionNames = new Set(preset.factions.map((f) => f.name));
    for (const faction of preset.factions) {
      for (const relName of Object.keys(faction.relationships)) {
        expect(factionNames.has(relName)).toBe(true);
      }
    }
  });

  it.each(Object.entries(WORLD_PRESETS))('preset "%s" region connections reference real regions', (_key, preset) => {
    const regionNames = new Set(preset.regions.map((r) => r.name));
    for (const region of preset.regions) {
      for (const conn of region.connectedTo) {
        expect(regionNames.has(conn)).toBe(true);
      }
    }
  });

  it.each(Object.entries(WORLD_PRESETS))('preset "%s" danger levels are between 1-10', (_key, preset) => {
    for (const region of preset.regions) {
      expect(region.dangerLevel).toBeGreaterThanOrEqual(1);
      expect(region.dangerLevel).toBeLessThanOrEqual(10);
    }
  });

  it.each(Object.entries(WORLD_PRESETS))('preset "%s" lore entries have valid categories', (_key, preset) => {
    const valid = new Set(['history', 'mythology', 'science', 'culture', 'magic']);
    for (const entry of preset.lore) {
      expect(valid.has(entry.category)).toBe(true);
    }
  });

  it.each(Object.entries(WORLD_PRESETS))('preset "%s" timeline is in chronological order', (_key, preset) => {
    for (let i = 1; i < preset.timeline.length; i++) {
      expect(preset.timeline[i].year).toBeGreaterThanOrEqual(preset.timeline[i - 1].year);
    }
  });
});

// ---- buildWorldPrompt tests ----

describe('buildWorldPrompt', () => {
  it('includes user description in prompt', () => {
    const prompt = buildWorldPrompt('A world of floating islands');
    expect(prompt).toContain('A world of floating islands');
  });

  it('includes JSON structure requirements', () => {
    const prompt = buildWorldPrompt('Test');
    expect(prompt).toContain('"factions"');
    expect(prompt).toContain('"regions"');
    expect(prompt).toContain('"timeline"');
    expect(prompt).toContain('"lore"');
    expect(prompt).toContain('"rules"');
  });

  it('includes preset hint when preset is provided', () => {
    const prompt = buildWorldPrompt('My world', 'medieval_fantasy');
    expect(prompt).toContain('medieval_fantasy');
    expect(prompt).toContain('Eldoria');
  });

  it('omits preset hint when no preset', () => {
    const prompt = buildWorldPrompt('My world');
    expect(prompt).not.toContain('Use the "');
  });

  it('handles unknown preset gracefully', () => {
    const prompt = buildWorldPrompt('My world', 'nonexistent');
    // No preset found, so no hint
    expect(prompt).not.toContain('Use the "');
  });
});

// ---- parseWorldResponse tests ----

describe('parseWorldResponse', () => {
  const validWorld: GameWorld = {
    name: 'Test World',
    description: 'A test world',
    genre: 'fantasy',
    era: 'Test Era',
    factions: [
      {
        name: 'Faction A',
        description: 'Test',
        alignment: 'friendly',
        territory: 'North',
        leader: 'Leader A',
        traits: ['brave'],
        relationships: {},
      },
    ],
    regions: [
      {
        name: 'Region A',
        description: 'Test',
        biome: 'forest',
        dangerLevel: 5,
        resources: ['wood'],
        landmarks: ['Tree'],
        connectedTo: [],
      },
    ],
    timeline: [{ year: 0, name: 'Event', description: 'Test', impact: 'None', factionsInvolved: [] }],
    lore: [{ title: 'Lore', category: 'history', content: 'Test' }],
    rules: [{ name: 'Rule', description: 'Test', gameplayEffect: 'None' }],
  };

  it('parses valid JSON', () => {
    const result = parseWorldResponse(JSON.stringify(validWorld));
    expect(result.name).toBe('Test World');
    expect(result.factions).toHaveLength(1);
  });

  it('strips markdown code fences', () => {
    const wrapped = '```json\n' + JSON.stringify(validWorld) + '\n```';
    const result = parseWorldResponse(wrapped);
    expect(result.name).toBe('Test World');
  });

  it('strips code fences without language tag', () => {
    const wrapped = '```\n' + JSON.stringify(validWorld) + '\n```';
    const result = parseWorldResponse(wrapped);
    expect(result.name).toBe('Test World');
  });

  it('throws on missing name', () => {
    const bad = { ...validWorld, name: '' };
    expect(() => parseWorldResponse(JSON.stringify(bad))).toThrow('World must have a name');
  });

  it('throws on missing description', () => {
    const bad = { ...validWorld, description: '' };
    expect(() => parseWorldResponse(JSON.stringify(bad))).toThrow('World must have a description');
  });

  it('throws on empty factions', () => {
    const bad = { ...validWorld, factions: [] };
    expect(() => parseWorldResponse(JSON.stringify(bad))).toThrow('at least one faction');
  });

  it('throws on empty regions', () => {
    const bad = { ...validWorld, regions: [] };
    expect(() => parseWorldResponse(JSON.stringify(bad))).toThrow('at least one region');
  });

  it('throws on missing timeline', () => {
    const bad = { ...validWorld, timeline: 'not-array' };
    expect(() => parseWorldResponse(JSON.stringify(bad))).toThrow('timeline array');
  });

  it('throws on missing lore', () => {
    const bad = { ...validWorld, lore: null };
    expect(() => parseWorldResponse(JSON.stringify(bad))).toThrow('lore array');
  });

  it('throws on missing rules', () => {
    const bad = { ...validWorld, rules: 'string' };
    expect(() => parseWorldResponse(JSON.stringify(bad))).toThrow('rules array');
  });

  it('throws on invalid faction alignment', () => {
    const bad = {
      ...validWorld,
      factions: [{ ...validWorld.factions[0], alignment: 'chaotic' }],
    };
    expect(() => parseWorldResponse(JSON.stringify(bad))).toThrow('Invalid faction alignment');
  });

  it('throws on invalid lore category', () => {
    const bad = {
      ...validWorld,
      lore: [{ title: 'Test', category: 'cooking', content: 'Test' }],
    };
    expect(() => parseWorldResponse(JSON.stringify(bad))).toThrow('Invalid lore category');
  });

  it('clamps danger level to 1-10 range', () => {
    const data = {
      ...validWorld,
      regions: [{ ...validWorld.regions[0], dangerLevel: 15 }],
    };
    const result = parseWorldResponse(JSON.stringify(data));
    expect(result.regions[0].dangerLevel).toBe(10);
  });

  it('clamps danger level minimum to 1', () => {
    const data = {
      ...validWorld,
      regions: [{ ...validWorld.regions[0], dangerLevel: -3 }],
    };
    const result = parseWorldResponse(JSON.stringify(data));
    expect(result.regions[0].dangerLevel).toBe(1);
  });

  it('defaults non-numeric danger level to 5', () => {
    const data = {
      ...validWorld,
      regions: [{ ...validWorld.regions[0], dangerLevel: 'high' }],
    };
    const result = parseWorldResponse(JSON.stringify(data));
    expect(result.regions[0].dangerLevel).toBe(5);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseWorldResponse('not json')).toThrow();
  });
});

// ---- generateWorld tests ----

describe('generateWorld', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns preset directly when preset given with no description', async () => {
    const result = await generateWorld('', 'medieval_fantasy');
    expect(result.name).toBe('Eldoria');
    // Should not have called fetch
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns preset directly for whitespace-only description', async () => {
    const result = await generateWorld('   ', 'sci_fi_space');
    expect(result.name).toBe('Nexus Expanse');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns a deep clone of preset (not reference)', async () => {
    const result = await generateWorld('', 'medieval_fantasy');
    result.name = 'Modified';
    expect(WORLD_PRESETS.medieval_fantasy.name).toBe('Eldoria');
  });

  it('calls fetch for AI generation when description provided', async () => {
    const mockWorld: GameWorld = {
      name: 'AI World',
      description: 'Generated',
      genre: 'custom',
      era: 'Now',
      factions: [{ name: 'F', description: 'D', alignment: 'neutral', territory: 'T', leader: 'L', traits: [], relationships: {} }],
      regions: [{ name: 'R', description: 'D', biome: 'b', dangerLevel: 3, resources: [], landmarks: [], connectedTo: [] }],
      timeline: [],
      lore: [],
      rules: [],
    };

    const encoder = new TextEncoder();
    const sseData = `data: {"type":"text_delta","text":"${JSON.stringify(mockWorld).replace(/"/g, '\\"')}"}\ndata: [DONE]\n`;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseData));
          controller.close();
        },
      }),
    } as Response);

    const result = await generateWorld('A unique world');
    expect(fetch).toHaveBeenCalledOnce();
    expect(result.name).toBe('AI World');
  });

  it('throws on API error with message from response', async () => {
    // fetchAI maps 402 / "insufficient credits" to a user-friendly message
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'insufficient credits' }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      }) as unknown as Response,
    );

    await expect(generateWorld('A world', 'cyberpunk_city')).rejects.toThrow(/credits/i);
  });

  it('throws on API error when no preset specified', async () => {
    // fetchAI maps 500 / "internal server" to a user-friendly message
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }) as unknown as Response,
    );

    await expect(generateWorld('A world')).rejects.toThrow(/service error/i);
  });

  it('falls back on parse error from AI response', async () => {
    // Return an SSE stream with unparseable JSON — generateWorld catches parse errors
    // and falls back to the preset
    const encoder = new TextEncoder();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"type":"text_delta","text":"not valid json"}\ndata: {"type":"done"}\n'));
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ) as unknown as Response,
    );

    const result = await generateWorld('A world', 'post_apocalyptic');
    expect(result.name).toBe('The Scarred Earth');
  });

  // "handles response in choices format" removed — the JSON/choices code path
  // was deleted in favor of SSE-only streaming. The /api/chat endpoint always
  // returns text/event-stream.
});

// ---- worldToMarkdown tests ----

describe('worldToMarkdown', () => {
  const sampleWorld = WORLD_PRESETS.medieval_fantasy;

  it('starts with world name as heading', () => {
    const md = worldToMarkdown(sampleWorld);
    expect(md).toMatch(/^# Eldoria/);
  });

  it('includes era and genre', () => {
    const md = worldToMarkdown(sampleWorld);
    expect(md).toContain('Third Age of Wonders');
    expect(md).toContain('medieval_fantasy');
  });

  it('includes faction section with all factions', () => {
    const md = worldToMarkdown(sampleWorld);
    expect(md).toContain('## Factions');
    for (const faction of sampleWorld.factions) {
      expect(md).toContain(`### ${faction.name}`);
    }
  });

  it('includes region section with danger levels', () => {
    const md = worldToMarkdown(sampleWorld);
    expect(md).toContain('## Regions');
    expect(md).toContain('/10');
  });

  it('includes timeline section with years', () => {
    const md = worldToMarkdown(sampleWorld);
    expect(md).toContain('## Timeline');
    expect(md).toContain('Year 0');
  });

  it('includes lore section with categories', () => {
    const md = worldToMarkdown(sampleWorld);
    expect(md).toContain('## Lore');
    expect(md).toContain('[magic]');
  });

  it('includes rules section', () => {
    const md = worldToMarkdown(sampleWorld);
    expect(md).toContain('## Gameplay Rules');
    expect(md).toContain('Gameplay Effect:');
  });

  it('handles empty factions involved in timeline', () => {
    const world: GameWorld = {
      ...sampleWorld,
      timeline: [{ year: 0, name: 'Event', description: 'Test', impact: 'None', factionsInvolved: [] }],
    };
    const md = worldToMarkdown(world);
    expect(md).toContain('Year 0: Event');
    // Should not include Factions: line when empty
    expect(md).not.toContain('*Factions:* \n');
  });

  it('includes faction relationships in output', () => {
    const md = worldToMarkdown(sampleWorld);
    expect(md).toContain('**Relationships:**');
    expect(md).toContain('(ally)');
    expect(md).toContain('(enemy)');
  });
});

// ---- validateWorldConsistency tests ----

describe('validateWorldConsistency', () => {
  const makeWorld = (overrides: Partial<GameWorld> = {}): GameWorld => ({
    name: 'Test World',
    description: 'Test',
    genre: 'fantasy',
    era: 'Age 1',
    factions: [
      { name: 'Alpha', description: 'A', alignment: 'friendly', territory: 'T1', leader: 'L1', traits: [], relationships: { Beta: 'ally' } },
      { name: 'Beta', description: 'B', alignment: 'hostile', territory: 'T2', leader: 'L2', traits: [], relationships: { Alpha: 'ally' } },
    ],
    regions: [
      { name: 'North', description: 'N', biome: 'tundra', dangerLevel: 3, resources: [], landmarks: [], connectedTo: ['South'] },
      { name: 'South', description: 'S', biome: 'desert', dangerLevel: 5, resources: [], landmarks: [], connectedTo: ['North'] },
    ],
    timeline: [
      { year: 0, name: 'Founding', description: 'Founded', impact: 'Started', factionsInvolved: ['Alpha'] },
      { year: 100, name: 'War', description: 'War', impact: 'Changed things', factionsInvolved: ['Alpha', 'Beta'] },
    ],
    lore: [{ title: 'The Legend', category: 'mythology', content: 'Old story' }],
    rules: [{ name: 'Magic', description: 'Works here', gameplayEffect: 'Spell bonus' }],
    ...overrides,
  });

  it('returns valid=true for internally consistent world', () => {
    const report = validateWorldConsistency(makeWorld());
    expect(report.valid).toBe(true);
    const errors = report.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  it('detects asymmetric faction relationships (error)', () => {
    const world = makeWorld({
      factions: [
        { name: 'Alpha', description: 'A', alignment: 'friendly', territory: 'T', leader: 'L', traits: [], relationships: { Beta: 'enemy' } },
        { name: 'Beta', description: 'B', alignment: 'neutral', territory: 'T', leader: 'L', traits: [], relationships: { Alpha: 'ally' } },
      ],
    });
    const report = validateWorldConsistency(world);
    expect(report.valid).toBe(false);
    const asym = report.issues.find((i) => i.category === 'faction_symmetry' && i.severity === 'error');
    expect(asym).toBeDefined();
    expect(asym?.message).toContain('Asymmetric relationship');
  });

  it('detects unknown faction name in relationships (error)', () => {
    const world = makeWorld({
      factions: [
        { name: 'Alpha', description: 'A', alignment: 'friendly', territory: 'T', leader: 'L', traits: [], relationships: { Gamma: 'ally' } },
        { name: 'Beta', description: 'B', alignment: 'neutral', territory: 'T', leader: 'L', traits: [], relationships: {} },
      ],
    });
    const report = validateWorldConsistency(world);
    expect(report.valid).toBe(false);
    const err = report.issues.find((i) => i.category === 'faction_symmetry' && i.message.includes('unknown faction "Gamma"'));
    expect(err).toBeDefined();
  });

  it('detects missing reverse relationship (warning, not error)', () => {
    const world = makeWorld({
      factions: [
        { name: 'Alpha', description: 'A', alignment: 'friendly', territory: 'T', leader: 'L', traits: [], relationships: { Beta: 'ally' } },
        { name: 'Beta', description: 'B', alignment: 'neutral', territory: 'T', leader: 'L', traits: [], relationships: {} },
      ],
    });
    const report = validateWorldConsistency(world);
    const warn = report.issues.find((i) => i.category === 'faction_symmetry' && i.severity === 'warning');
    expect(warn).toBeDefined();
  });

  it('detects missing relationship completeness (warning)', () => {
    const world = makeWorld({
      factions: [
        { name: 'Alpha', description: 'A', alignment: 'friendly', territory: 'T', leader: 'L', traits: [], relationships: {} },
        { name: 'Beta', description: 'B', alignment: 'neutral', territory: 'T', leader: 'L', traits: [], relationships: {} },
      ],
    });
    const report = validateWorldConsistency(world);
    const warn = report.issues.find((i) => i.category === 'relationship_completeness' && i.severity === 'warning');
    expect(warn).toBeDefined();
  });

  it('detects isolated region (warning)', () => {
    const world = makeWorld({
      regions: [
        { name: 'North', description: 'N', biome: 'tundra', dangerLevel: 3, resources: [], landmarks: [], connectedTo: [] },
        { name: 'South', description: 'S', biome: 'desert', dangerLevel: 5, resources: [], landmarks: [], connectedTo: [] },
      ],
    });
    const report = validateWorldConsistency(world);
    const warn = report.issues.find((i) => i.category === 'region_connectivity' && i.severity === 'warning');
    expect(warn).toBeDefined();
    expect(warn?.message).toContain('isolated');
  });

  it('detects unknown region in connectedTo (error)', () => {
    const world = makeWorld({
      regions: [
        { name: 'North', description: 'N', biome: 'tundra', dangerLevel: 3, resources: [], landmarks: [], connectedTo: ['Atlantis'] },
        { name: 'South', description: 'S', biome: 'desert', dangerLevel: 5, resources: [], landmarks: [], connectedTo: ['North'] },
      ],
    });
    const report = validateWorldConsistency(world);
    expect(report.valid).toBe(false);
    const err = report.issues.find((i) => i.category === 'region_connectivity' && i.message.includes('Atlantis'));
    expect(err).toBeDefined();
  });

  it('detects timeline out of order (error)', () => {
    const world = makeWorld({
      timeline: [
        { year: 100, name: 'A', description: 'A', impact: 'A', factionsInvolved: [] },
        { year: 50, name: 'B', description: 'B', impact: 'B', factionsInvolved: [] },
      ],
    });
    const report = validateWorldConsistency(world);
    expect(report.valid).toBe(false);
    const err = report.issues.find((i) => i.category === 'timeline_ordering' && i.severity === 'error');
    expect(err).toBeDefined();
  });

  it('detects duplicate timeline year (warning)', () => {
    const world = makeWorld({
      timeline: [
        { year: 0, name: 'A', description: 'A', impact: 'A', factionsInvolved: [] },
        { year: 0, name: 'B', description: 'B', impact: 'B', factionsInvolved: [] },
      ],
    });
    const report = validateWorldConsistency(world);
    const warn = report.issues.find((i) => i.category === 'timeline_ordering' && i.severity === 'warning');
    expect(warn).toBeDefined();
  });

  it('detects duplicate faction names (error)', () => {
    const world = makeWorld({
      factions: [
        { name: 'Alpha', description: 'A', alignment: 'friendly', territory: 'T', leader: 'L', traits: [], relationships: {} },
        { name: 'Alpha', description: 'B', alignment: 'neutral', territory: 'T', leader: 'L', traits: [], relationships: {} },
      ],
    });
    const report = validateWorldConsistency(world);
    expect(report.valid).toBe(false);
    const err = report.issues.find((i) => i.category === 'name_uniqueness' && i.message.includes('"Alpha"'));
    expect(err).toBeDefined();
  });

  it('detects duplicate region names (error)', () => {
    const world = makeWorld({
      regions: [
        { name: 'North', description: 'N', biome: 'tundra', dangerLevel: 3, resources: [], landmarks: [], connectedTo: [] },
        { name: 'North', description: 'N2', biome: 'desert', dangerLevel: 5, resources: [], landmarks: [], connectedTo: [] },
      ],
    });
    const report = validateWorldConsistency(world);
    expect(report.valid).toBe(false);
    const err = report.issues.find((i) => i.category === 'name_uniqueness' && i.message.includes('"North"'));
    expect(err).toBeDefined();
  });

  it('detects unknown faction in timeline factionsInvolved (warning)', () => {
    const world = makeWorld({
      timeline: [
        { year: 0, name: 'Event', description: 'E', impact: 'I', factionsInvolved: ['Gamma'] },
      ],
    });
    const report = validateWorldConsistency(world);
    const warn = report.issues.find((i) => i.category === 'lore_references' && i.severity === 'warning');
    expect(warn).toBeDefined();
    expect(warn?.message).toContain('Gamma');
  });

  it('handles single-faction world: no relationship errors', () => {
    const world = makeWorld({
      factions: [
        { name: 'Solo', description: 'A', alignment: 'neutral', territory: 'T', leader: 'L', traits: [], relationships: {} },
      ],
    });
    const report = validateWorldConsistency(world);
    // Single faction: no relationship completeness issues
    const relErrors = report.issues.filter((i) => i.category === 'relationship_completeness');
    expect(relErrors).toHaveLength(0);
  });

  it('handles single-region world: no connectivity issues', () => {
    const world = makeWorld({
      regions: [
        { name: 'Lone Isle', description: 'N', biome: 'island', dangerLevel: 3, resources: [], landmarks: [], connectedTo: [] },
      ],
    });
    const report = validateWorldConsistency(world);
    const connIssues = report.issues.filter((i) => i.category === 'region_connectivity');
    expect(connIssues).toHaveLength(0);
  });

  it('all presets pass consistency validation', () => {
    for (const [key, preset] of Object.entries(WORLD_PRESETS)) {
      const report = validateWorldConsistency(preset);
      const errors = report.issues.filter((i) => i.severity === 'error');
      expect(errors, `Preset "${key}" has consistency errors`).toHaveLength(0);
    }
  });

  it('10-faction world with full relationships passes validation', () => {
    const factionNames = Array.from({ length: 10 }, (_, i) => `F${i}`);
    // Use 'neutral' for ALL pairs to guarantee full symmetry
    const factions = factionNames.map((name) => ({
      name,
      description: name,
      alignment: 'neutral' as const,
      territory: name,
      leader: name,
      traits: [],
      relationships: Object.fromEntries(
        factionNames.filter((n) => n !== name).map((n) => [n, 'neutral'] as [string, 'neutral'])
      ),
    }));
    const world = makeWorld({ factions });
    const report = validateWorldConsistency(world);
    // All relationships are symmetric (all neutral)
    const symErrors = report.issues.filter((i) => i.category === 'faction_symmetry' && i.severity === 'error');
    expect(symErrors).toHaveLength(0);
    // 10 factions * 9 others = 90 relationship entries
    const totalRels = factions.reduce((sum, f) => sum + Object.keys(f.relationships).length, 0);
    expect(totalRels).toBe(90);
  });
});

// ---- healWorldConsistency tests ----

describe('healWorldConsistency', () => {
  const makeWorld = (overrides: Partial<GameWorld> = {}): GameWorld => ({
    name: 'Test',
    description: 'Test',
    genre: 'fantasy',
    era: 'Age 1',
    factions: [
      { name: 'Alpha', description: 'A', alignment: 'friendly', territory: 'T', leader: 'L', traits: [], relationships: { Beta: 'enemy' } },
      { name: 'Beta', description: 'B', alignment: 'hostile', territory: 'T', leader: 'L', traits: [], relationships: { Alpha: 'ally' } },
    ],
    regions: [
      { name: 'North', description: 'N', biome: 'tundra', dangerLevel: 3, resources: [], landmarks: [], connectedTo: ['South'] },
      { name: 'South', description: 'S', biome: 'desert', dangerLevel: 5, resources: [], landmarks: [], connectedTo: [] },
    ],
    timeline: [
      { year: 100, name: 'Later', description: 'L', impact: 'I', factionsInvolved: [] },
      { year: 0, name: 'Earlier', description: 'E', impact: 'I', factionsInvolved: [] },
    ],
    lore: [{ title: 'L', category: 'history', content: 'C' }],
    rules: [{ name: 'R', description: 'D', gameplayEffect: 'G' }],
    ...overrides,
  });

  it('heals asymmetric relationships', () => {
    const healed = healWorldConsistency(makeWorld());
    const alpha = healed.factions.find((f) => f.name === 'Alpha')!;
    const beta = healed.factions.find((f) => f.name === 'Beta')!;
    // Should be symmetric after healing
    expect(alpha.relationships.Beta).toBe(beta.relationships.Alpha);
  });

  it('sorts timeline chronologically', () => {
    const healed = healWorldConsistency(makeWorld());
    expect(healed.timeline[0].year).toBe(0);
    expect(healed.timeline[1].year).toBe(100);
  });

  it('fills missing relationships with neutral', () => {
    const world = makeWorld({
      factions: [
        { name: 'Alpha', description: 'A', alignment: 'friendly', territory: 'T', leader: 'L', traits: [], relationships: {} },
        { name: 'Beta', description: 'B', alignment: 'neutral', territory: 'T', leader: 'L', traits: [], relationships: {} },
        { name: 'Gamma', description: 'C', alignment: 'hostile', territory: 'T', leader: 'L', traits: [], relationships: {} },
      ],
    });
    const healed = healWorldConsistency(world);
    const alpha = healed.factions.find((f) => f.name === 'Alpha')!;
    expect(alpha.relationships.Beta).toBe('neutral');
    expect(alpha.relationships.Gamma).toBe('neutral');
  });

  it('removes duplicate faction names, keeping first', () => {
    const world = makeWorld({
      factions: [
        { name: 'Alpha', description: 'A', alignment: 'friendly', territory: 'T', leader: 'L1', traits: [], relationships: {} },
        { name: 'Alpha', description: 'A2', alignment: 'neutral', territory: 'T', leader: 'L2', traits: [], relationships: {} },
        { name: 'Beta', description: 'B', alignment: 'hostile', territory: 'T', leader: 'L3', traits: [], relationships: {} },
      ],
    });
    const healed = healWorldConsistency(world);
    const alphas = healed.factions.filter((f) => f.name === 'Alpha');
    expect(alphas).toHaveLength(1);
    expect(alphas[0].leader).toBe('L1');
  });

  it('removes duplicate region names, keeping first', () => {
    const world = makeWorld({
      regions: [
        { name: 'North', description: 'N1', biome: 'tundra', dangerLevel: 3, resources: [], landmarks: [], connectedTo: [] },
        { name: 'North', description: 'N2', biome: 'desert', dangerLevel: 5, resources: [], landmarks: [], connectedTo: [] },
        { name: 'South', description: 'S', biome: 'plains', dangerLevel: 1, resources: [], landmarks: [], connectedTo: [] },
      ],
    });
    const healed = healWorldConsistency(world);
    const norths = healed.regions.filter((r) => r.name === 'North');
    expect(norths).toHaveLength(1);
    expect(norths[0].description).toBe('N1');
  });

  it('does not mutate the original world', () => {
    const original = makeWorld();
    const _healed = healWorldConsistency(original);
    // Original timeline should still be disordered
    expect(original.timeline[0].year).toBe(100);
  });

  it('healed world passes consistency validation', () => {
    const world = makeWorld();
    const healed = healWorldConsistency(world);
    const report = validateWorldConsistency(healed);
    const errors = report.issues.filter((i) => i.severity === 'error');
    expect(errors).toHaveLength(0);
  });
});
