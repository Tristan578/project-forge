/**
 * Tests for the `design_economy` MCP command handler.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { economyHandlers } from '../economyHandlers';
import type { ToolCallContext } from '../types';
import type { EditorState } from '@/stores/editorStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(): ToolCallContext {
  return {
    store: {} as EditorState,
    dispatchCommand: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// design_economy — argument validation
// ---------------------------------------------------------------------------

describe('design_economy — argument validation', () => {
  it('returns error when gameDescription is missing', async () => {
    const result = await economyHandlers.design_economy({}, makeCtx());
    expect(result.success).toBe(false);
    expect(result.error).toContain('gameDescription');
  });

  it('returns error when gameDescription is empty string', async () => {
    const result = await economyHandlers.design_economy({ gameDescription: '' }, makeCtx());
    expect(result.success).toBe(false);
    expect(result.error).toContain('gameDescription');
  });

  it('returns error for unknown preset', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'A fun game', preset: 'unknown_preset' },
      makeCtx(),
    );
    expect(result.success).toBe(false);
    // Zod enum validation catches this
    expect(result.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// design_economy — successful generation
// ---------------------------------------------------------------------------

describe('design_economy — successful generation', () => {
  it('succeeds with a minimal valid description', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'A casual mobile game' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
  });

  it('result contains economy object', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'A casual mobile game' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(data.economy).toBeDefined();
    const eco = data.economy as { currencies: unknown[]; shop: unknown[]; lootTables: unknown[] };
    expect(Array.isArray(eco.currencies)).toBe(true);
    expect(eco.currencies.length).toBeGreaterThan(0);
    expect(Array.isArray(eco.shop)).toBe(true);
    expect(Array.isArray(eco.lootTables)).toBe(true);
  });

  it('result contains balanceReport', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'An RPG with quests' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(data.balanceReport).toBeDefined();
    const report = data.balanceReport as { score: number; passed: boolean; issues: unknown[] };
    expect(typeof report.score).toBe('number');
    expect(typeof report.passed).toBe('boolean');
    expect(Array.isArray(report.issues)).toBe(true);
  });

  it('result contains script source code', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'A fun idle game' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(typeof data.script).toBe('string');
    expect(data.script as string).toContain('function buyItem');
    expect(data.script as string).toContain('function rollLootTable');
  });

  it('result contains human-readable summary', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'A roguelike with souls' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(typeof data.summary).toBe('string');
    expect(data.summary as string).toContain('Balance score:');
    expect(data.summary as string).toContain('Currencies:');
  });
});

// ---------------------------------------------------------------------------
// design_economy — preset selection
// ---------------------------------------------------------------------------

describe('design_economy — preset selection', () => {
  const PRESETS = [
    'casual_mobile',
    'rpg_classic',
    'roguelike',
    'idle_incremental',
    'competitive_pvp',
  ] as const;

  it.each(PRESETS)('accepts preset "%s" and returns matching economy', async (preset) => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'A game', preset },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(data.economy).toBeDefined();
  });

  it('casual_mobile preset yields single Coins currency', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'any', preset: 'casual_mobile' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    const eco = data.economy as { currencies: Array<{ name: string }> };
    expect(eco.currencies).toHaveLength(1);
    expect(eco.currencies[0].name).toBe('Coins');
  });

  it('roguelike preset yields Souls currency', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'any', preset: 'roguelike' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    const eco = data.economy as { currencies: Array<{ name: string }> };
    expect(eco.currencies[0].name).toBe('Souls');
  });

  it('rpg_classic preset yields Gold and Gems', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'any', preset: 'rpg_classic' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    const eco = data.economy as { currencies: Array<{ name: string }> };
    const names = eco.currencies.map((c) => c.name);
    expect(names).toContain('Gold');
    expect(names).toContain('Gems');
  });
});

// ---------------------------------------------------------------------------
// design_economy — keyword-based auto-detection (no preset)
// ---------------------------------------------------------------------------

describe('design_economy — keyword auto-detection', () => {
  it('detects idle game from description', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'An idle clicker incremental game' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    const eco = data.economy as { currencies: Array<{ name: string }> };
    expect(eco.currencies.some((c) => c.name === 'Prestige Points')).toBe(true);
  });

  it('detects roguelike from description', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'A roguelike dungeon with permadeath' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    const eco = data.economy as { currencies: Array<{ name: string }> };
    expect(eco.currencies[0].name).toBe('Souls');
  });

  it('detects pvp from description', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'A competitive PVP ranked arena shooter' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    const eco = data.economy as { currencies: Array<{ name: string }> };
    expect(eco.currencies.some((c) => c.name === 'Ranking Points')).toBe(true);
  });

  it('defaults to casual_mobile for generic descriptions', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'A fun game' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    const eco = data.economy as { currencies: Array<{ name: string }> };
    expect(eco.currencies[0].name).toBe('Coins');
  });
});

// ---------------------------------------------------------------------------
// design_economy — balance validation
// ---------------------------------------------------------------------------

describe('design_economy — balance validation', () => {
  it('all presets pass balance validation (score > 0, passed)', async () => {
    const presets = ['casual_mobile', 'rpg_classic', 'roguelike', 'idle_incremental', 'competitive_pvp'] as const;
    for (const preset of presets) {
      const result = await economyHandlers.design_economy(
        { gameDescription: 'any', preset },
        makeCtx(),
      );
      expect(result.success).toBe(true);
      const data = result.result as Record<string, unknown>;
      const report = data.balanceReport as { score: number; passed: boolean };
      expect(report.passed).toBe(true);
      expect(report.score).toBeGreaterThan(0);
    }
  });

  it('summary mentions PASSED when balance passes', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'any', preset: 'casual_mobile' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(data.summary as string).toContain('PASSED');
  });
});

// ---------------------------------------------------------------------------
// design_economy — autoInjectScript
// ---------------------------------------------------------------------------

describe('design_economy — autoInjectScript', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not include injectedScriptId when autoInjectScript is false', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'A casual game', autoInjectScript: false },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(data.injectedScriptId).toBeUndefined();
  });

  it('does not include injectedScriptId when autoInjectScript is omitted', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'A casual game' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(data.injectedScriptId).toBeUndefined();
  });

  it('includes tip about autoInjectScript when not set', async () => {
    const result = await economyHandlers.design_economy(
      { gameDescription: 'A casual game' },
      makeCtx(),
    );
    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(data.summary as string).toContain('autoInjectScript');
  });

  it('injects script into library when autoInjectScript is true', async () => {
    const mockSaveScript = vi.fn().mockReturnValue({ id: 'script-abc-123', name: 'economy.js' });
    vi.doMock('@/stores/scriptLibraryStore', () => ({ saveScript: mockSaveScript }));

    // Dynamic import after mock so the handler picks up the mock
    const { economyHandlers: freshHandlers } = await import('../economyHandlers');
    const result = await freshHandlers.design_economy(
      { gameDescription: 'A casual game', autoInjectScript: true },
      makeCtx(),
    );

    expect(result.success).toBe(true);
    const data = result.result as Record<string, unknown>;
    expect(data.injectedScriptId).toBe('script-abc-123');
    expect(mockSaveScript).toHaveBeenCalledWith(
      'economy.js',
      expect.stringContaining('function buyItem'),
      expect.stringContaining('A casual game'),
      ['economy', 'generated'],
    );
  });
});
