/** Read-only operations that do not belong to a domain registry. */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { zEntityId, parseArgs } from './types';

export const queryHandlers: Record<string, ToolHandler> = {
  get_audio: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    if (!Object.hasOwn(store.entityAudio, p.data.entityId)) {
      return { success: true, result: { hasAudio: false } };
    }
    return { success: true, result: { hasAudio: true, ...store.entityAudio[p.data.entityId] } };
  },

  query_play_state: async (_args, { store }) => {
    if (store.engineMode !== 'play' && store.engineMode !== 'paused') {
      return {
        success: false,
        error: `query_play_state is only available in Play or Paused mode. Current mode: ${store.engineMode}`,
      };
    }
    const entities = Object.values(store.sceneGraph.nodes).map((node) => ({
      id: node.entityId,
      name: node.name,
      visible: node.visible,
    }));
    return {
      success: true,
      result: {
        entities,
        entityCount: entities.length,
        engineMode: store.engineMode,
        // Transforms reflect the last engine-to-store sync tick, not real-time ECS values.
        dataSource: 'store_last_sync' as const,
        syncTimestamp: Date.now(),
      },
    };
  },
};
