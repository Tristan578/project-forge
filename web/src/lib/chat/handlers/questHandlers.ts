/**
 * Quest/Mission generator MCP handlers.
 *
 * Wraps the procedural quest generator (`lib/ai/questGenerator`) in
 * standard ToolHandler signatures so the AI can generate, inspect, edit,
 * and delete quest chains through the MCP interface.
 *
 * Commands: generate_quest, list_quests, get_quest,
 *           update_quest_objective, delete_quest
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { parseArgs } from './types';

// ---------------------------------------------------------------------------
// Zod sub-schemas
// ---------------------------------------------------------------------------

const zChainTemplateId = z.enum([
  'hero_origin',
  'mystery_investigation',
  'faction_loyalty',
  'resource_expedition',
  'revenge_arc',
]);

const zObjectiveType = z.enum([
  'kill_count',
  'collect_items',
  'reach_location',
  'talk_to_npc',
  'survive_time',
  'protect_target',
  'solve_puzzle',
  'craft_item',
  'deliver_item',
  'explore_area',
]);

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const questHandlers: Record<string, ToolHandler> = {
  /**
   * AI-generate a quest chain from a text prompt.
   *
   * Uses the local procedural generator (deterministic, no AI API call) to
   * create a full quest chain seeded from the player description + template.
   * The generated chain is stored in questStore so subsequent commands can
   * reference it by chainId.
   */
  generate_quest: async (args, _ctx) => {
    const p = parseArgs(
      z.object({
        templateId: zChainTemplateId,
        playerDescription: z.string().min(1).max(200),
        difficulty: z.number().min(1).max(10),
        questCount: z.number().int().min(1).max(20).optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const { generateQuestChain, validateQuestChain } = await import(
      '@/lib/ai/questGenerator'
    );
    const { useQuestStore } = await import('@/stores/questStore');

    let chain;
    try {
      chain = generateQuestChain(p.data);
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Quest generation failed',
      };
    }

    const errors = validateQuestChain(chain);
    if (errors.length > 0) {
      return { success: false, error: `Generated quest failed validation: ${errors.join('; ')}` };
    }

    useQuestStore.getState().addChain(chain);

    return {
      success: true,
      result: {
        chainId: chain.id,
        name: chain.name,
        questCount: chain.quests.length,
        quests: chain.quests.map((q) => ({
          id: q.id,
          title: q.title,
          type: q.type,
          status: q.status,
          level: q.level,
        })),
        message: `Generated quest chain "${chain.name}" with ${chain.quests.length} quests`,
      },
    };
  },

  /**
   * List all quest chains currently stored in the project.
   */
  list_quests: async (_args, _ctx) => {
    const { useQuestStore } = await import('@/stores/questStore');
    const chains = useQuestStore.getState().listChains();

    return {
      success: true,
      result: {
        chains: chains.map((c) => ({
          chainId: c.id,
          name: c.name,
          templateId: c.templateId,
          questCount: c.quests.length,
          createdAt: c.createdAt,
        })),
        total: chains.length,
      },
    };
  },

  /**
   * Get full details of a quest chain, including all objectives and rewards.
   */
  get_quest: async (args, _ctx) => {
    const p = parseArgs(z.object({ chainId: z.string().min(1) }), args);
    if (p.error) return p.error;

    const { useQuestStore } = await import('@/stores/questStore');
    const chain = useQuestStore.getState().getChain(p.data.chainId);
    if (!chain) {
      return { success: false, error: `Quest chain "${p.data.chainId}" not found` };
    }

    return { success: true, result: chain };
  },

  /**
   * Modify a single objective within a quest.
   *
   * Only the provided fields are updated; unspecified fields are preserved.
   */
  update_quest_objective: async (args, _ctx) => {
    const p = parseArgs(
      z.object({
        chainId: z.string().min(1),
        questId: z.string().min(1),
        objectiveId: z.string().min(1),
        type: zObjectiveType.optional(),
        description: z.string().min(1).optional(),
        target: z.string().min(1).optional(),
        required: z.number().int().min(1).optional(),
        optional: z.boolean().optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const { useQuestStore } = await import('@/stores/questStore');
    const { chainId, questId, objectiveId, ...patch } = p.data;

    const chain = useQuestStore.getState().getChain(chainId);
    if (!chain) return { success: false, error: `Quest chain "${chainId}" not found` };

    const quest = useQuestStore.getState().getQuest(chainId, questId);
    if (!quest) return { success: false, error: `Quest "${questId}" not found in chain "${chainId}"` };

    const objective = quest.objectives.find((o) => o.id === objectiveId);
    if (!objective) {
      return { success: false, error: `Objective "${objectiveId}" not found in quest "${questId}"` };
    }

    // Build a clean patch — strip undefined entries so only provided fields update
    const cleanPatch = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ) as Partial<typeof objective>;

    useQuestStore.getState().updateObjective(chainId, questId, objectiveId, cleanPatch);

    return {
      success: true,
      result: {
        message: `Updated objective "${objectiveId}" in quest "${quest.title}"`,
      },
    };
  },

  /**
   * Delete a quest chain by id.
   */
  delete_quest: async (args, _ctx) => {
    const p = parseArgs(z.object({ chainId: z.string().min(1) }), args);
    if (p.error) return p.error;

    const { useQuestStore } = await import('@/stores/questStore');
    const chain = useQuestStore.getState().getChain(p.data.chainId);
    if (!chain) return { success: false, error: `Quest chain "${p.data.chainId}" not found` };

    useQuestStore.getState().removeChain(p.data.chainId);

    return {
      success: true,
      result: { message: `Deleted quest chain "${chain.name}"` },
    };
  },
};
