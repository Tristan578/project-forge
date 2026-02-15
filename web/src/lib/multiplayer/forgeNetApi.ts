/**
 * forge.net script API — exposed to game scripts for multiplayer functionality.
 */

import { getNetworkClient, initNetworkClient, destroyNetworkClient } from './networkClient';

export interface ForgeNetApi {
  connect: (serverUrl: string, roomName: string, options?: Record<string, unknown>) => Promise<boolean>;
  disconnect: () => void;
  send: (type: string, data: unknown) => void;
  onMessage: (type: string, callback: (data: unknown) => void) => void;
  onPlayerJoin: (callback: (playerId: string) => void) => void;
  onPlayerLeave: (callback: (playerId: string) => void) => void;
  getPlayerId: () => string | null;
  getPlayerCount: () => number;
  isHost: () => boolean;
  setPlayerData: (key: string, value: unknown) => void;
  getPlayerData: (playerId: string, key: string) => unknown;
  syncEntity: (entityId: string, properties: string[]) => void;
}

// Player data storage (client-side only for stub implementation)
const playerData: Record<string, Record<string, unknown>> = {};

export const forgeNetApi: ForgeNetApi = {
  connect: async (serverUrl: string, roomName: string, options?: Record<string, unknown>) => {
    const config = {
      serverUrl,
      maxPlayers: 4, // Default, can be overridden via options
      tickRate: 20,
    };

    const client = initNetworkClient(config);
    const success = await client.joinRoom(roomName, options);

    if (success) {
      console.info(`[forge.net] Connected to room "${roomName}"`);
    } else {
      console.warn('[forge.net] Failed to connect. Is the server running?');
    }

    return success;
  },

  disconnect: () => {
    const client = getNetworkClient();
    if (client) {
      client.leaveRoom();
      destroyNetworkClient();
      console.info('[forge.net] Disconnected from room');
    }
  },

  send: (type: string, data: unknown) => {
    const client = getNetworkClient();
    if (client) {
      client.send(type, data);
    } else {
      console.warn('[forge.net] Cannot send message: not connected');
    }
  },

  onMessage: (type: string, callback: (data: unknown) => void) => {
    const client = getNetworkClient();
    if (client) {
      client.onMessage(type, callback);
    } else {
      console.warn('[forge.net] Cannot register message handler: not connected');
    }
  },

  onPlayerJoin: (callback: (playerId: string) => void) => {
    const client = getNetworkClient();
    if (client) {
      client.onPlayerJoin(callback);
    } else {
      console.warn('[forge.net] Cannot register join handler: not connected');
    }
  },

  onPlayerLeave: (callback: (playerId: string) => void) => {
    const client = getNetworkClient();
    if (client) {
      client.onPlayerLeave(callback);
    } else {
      console.warn('[forge.net] Cannot register leave handler: not connected');
    }
  },

  getPlayerId: () => {
    const client = getNetworkClient();
    return client ? client.getPlayerId() : null;
  },

  getPlayerCount: () => {
    const client = getNetworkClient();
    return client ? client.getPlayerCount() : 0;
  },

  isHost: () => {
    const client = getNetworkClient();
    if (!client) return false;
    // In Colyseus, first player is usually the host
    // For now, return false since we're stubbed
    return false;
  },

  setPlayerData: (key: string, value: unknown) => {
    const client = getNetworkClient();
    const playerId = client?.getPlayerId();
    if (!playerId) {
      console.warn('[forge.net] Cannot set player data: not connected');
      return;
    }

    if (!playerData[playerId]) {
      playerData[playerId] = {};
    }
    playerData[playerId][key] = value;

    // In a real implementation, this would sync to the server:
    // client.send('setPlayerData', { key, value });
  },

  getPlayerData: (playerId: string, key: string) => {
    return playerData[playerId]?.[key];
  },

  syncEntity: (entityId: string, properties: string[]) => {
    const client = getNetworkClient();
    if (!client) {
      console.warn('[forge.net] Cannot sync entity: not connected');
      return;
    }

    console.info(`[forge.net] Would sync entity ${entityId} properties:`, properties);
    // In a real implementation:
    // client.send('syncEntity', { entityId, properties });
  },
};
