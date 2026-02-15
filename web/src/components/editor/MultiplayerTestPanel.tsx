/**
 * Multiplayer test panel — shows connection status and testing tools.
 */

import React from 'react';
import { useMultiplayerStore } from '@/stores/multiplayerStore';
import { Wifi, WifiOff, Users, Activity, ExternalLink, Server } from 'lucide-react';

export const MultiplayerTestPanel: React.FC = () => {
  const { networkConfig, connectedPlayers, roomState, localPlayerId } = useMultiplayerStore();

  const playerCount = Object.keys(connectedPlayers).length;
  const isConnected = roomState !== 'disconnected';

  const handleOpenTestWindow = React.useCallback(() => {
    const currentUrl = window.location.href;
    window.open(currentUrl, '_blank', 'width=800,height=600');
  }, []);

  const handleShowInstructions = React.useCallback(() => {
    const instructions = `
To test multiplayer locally:

1. Install Colyseus server:
   npm install -g @colyseus/cli

2. Create a new server project:
   colyseus init my-server
   cd my-server

3. Start the server:
   npm start

4. Update your game's server URL to:
   ws://localhost:2567

5. Open multiple browser windows to test.

For production, deploy your Colyseus server to:
- Heroku, Railway, or Vercel
- AWS/GCP/Azure with WebSocket support
- Colyseus Cloud (managed hosting)

See: https://docs.colyseus.io/
    `.trim();

    alert(instructions);
  }, []);

  return (
    <div className="h-full bg-zinc-900 border-l border-zinc-800 flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wifi className="w-4 h-4 text-blue-400" />
          <h2 className="font-medium text-white">Multiplayer Test</h2>
        </div>
        <div className={`px-2 py-1 rounded text-xs ${
          isConnected ? 'bg-green-900 text-green-300' : 'bg-zinc-800 text-zinc-400'
        }`}>
          {roomState}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Server Info */}
        <div className="bg-zinc-800 rounded p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <Server className="w-4 h-4" />
            <span>Server Configuration</span>
          </div>
          <div className="text-xs space-y-1">
            <div className="text-zinc-400">
              URL: <span className="text-white">{networkConfig.serverUrl}</span>
            </div>
            <div className="text-zinc-400">
              Max Players: <span className="text-white">{networkConfig.maxPlayers}</span>
            </div>
            <div className="text-zinc-400">
              Room Type: <span className="text-white">{networkConfig.roomType}</span>
            </div>
          </div>
        </div>

        {/* Setup Instructions */}
        <div className="space-y-2">
          <button
            onClick={handleShowInstructions}
            className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm font-medium transition-colors"
          >
            Setup Local Server
          </button>
          <button
            onClick={handleOpenTestWindow}
            className="w-full px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-white rounded text-sm font-medium transition-colors flex items-center justify-center gap-2"
          >
            <ExternalLink className="w-4 h-4" />
            Open Test Window
          </button>
        </div>

        {/* Connection Status */}
        <div className="bg-zinc-800 rounded p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            {isConnected ? (
              <Wifi className="w-4 h-4 text-green-400" />
            ) : (
              <WifiOff className="w-4 h-4 text-zinc-500" />
            )}
            <span>Connection Status</span>
          </div>
          <div className="text-xs space-y-1">
            <div className="text-zinc-400">
              Player ID: <span className="text-white">{localPlayerId || 'Not connected'}</span>
            </div>
            <div className="text-zinc-400">
              State: <span className="text-white">{roomState}</span>
            </div>
          </div>
        </div>

        {/* Connected Players */}
        <div className="bg-zinc-800 rounded p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-zinc-300">
              <Users className="w-4 h-4" />
              <span>Connected Players</span>
            </div>
            <span className="text-xs text-zinc-500">{playerCount}/{networkConfig.maxPlayers}</span>
          </div>

          {playerCount === 0 ? (
            <p className="text-xs text-zinc-500 italic">No players connected</p>
          ) : (
            <div className="space-y-1">
              {Object.entries(connectedPlayers).map(([id, info]) => (
                <div key={id} className="flex items-center justify-between text-xs">
                  <span className="text-white">{info.name}</span>
                  <div className="flex items-center gap-2 text-zinc-400">
                    {info.team && <span className="text-xs">({info.team})</span>}
                    <span>{info.ping}ms</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Network Stats */}
        <div className="bg-zinc-800 rounded p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <Activity className="w-4 h-4" />
            <span>Network Stats</span>
          </div>
          <div className="text-xs space-y-1 text-zinc-400">
            <div>Messages/sec: <span className="text-white">0</span></div>
            <div>Bandwidth: <span className="text-white">0 KB/s</span></div>
            <div>Tick Rate: <span className="text-white">{networkConfig.tickRate} Hz</span></div>
          </div>
        </div>

        {/* Info Notice */}
        <div className="bg-yellow-900/20 border border-yellow-700/30 rounded p-3 text-xs text-yellow-300">
          <p className="font-medium mb-1">Note:</p>
          <p>
            Multiplayer requires a Colyseus server running. Click &quot;Setup Local Server&quot; for instructions.
            The test window allows you to open multiple instances to simulate multiplayer gameplay.
          </p>
        </div>
      </div>
    </div>
  );
};
