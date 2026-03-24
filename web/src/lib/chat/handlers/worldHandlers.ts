/**
 * World-building assistant handlers for MCP commands.
 * Wires the build_world command to the AI world generation pipeline,
 * consistency validation, self-healing, and storage.
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { parseArgs } from './types';
import {
  generateWorld,
  validateWorldConsistency,
  healWorldConsistency,
  WORLD_PRESETS,
  type GameWorld,
  type ConsistencyReport,
} from '@/lib/ai/worldBuilder';

/** localStorage key for persisted world data per project. */
const WORLD_STORAGE_KEY = 'spawnforge_world_data';

/** Persist a generated world to localStorage for the world panel to consume. */
export function persistWorld(world: GameWorld): void {
  try {
    localStorage.setItem(WORLD_STORAGE_KEY, JSON.stringify(world));
  } catch {
    // localStorage may be unavailable in some environments
  }
}

/** Load a persisted world from localStorage (returns null if not found). */
export function loadPersistedWorld(): GameWorld | null {
  try {
    const raw = localStorage.getItem(WORLD_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as GameWorld;
  } catch {
    return null;
  }
}

/** Clear persisted world data. */
export function clearPersistedWorld(): void {
  try {
    localStorage.removeItem(WORLD_STORAGE_KEY);
  } catch {
    // no-op
  }
}

/**
 * Attempt to generate a consistent world, retrying with issue context up to maxRetries.
 * Falls back to closest genre preset if all retries fail.
 */
async function generateWithHealing(
  premise: string,
  genre: string | undefined,
  factionCount: number | undefined,
  regionCount: number | undefined,
  maxRetries = 2,
): Promise<{ world: GameWorld; report: ConsistencyReport; fallback: boolean }> {
  let lastWorld: GameWorld | null = null;
  let lastReport: ConsistencyReport | null = null;

  // Build the full premise with constraints
  const constraintNote = [
    factionCount != null ? `${factionCount} factions` : '',
    regionCount != null ? `${regionCount} regions` : '',
  ].filter(Boolean).join(', ');
  const fullPremise = constraintNote
    ? `${premise} [Constraints: ${constraintNote}]`
    : premise;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let attemptPremise = fullPremise;
    if (attempt > 0 && lastReport) {
      const errorMessages = lastReport.issues
        .filter((i) => i.severity === 'error')
        .map((i) => i.message)
        .slice(0, 5)
        .join('; ');
      attemptPremise = `${fullPremise}\n\nPrevious attempt had consistency errors — fix them:\n${errorMessages}`;
    }

    try {
      const raw = await generateWorld(attemptPremise, genre);
      const healed = healWorldConsistency(raw);
      const report = validateWorldConsistency(healed);
      lastWorld = healed;
      lastReport = report;

      if (report.valid) {
        return { world: healed, report, fallback: false };
      }
    } catch (err) {
      // Fail-fast on errors that retrying would amplify or that indicate
      // permanent failure. Only retry on parse/validation errors.
      const message = err instanceof Error ? err.message : String(err);
      const lower = message.toLowerCase();
      const isNonRetryable =
        lower.includes('credit') ||
        lower.includes('auth') ||
        lower.includes('401') ||
        lower.includes('403') ||
        lower.includes('402') ||
        lower.includes('429') ||
        lower.includes('rate limit') ||
        lower.includes('too many') ||
        lower.includes('backpressure') ||
        lower.includes('queue') ||
        lower.includes('abort') ||
        lower.includes('timeout');
      if (isNonRetryable) throw err;
    }
  }

  // All retries exhausted — if the last world exists but failed validation,
  // return it with fallback: true so callers know it may be inconsistent.
  if (lastWorld) {
    return { world: lastWorld, report: lastReport!, fallback: true };
  }

  const presetKey = genre && WORLD_PRESETS[genre] ? genre : 'medieval_fantasy';
  const fallbackWorld = healWorldConsistency(structuredClone(WORLD_PRESETS[presetKey]));
  return {
    world: fallbackWorld,
    report: validateWorldConsistency(fallbackWorld),
    fallback: true,
  };
}

/** Produce a human-readable summary of a GameWorld for the AI to return. */
function worldSummary(world: GameWorld, report: ConsistencyReport, fallback: boolean): string {
  const factionList = world.factions.map((f) => `${f.name} (${f.alignment})`).join(', ');
  const regionList = world.regions.map((r) => r.name).join(', ');
  const issueCount = report.issues.filter((i) => i.severity === 'warning').length;

  const lines: string[] = [
    fallback
      ? `Generated world using preset fallback (genre: ${world.genre})`
      : `Generated world: **${world.name}**`,
    `Genre: ${world.genre} | Era: ${world.era}`,
    `${world.description}`,
    ``,
    `**Factions (${world.factions.length}):** ${factionList}`,
    `**Regions (${world.regions.length}):** ${regionList}`,
    `**Timeline events:** ${world.timeline.length}`,
    `**Lore entries:** ${world.lore.length}`,
  ];

  if (issueCount > 0) {
    lines.push(``, `*${issueCount} minor consistency warning(s) — world is still valid and playable.*`);
  }

  return lines.join('\n');
}

export const worldHandlers: Record<string, ToolHandler> = {
  build_world: async (args, _ctx) => {
    const p = parseArgs(
      z.object({
        premise: z.string().min(1, 'premise is required'),
        genre: z.string().optional(),
        factionCount: z.number().int().min(1).max(10).optional(),
        regionCount: z.number().int().min(1).max(20).optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const { premise, genre, factionCount, regionCount } = p.data;

    try {
      const { world, report, fallback } = await generateWithHealing(
        premise,
        genre,
        factionCount,
        regionCount,
      );

      persistWorld(world);

      const summary = worldSummary(world, report, fallback);

      return {
        success: true,
        message: summary,
        result: {
          world,
          consistencyReport: report,
          fallback,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'World generation failed';
      return { success: false, error: message };
    }
  },

  get_current_world: async (_args, _ctx) => {
    const world = loadPersistedWorld();
    if (!world) {
      return { success: false, error: 'No world data found. Use build_world to generate one.' };
    }
    const report = validateWorldConsistency(world);
    return {
      success: true,
      message: `Current world: ${world.name} (${world.factions.length} factions, ${world.regions.length} regions)`,
      result: { world, consistencyReport: report },
    };
  },

  clear_world: async (_args, _ctx) => {
    clearPersistedWorld();
    return { success: true, message: 'World data cleared.' };
  },
};
