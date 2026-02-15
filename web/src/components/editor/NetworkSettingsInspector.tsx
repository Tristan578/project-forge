/**
 * Network settings inspector for multiplayer configuration.
 */

import React from 'react';
import { useMultiplayerStore } from '@/stores/multiplayerStore';
import type { SpawnPoint, SyncedProperty } from '@/stores/multiplayerStore';
import { Wifi, Users, Settings, MapPin, Trash2, Plus } from 'lucide-react';

export const NetworkSettingsInspector: React.FC = () => {
  const {
    networkConfig,
    spawnPoints,
    syncedProperties,
    setNetworkConfig,
    addSpawnPoint,
    removeSpawnPoint,
    updateSpawnPoint,
    addSyncedProperty,
    removeSyncedProperty,
  } = useMultiplayerStore();

  const handleAddSpawnPoint = React.useCallback(() => {
    const newPoint: SpawnPoint = {
      id: `spawn-${Date.now()}`,
      position: [0, 1, 0],
      rotation: [0, 0, 0],
    };
    addSpawnPoint(newPoint);
  }, [addSpawnPoint]);

  const handleAddSyncedProperty = React.useCallback(() => {
    const newProp: SyncedProperty = {
      entityId: '',
      property: 'transform',
      syncRate: 'on-change',
      ownerOnly: false,
    };
    addSyncedProperty(newProp);
  }, [addSyncedProperty]);

  return (
    <div className="space-y-4 text-sm">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-zinc-700">
        <Wifi className="w-4 h-4 text-blue-400" />
        <h3 className="font-medium">Multiplayer Settings</h3>
      </div>

      {/* Enable Toggle */}
      <div className="flex items-center justify-between">
        <label className="text-zinc-300">Enable Multiplayer</label>
        <input
          type="checkbox"
          checked={networkConfig.enabled}
          onChange={(e) => setNetworkConfig({ enabled: e.target.checked })}
          className="w-4 h-4"
        />
      </div>

      {networkConfig.enabled && (
        <>
          {/* Server URL */}
          <div className="space-y-1">
            <label className="text-zinc-400 text-xs">Server URL</label>
            <input
              type="text"
              value={networkConfig.serverUrl}
              onChange={(e) => setNetworkConfig({ serverUrl: e.target.value })}
              placeholder="ws://localhost:2567"
              className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-white text-xs"
            />
          </div>

          {/* Max Players */}
          <div className="space-y-1">
            <label className="text-zinc-400 text-xs flex items-center gap-2">
              <Users className="w-3 h-3" />
              Max Players: {networkConfig.maxPlayers}
            </label>
            <input
              type="range"
              min="2"
              max="16"
              value={networkConfig.maxPlayers}
              onChange={(e) => setNetworkConfig({ maxPlayers: parseInt(e.target.value) })}
              className="w-full"
            />
          </div>

          {/* Tick Rate */}
          <div className="space-y-1">
            <label className="text-zinc-400 text-xs">Tick Rate: {networkConfig.tickRate} Hz</label>
            <input
              type="range"
              min="10"
              max="60"
              step="5"
              value={networkConfig.tickRate}
              onChange={(e) => setNetworkConfig({ tickRate: parseInt(e.target.value) })}
              className="w-full"
            />
          </div>

          {/* Sync Mode */}
          <div className="space-y-1">
            <label className="text-zinc-400 text-xs">Sync Mode</label>
            <select
              value={networkConfig.syncMode}
              onChange={(e) => setNetworkConfig({ syncMode: e.target.value as 'authoritative' | 'relay' })}
              className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-white text-xs"
            >
              <option value="relay">Relay</option>
              <option value="authoritative">Authoritative</option>
            </select>
          </div>

          {/* Room Type */}
          <div className="space-y-1">
            <label className="text-zinc-400 text-xs">Room Type</label>
            <select
              value={networkConfig.roomType}
              onChange={(e) => setNetworkConfig({ roomType: e.target.value })}
              className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-white text-xs"
            >
              <option value="custom">Custom</option>
              <option value="platformer">Platformer</option>
              <option value="arena">Arena</option>
              <option value="lobby">Lobby</option>
            </select>
          </div>

          {/* Spawn Points */}
          <div className="space-y-2 pt-2 border-t border-zinc-700">
            <div className="flex items-center justify-between">
              <label className="text-zinc-300 flex items-center gap-2">
                <MapPin className="w-3 h-3" />
                Spawn Points ({spawnPoints.length})
              </label>
              <button
                onClick={handleAddSpawnPoint}
                className="p-1 hover:bg-zinc-700 rounded"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>

            {spawnPoints.length === 0 && (
              <p className="text-zinc-500 text-xs italic">No spawn points defined</p>
            )}

            {spawnPoints.map((sp) => (
              <div key={sp.id} className="p-2 bg-zinc-800 rounded space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">{sp.id}</span>
                  <button
                    onClick={() => removeSpawnPoint(sp.id)}
                    className="p-1 hover:bg-zinc-700 rounded"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1 text-xs">
                  <input
                    type="number"
                    value={sp.position[0]}
                    onChange={(e) =>
                      updateSpawnPoint(sp.id, {
                        position: [parseFloat(e.target.value), sp.position[1], sp.position[2]],
                      })
                    }
                    placeholder="X"
                    className="px-1 py-0.5 bg-zinc-700 border border-zinc-600 rounded text-white"
                  />
                  <input
                    type="number"
                    value={sp.position[1]}
                    onChange={(e) =>
                      updateSpawnPoint(sp.id, {
                        position: [sp.position[0], parseFloat(e.target.value), sp.position[2]],
                      })
                    }
                    placeholder="Y"
                    className="px-1 py-0.5 bg-zinc-700 border border-zinc-600 rounded text-white"
                  />
                  <input
                    type="number"
                    value={sp.position[2]}
                    onChange={(e) =>
                      updateSpawnPoint(sp.id, {
                        position: [sp.position[0], sp.position[1], parseFloat(e.target.value)],
                      })
                    }
                    placeholder="Z"
                    className="px-1 py-0.5 bg-zinc-700 border border-zinc-600 rounded text-white"
                  />
                </div>
                {sp.team && (
                  <div className="text-xs text-zinc-500">Team: {sp.team}</div>
                )}
              </div>
            ))}
          </div>

          {/* Synced Properties */}
          <div className="space-y-2 pt-2 border-t border-zinc-700">
            <div className="flex items-center justify-between">
              <label className="text-zinc-300 flex items-center gap-2">
                <Settings className="w-3 h-3" />
                Synced Properties ({syncedProperties.length})
              </label>
              <button
                onClick={handleAddSyncedProperty}
                className="p-1 hover:bg-zinc-700 rounded"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>

            {syncedProperties.length === 0 && (
              <p className="text-zinc-500 text-xs italic">No synced properties</p>
            )}

            {syncedProperties.map((prop, idx) => (
              <div key={`${prop.entityId}-${prop.property}-${idx}`} className="p-2 bg-zinc-800 rounded space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400">
                    {prop.entityId || '<entity>'}.{prop.property}
                  </span>
                  <button
                    onClick={() => removeSyncedProperty(prop.entityId, prop.property)}
                    className="p-1 hover:bg-zinc-700 rounded"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
                <div className="text-xs text-zinc-500">
                  {prop.syncRate} • {prop.ownerOnly ? 'Owner only' : 'All players'}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
