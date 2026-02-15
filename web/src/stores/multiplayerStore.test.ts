import { describe, it, expect, beforeEach } from 'vitest';
import { useMultiplayerStore } from './multiplayerStore';
import type { SpawnPoint, SyncedProperty } from './multiplayerStore';

describe('multiplayerStore', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset();
  });

  it('starts with default config', () => {
    const { networkConfig } = useMultiplayerStore.getState();
    expect(networkConfig.enabled).toBe(false);
    expect(networkConfig.serverUrl).toBe('ws://localhost:2567');
    expect(networkConfig.maxPlayers).toBe(4);
    expect(networkConfig.tickRate).toBe(20);
    expect(networkConfig.syncMode).toBe('relay');
    expect(networkConfig.roomType).toBe('custom');
  });

  it('updates network config', () => {
    const store = useMultiplayerStore.getState();
    store.setNetworkConfig({ enabled: true, maxPlayers: 8 });

    const { networkConfig } = useMultiplayerStore.getState();
    expect(networkConfig.enabled).toBe(true);
    expect(networkConfig.maxPlayers).toBe(8);
    expect(networkConfig.serverUrl).toBe('ws://localhost:2567'); // unchanged
  });

  it('adds spawn points', () => {
    const store = useMultiplayerStore.getState();
    const point: SpawnPoint = {
      id: 'spawn-1',
      position: [0, 1, 0],
      rotation: [0, 0, 0],
      team: 'red',
    };

    store.addSpawnPoint(point);

    const { spawnPoints } = useMultiplayerStore.getState();
    expect(spawnPoints).toHaveLength(1);
    expect(spawnPoints[0]).toEqual(point);
  });

  it('removes spawn points', () => {
    const store = useMultiplayerStore.getState();
    store.addSpawnPoint({ id: 'sp1', position: [0, 0, 0], rotation: [0, 0, 0] });
    store.addSpawnPoint({ id: 'sp2', position: [1, 1, 1], rotation: [0, 0, 0] });

    store.removeSpawnPoint('sp1');

    const { spawnPoints } = useMultiplayerStore.getState();
    expect(spawnPoints).toHaveLength(1);
    expect(spawnPoints[0].id).toBe('sp2');
  });

  it('updates spawn points', () => {
    const store = useMultiplayerStore.getState();
    store.addSpawnPoint({ id: 'sp1', position: [0, 0, 0], rotation: [0, 0, 0] });

    store.updateSpawnPoint('sp1', { position: [5, 5, 5], team: 'blue' });

    const { spawnPoints } = useMultiplayerStore.getState();
    expect(spawnPoints[0].position).toEqual([5, 5, 5]);
    expect(spawnPoints[0].team).toBe('blue');
  });

  it('adds synced properties', () => {
    const store = useMultiplayerStore.getState();
    const prop: SyncedProperty = {
      entityId: 'player-1',
      property: 'transform',
      syncRate: 'every-tick',
      ownerOnly: false,
    };

    store.addSyncedProperty(prop);

    const { syncedProperties } = useMultiplayerStore.getState();
    expect(syncedProperties).toHaveLength(1);
    expect(syncedProperties[0]).toEqual(prop);
  });

  it('removes synced properties', () => {
    const store = useMultiplayerStore.getState();
    store.addSyncedProperty({ entityId: 'e1', property: 'health', syncRate: 'on-change', ownerOnly: false });
    store.addSyncedProperty({ entityId: 'e1', property: 'score', syncRate: 'on-change', ownerOnly: false });

    store.removeSyncedProperty('e1', 'health');

    const { syncedProperties } = useMultiplayerStore.getState();
    expect(syncedProperties).toHaveLength(1);
    expect(syncedProperties[0].property).toBe('score');
  });

  it('manages room state', () => {
    const store = useMultiplayerStore.getState();
    store.setRoomState('connecting');
    expect(useMultiplayerStore.getState().roomState).toBe('connecting');

    store.setRoomState('in-game');
    expect(useMultiplayerStore.getState().roomState).toBe('in-game');
  });

  it('manages player info', () => {
    const store = useMultiplayerStore.getState();
    store.updatePlayer('p1', { name: 'Alice', ping: 50 });
    store.updatePlayer('p2', { name: 'Bob', team: 'red', ping: 75 });

    const { connectedPlayers } = useMultiplayerStore.getState();
    expect(Object.keys(connectedPlayers)).toHaveLength(2);
    expect(connectedPlayers['p1'].name).toBe('Alice');
    expect(connectedPlayers['p2'].team).toBe('red');

    store.removePlayer('p1');
    expect(Object.keys(useMultiplayerStore.getState().connectedPlayers)).toHaveLength(1);
  });

  it('resets to default state', () => {
    const store = useMultiplayerStore.getState();
    store.setNetworkConfig({ enabled: true, maxPlayers: 16 });
    store.addSpawnPoint({ id: 'sp1', position: [0, 0, 0], rotation: [0, 0, 0] });
    store.setRoomState('in-game');

    store.reset();

    const state = useMultiplayerStore.getState();
    expect(state.networkConfig.enabled).toBe(false);
    expect(state.spawnPoints).toHaveLength(0);
    expect(state.roomState).toBe('disconnected');
  });
});
