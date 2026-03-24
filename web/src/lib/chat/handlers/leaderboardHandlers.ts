/**
 * Leaderboard MCP command handlers.
 *
 * These commands manage leaderboards for published games. They delegate to the
 * server-side leaderboard management API, which requires `project:manage` scope.
 *
 * Provides 4 commands:
 *   create_leaderboard     — define a leaderboard for a published game
 *   list_leaderboards      — list all leaderboards for a published game
 *   configure_leaderboard  — update an existing leaderboard's configuration
 *   delete_leaderboard     — permanently delete a leaderboard and all its entries
 */

import { z } from 'zod';
import type { ToolHandler, ExecutionResult } from './types';
import { parseArgs } from './types';

export const leaderboardHandlers: Record<string, ToolHandler> = {
  create_leaderboard: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(
      z.object({
        gameId: z.string().min(1),
        name: z.string().min(1),
        sortOrder: z.enum(['desc', 'asc']).optional(),
        maxEntries: z.number().int().min(1).max(1000).optional(),
        minScore: z.number().optional(),
        maxScore: z.number().optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const res = await fetch(`/api/publish/${encodeURIComponent(p.data.gameId)}/leaderboards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: p.data.name,
        sortOrder: p.data.sortOrder ?? 'desc',
        maxEntries: p.data.maxEntries,
        minScore: p.data.minScore,
        maxScore: p.data.maxScore,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const msg = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
      return { success: false, error: `Failed to create leaderboard: ${msg}` };
    }

    return {
      success: true,
      message: `Leaderboard "${p.data.name}" created for game ${p.data.gameId} (sort: ${p.data.sortOrder ?? 'desc'}).`,
    };
  },

  list_leaderboards: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ gameId: z.string().min(1) }), args);
    if (p.error) return p.error;

    const res = await fetch(`/api/publish/${encodeURIComponent(p.data.gameId)}/leaderboards`);

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const msg = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
      return { success: false, error: `Failed to list leaderboards: ${msg}` };
    }

    const data = await res.json() as { leaderboards: unknown[] };
    return {
      success: true,
      message: `Found ${data.leaderboards.length} leaderboard(s) for game ${p.data.gameId}.`,
      result: data,
    };
  },

  configure_leaderboard: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(
      z.object({
        gameId: z.string().min(1),
        name: z.string().min(1),
        sortOrder: z.enum(['desc', 'asc']).optional(),
        maxEntries: z.number().int().min(1).max(1000).optional(),
        minScore: z.number().nullable().optional(),
        maxScore: z.number().nullable().optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const res = await fetch(
      `/api/publish/${encodeURIComponent(p.data.gameId)}/leaderboards/${encodeURIComponent(p.data.name)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sortOrder: p.data.sortOrder,
          maxEntries: p.data.maxEntries,
          minScore: p.data.minScore,
          maxScore: p.data.maxScore,
        }),
      },
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const msg = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
      return { success: false, error: `Failed to configure leaderboard: ${msg}` };
    }

    return {
      success: true,
      message: `Leaderboard "${p.data.name}" updated for game ${p.data.gameId}.`,
    };
  },

  delete_leaderboard: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(
      z.object({ gameId: z.string().min(1), name: z.string().min(1) }),
      args,
    );
    if (p.error) return p.error;

    const res = await fetch(
      `/api/publish/${encodeURIComponent(p.data.gameId)}/leaderboards/${encodeURIComponent(p.data.name)}`,
      { method: 'DELETE' },
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const msg = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
      return { success: false, error: `Failed to delete leaderboard: ${msg}` };
    }

    return {
      success: true,
      message: `Leaderboard "${p.data.name}" and all its entries deleted from game ${p.data.gameId}.`,
    };
  },
};
