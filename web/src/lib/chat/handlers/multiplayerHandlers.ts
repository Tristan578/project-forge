/**
 * Multiplayer networking handlers for MCP commands.
 */

import type { ToolHandler } from './types';
import { useMultiplayerStore } from '@/stores/multiplayerStore';
import type { NetworkConfig, SpawnPoint, SyncedProperty } from '@/stores/multiplayerStore';

export const multiplayerHandlers: Record<string, ToolHandler> = {
  configure_multiplayer: async (args, _ctx) => {
    const store = useMultiplayerStore.getState();

    const config: Partial<NetworkConfig> = {};
    if (args.enabled !== undefined) config.enabled = args.enabled as boolean;
    if (args.serverUrl !== undefined) config.serverUrl = args.serverUrl as string;
    if (args.maxPlayers !== undefined) config.maxPlayers = args.maxPlayers as number;
    if (args.tickRate !== undefined) config.tickRate = args.tickRate as number;
    if (args.syncMode !== undefined) config.syncMode = args.syncMode as 'authoritative' | 'relay';
    if (args.roomType !== undefined) config.roomType = args.roomType as string;

    store.setNetworkConfig(config);

    return {
      success: true,
      result: `Multiplayer configured: ${JSON.stringify(config)}`,
    };
  },

  add_spawn_point: async (args, _ctx) => {
    const store = useMultiplayerStore.getState();

    const spawnPoint: SpawnPoint = {
      id: args.id as string || `spawn-${Date.now()}`,
      position: args.position as [number, number, number] || [0, 0, 0],
      rotation: args.rotation as [number, number, number] || [0, 0, 0],
      team: args.team as string | undefined,
    };

    store.addSpawnPoint(spawnPoint);

    return {
      success: true,
      result: `Added spawn point: ${spawnPoint.id}`,
    };
  },

  remove_spawn_point: async (args, _ctx) => {
    const store = useMultiplayerStore.getState();
    const id = args.id as string;

    store.removeSpawnPoint(id);

    return {
      success: true,
      result: `Removed spawn point: ${id}`,
    };
  },

  add_synced_property: async (args, _ctx) => {
    const store = useMultiplayerStore.getState();

    const prop: SyncedProperty = {
      entityId: args.entityId as string,
      property: args.property as string,
      syncRate: (args.syncRate as 'every-tick' | 'on-change' | 'manual') || 'on-change',
      ownerOnly: (args.ownerOnly as boolean) || false,
    };

    store.addSyncedProperty(prop);

    return {
      success: true,
      result: `Added synced property: ${prop.entityId}.${prop.property}`,
    };
  },

  set_room_type: async (args, _ctx) => {
    const store = useMultiplayerStore.getState();
    const roomType = args.roomType as string;

    store.setNetworkConfig({ roomType });

    return {
      success: true,
      result: `Room type set to: ${roomType}`,
    };
  },

  list_network_config: async (_args, _ctx) => {
    const store = useMultiplayerStore.getState();
    const { networkConfig, spawnPoints, syncedProperties } = store;

    return {
      success: true,
      result: {
        config: networkConfig,
        spawnPoints: spawnPoints.length,
        syncedProperties: syncedProperties.length,
      },
    };
  },
};
