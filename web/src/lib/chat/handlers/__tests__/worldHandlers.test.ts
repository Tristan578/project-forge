import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { worldHandlers, persistWorld, loadPersistedWorld, clearPersistedWorld } from '../worldHandlers';
import type { GameWorld } from '@/lib/ai/worldBuilder';

// ---- Helpers ----

function makeContext() {
  return {
    store: {} as Parameters<typeof worldHandlers['build_world']>[1]['store'],
    dispatchCommand: vi.fn(),
  };
}

const VALID_WORLD: GameWorld = {
  name: 'Test World',
  description: 'A generated world',
  genre: 'fantasy',
  era: 'Age 1',
  factions: [
    { name: 'Alpha', description: 'A', alignment: 'friendly', territory: 'T1', leader: 'L1', traits: [], relationships: { Beta: 'ally', Gamma: 'neutral' } },
    { name: 'Beta', description: 'B', alignment: 'hostile', territory: 'T2', leader: 'L2', traits: [], relationships: { Alpha: 'ally', Gamma: 'enemy' } },
    { name: 'Gamma', description: 'C', alignment: 'neutral', territory: 'T3', leader: 'L3', traits: [], relationships: { Alpha: 'neutral', Beta: 'enemy' } },
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
};

// ---- localStorage helpers ----

describe('persistWorld / loadPersistedWorld / clearPersistedWorld', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists and loads a world', () => {
    persistWorld(VALID_WORLD);
    const loaded = loadPersistedWorld();
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe('Test World');
    expect(loaded?.factions).toHaveLength(3);
  });

  it('returns null when nothing persisted', () => {
    const loaded = loadPersistedWorld();
    expect(loaded).toBeNull();
  });

  it('clears persisted world', () => {
    persistWorld(VALID_WORLD);
    clearPersistedWorld();
    expect(loadPersistedWorld()).toBeNull();
  });

  it('overwrites existing world on second persist', () => {
    persistWorld(VALID_WORLD);
    persistWorld({ ...VALID_WORLD, name: 'New World' });
    const loaded = loadPersistedWorld();
    expect(loaded?.name).toBe('New World');
  });
});

// ---- get_current_world handler ----

describe('get_current_world handler', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns error when no world persisted', async () => {
    const result = await worldHandlers.get_current_world({}, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toContain('No world data');
  });

  it('returns world when persisted', async () => {
    persistWorld(VALID_WORLD);
    const result = await worldHandlers.get_current_world({}, makeContext());
    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
    const data = result.result as { world: GameWorld };
    expect(data.world.name).toBe('Test World');
  });

  it('includes consistency report in result', async () => {
    persistWorld(VALID_WORLD);
    const result = await worldHandlers.get_current_world({}, makeContext());
    expect(result.success).toBe(true);
    const data = result.result as { world: GameWorld; consistencyReport: { valid: boolean; issues: unknown[] } };
    expect(typeof data.consistencyReport.valid).toBe('boolean');
    expect(Array.isArray(data.consistencyReport.issues)).toBe(true);
  });

  it('message includes faction and region counts', async () => {
    persistWorld(VALID_WORLD);
    const result = await worldHandlers.get_current_world({}, makeContext());
    expect(result.message).toContain('3 factions');
    expect(result.message).toContain('2 regions');
  });
});

// ---- clear_world handler ----

describe('clear_world handler', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clears persisted world', async () => {
    persistWorld(VALID_WORLD);
    await worldHandlers.clear_world({}, makeContext());
    expect(loadPersistedWorld()).toBeNull();
  });

  it('returns success', async () => {
    const result = await worldHandlers.clear_world({}, makeContext());
    expect(result.success).toBe(true);
  });

  it('succeeds even when no world exists', async () => {
    const result = await worldHandlers.clear_world({}, makeContext());
    expect(result.success).toBe(true);
  });
});

// ---- build_world handler ----

describe('build_world handler', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function mockFetchWithWorld(world: GameWorld) {
    const encoder = new TextEncoder();
    const sseData = `data: {"type":"text_delta","text":"${JSON.stringify(world).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"}\ndata: [DONE]\n`;
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
  }

  it('returns error when premise is missing', async () => {
    const result = await worldHandlers.build_world({}, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments');
  });

  it('returns error when premise is empty string', async () => {
    const result = await worldHandlers.build_world({ premise: '' }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments');
  });

  it('returns error when factionCount exceeds 10', async () => {
    const result = await worldHandlers.build_world({ premise: 'test', factionCount: 11 }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments');
  });

  it('returns error when regionCount exceeds 20', async () => {
    const result = await worldHandlers.build_world({ premise: 'test', regionCount: 21 }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid arguments');
  });

  it('returns error when factionCount is 0', async () => {
    const result = await worldHandlers.build_world({ premise: 'test', factionCount: 0 }, makeContext());
    expect(result.success).toBe(false);
  });

  it('succeeds and returns world on valid AI response', async () => {
    mockFetchWithWorld(VALID_WORLD);
    const result = await worldHandlers.build_world({ premise: 'A fantasy world' }, makeContext());
    expect(result.success).toBe(true);
    const data = result.result as { world: GameWorld };
    expect(data.world.name).toBe('Test World');
  });

  it('persists world to localStorage on success', async () => {
    mockFetchWithWorld(VALID_WORLD);
    await worldHandlers.build_world({ premise: 'A fantasy world' }, makeContext());
    const stored = loadPersistedWorld();
    expect(stored).not.toBeNull();
    expect(stored?.name).toBe('Test World');
  });

  it('includes consistency report in result', async () => {
    mockFetchWithWorld(VALID_WORLD);
    const result = await worldHandlers.build_world({ premise: 'A fantasy world' }, makeContext());
    expect(result.success).toBe(true);
    const data = result.result as { world: GameWorld; consistencyReport: { valid: boolean } };
    expect(typeof data.consistencyReport.valid).toBe('boolean');
  });

  it('message includes world name', async () => {
    mockFetchWithWorld(VALID_WORLD);
    const result = await worldHandlers.build_world({ premise: 'A fantasy world' }, makeContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain('Test World');
  });

  it('message includes faction count', async () => {
    mockFetchWithWorld(VALID_WORLD);
    const result = await worldHandlers.build_world({ premise: 'A fantasy world' }, makeContext());
    expect(result.success).toBe(true);
    expect(result.message).toContain('3');
  });

  it('falls back to preset when AI returns unparseable JSON', async () => {
    const encoder = new TextEncoder();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"text_delta","text":"not json"}\ndata: [DONE]\n'));
          controller.close();
        },
      }),
    } as Response);
    const result = await worldHandlers.build_world({ premise: 'test', genre: 'medieval_fantasy' }, makeContext());
    // Falls back to preset (which we then self-heal + validate)
    expect(result.success).toBe(true);
  });

  it('surfaces auth errors immediately (does not fall back)', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'insufficient credits' }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' },
      }) as unknown as Response,
    );
    const result = await worldHandlers.build_world({ premise: 'test' }, makeContext());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/credits/i);
  });

  it('accepts optional genre parameter', async () => {
    mockFetchWithWorld(VALID_WORLD);
    const result = await worldHandlers.build_world({
      premise: 'test world',
      genre: 'sci_fi_space',
    }, makeContext());
    expect(result.success).toBe(true);
  });

  it('accepts optional factionCount parameter', async () => {
    mockFetchWithWorld(VALID_WORLD);
    const result = await worldHandlers.build_world({
      premise: 'test world',
      factionCount: 5,
    }, makeContext());
    expect(result.success).toBe(true);
  });

  it('accepts optional regionCount parameter', async () => {
    mockFetchWithWorld(VALID_WORLD);
    const result = await worldHandlers.build_world({
      premise: 'test world',
      regionCount: 8,
    }, makeContext());
    expect(result.success).toBe(true);
  });

  it('fallback flag is false on successful generation', async () => {
    mockFetchWithWorld(VALID_WORLD);
    const result = await worldHandlers.build_world({ premise: 'test' }, makeContext());
    expect(result.success).toBe(true);
    const data = result.result as { fallback: boolean };
    expect(data.fallback).toBe(false);
  });
});
