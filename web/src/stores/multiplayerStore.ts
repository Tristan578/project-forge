/**
 * Zustand store for multiplayer networking configuration.
 * Manages network settings, spawn points, and synced properties for exported games.
 */

import { create } from 'zustand';

export interface NetworkConfig {
  enabled: boolean;
  serverUrl: string;
  maxPlayers: number;
  tickRate: number; // Hz (default 20)
  syncMode: 'authoritative' | 'relay';
  roomType: string; // 'platformer', 'arena', 'lobby', 'custom'
}

export interface SpawnPoint {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  team?: string;
}

export interface SyncedProperty {
  entityId: string;
  property: string; // 'transform', 'health', 'score', 'animation'
  syncRate: 'every-tick' | 'on-change' | 'manual';
  ownerOnly: boolean;
}

export interface PlayerInfo {
  name: string;
  team?: string;
  ping: number;
}

export type RoomState = 'disconnected' | 'connecting' | 'in-lobby' | 'in-game';

export interface MultiplayerState {
  networkConfig: NetworkConfig;
  spawnPoints: SpawnPoint[];
  syncedProperties: SyncedProperty[];
  localPlayerId: string | null;
  connectedPlayers: Record<string, PlayerInfo>;
  roomState: RoomState;

  // Actions
  setNetworkConfig: (config: Partial<NetworkConfig>) => void;
  addSpawnPoint: (point: SpawnPoint) => void;
  removeSpawnPoint: (id: string) => void;
  updateSpawnPoint: (id: string, updates: Partial<SpawnPoint>) => void;
  addSyncedProperty: (prop: SyncedProperty) => void;
  removeSyncedProperty: (entityId: string, property: string) => void;
  setRoomState: (state: RoomState) => void;
  setLocalPlayerId: (id: string | null) => void;
  updatePlayer: (id: string, info: PlayerInfo) => void;
  removePlayer: (id: string) => void;
  reset: () => void;
}

const defaultNetworkConfig: NetworkConfig = {
  enabled: false,
  serverUrl: 'ws://localhost:2567',
  maxPlayers: 4,
  tickRate: 20,
  syncMode: 'relay',
  roomType: 'custom',
};

export const useMultiplayerStore = create<MultiplayerState>((set) => ({
  networkConfig: defaultNetworkConfig,
  spawnPoints: [],
  syncedProperties: [],
  localPlayerId: null,
  connectedPlayers: {},
  roomState: 'disconnected',

  setNetworkConfig: (config) =>
    set((state) => ({
      networkConfig: { ...state.networkConfig, ...config },
    })),

  addSpawnPoint: (point) =>
    set((state) => ({
      spawnPoints: [...state.spawnPoints, point],
    })),

  removeSpawnPoint: (id) =>
    set((state) => ({
      spawnPoints: state.spawnPoints.filter((sp) => sp.id !== id),
    })),

  updateSpawnPoint: (id, updates) =>
    set((state) => ({
      spawnPoints: state.spawnPoints.map((sp) =>
        sp.id === id ? { ...sp, ...updates } : sp
      ),
    })),

  addSyncedProperty: (prop) =>
    set((state) => ({
      syncedProperties: [...state.syncedProperties, prop],
    })),

  removeSyncedProperty: (entityId, property) =>
    set((state) => ({
      syncedProperties: state.syncedProperties.filter(
        (sp) => !(sp.entityId === entityId && sp.property === property)
      ),
    })),

  setRoomState: (roomState) => set({ roomState }),

  setLocalPlayerId: (localPlayerId) => set({ localPlayerId }),

  updatePlayer: (id, info) =>
    set((state) => ({
      connectedPlayers: { ...state.connectedPlayers, [id]: info },
    })),

  removePlayer: (id) =>
    set((state) => {
      const { [id]: _removed, ...rest } = state.connectedPlayers;
      return { connectedPlayers: rest };
    }),

  reset: () =>
    set({
      networkConfig: defaultNetworkConfig,
      spawnPoints: [],
      syncedProperties: [],
      localPlayerId: null,
      connectedPlayers: {},
      roomState: 'disconnected',
    }),
}));
