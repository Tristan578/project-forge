/**
 * Economy designer handler for the `design_economy` MCP command.
 *
 * Generates a complete, balanced in-game economy from a natural language
 * game description. Runs balance validation and, when `autoInjectScript`
 * is set, saves the generated runtime to the project script library.
 */

import { z } from 'zod';
import type { ToolHandler, ExecutionResult } from './types';
import { parseArgs } from './types';
import {
  generateEconomy,
  validateBalance,
  economyToScript,
  ECONOMY_PRESETS,
} from '@/lib/ai/economyDesigner';

const VALID_PRESETS = Object.keys(ECONOMY_PRESETS) as Array<keyof typeof ECONOMY_PRESETS>;

export const economyHandlers: Record<string, ToolHandler> = {
  design_economy: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(
      z.object({
        gameDescription: z.string().min(1),
        preset: z.enum(['casual_mobile', 'rpg_classic', 'roguelike', 'idle_incremental', 'competitive_pvp']).optional(),
        autoInjectScript: z.boolean().optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const { gameDescription, preset, autoInjectScript } = p.data;

    // Validate the preset if provided
    if (preset && !VALID_PRESETS.includes(preset)) {
      return {
        success: false,
        error: `Unknown preset "${preset}". Valid presets: ${VALID_PRESETS.join(', ')}.`,
      };
    }

    // Generate the economy (keyword matching or preset clone)
    const economy = await generateEconomy(gameDescription, preset);

    // Run balance validation
    const report = validateBalance(economy);

    // Generate the script source
    const scriptSource = economyToScript(economy);

    // Optionally inject into the script library
    let injectedScriptId: string | undefined;
    if (autoInjectScript) {
      const { saveScript } = await import('@/stores/scriptLibraryStore');
      const saved = saveScript(
        'economy.js',
        scriptSource,
        `Auto-generated economy for: ${gameDescription}`,
        ['economy', 'generated'],
      );
      injectedScriptId = saved.id;
    }

    const issuesSummary = report.issues.length === 0
      ? 'No balance issues found.'
      : report.issues
          .map((i) => `[${i.severity.toUpperCase()}] ${i.message}`)
          .join('\n');

    return {
      success: true,
      result: {
        economy,
        balanceReport: report,
        script: scriptSource,
        ...(injectedScriptId ? { injectedScriptId } : {}),
        summary: [
          `Economy generated for: "${gameDescription}"`,
          `Preset used: ${preset ?? 'auto-detected'}`,
          `Balance score: ${report.score}/100 (${report.passed ? 'PASSED' : 'FAILED'})`,
          `Currencies: ${economy.currencies.map((c) => c.name).join(', ')}`,
          `Shop items: ${economy.shop.length}`,
          `Loot tables: ${economy.lootTables.length}`,
          `Progression: ${economy.progression.levels} levels`,
          '',
          'Balance issues:',
          issuesSummary,
          ...(injectedScriptId
            ? [`\nEconomy script saved to library as "economy.js" (id: ${injectedScriptId})`]
            : ['\nTip: pass autoInjectScript: true to save the economy runtime to your script library.']),
        ].join('\n'),
      },
    };
  },
};
