/**
 * Network client for multiplayer games.
 *
 * NOTE: This is infrastructure-ready code that stubs the Colyseus client.
 * To enable full multiplayer, install @colyseus/client and implement connection logic.
 */

export interface NetworkClientConfig {
  serverUrl: string;
  maxPlayers: number;
  tickRate: number;
}

export class NetworkClient {
  private serverUrl: string;
  private maxPlayers: number;
  private tickRate: number;
  private room: unknown = null; // Colyseus Room when available
  private playerId: string | null = null;
  private messageHandlers: Map<string, Set<(data: unknown) => void>> = new Map();
  private playerJoinHandlers: Set<(playerId: string) => void> = new Set();
  private playerLeaveHandlers: Set<(playerId: string) => void> = new Set();
  private stateChangeHandlers: Set<(state: unknown) => void> = new Set();

  constructor(config: NetworkClientConfig) {
    this.serverUrl = config.serverUrl;
    this.maxPlayers = config.maxPlayers;
    this.tickRate = config.tickRate;
  }

  async joinRoom(roomName: string, options?: Record<string, unknown>): Promise<boolean> {
    console.warn('[forge.net] Multiplayer requires Colyseus server. See docs for setup.');
    console.info(`[forge.net] Would join room "${roomName}" at ${this.serverUrl}`, options);

    // Stub: would connect to Colyseus server
    // Example implementation:
    // const client = new Client(this.serverUrl);
    // this.room = await client.joinOrCreate(roomName, options);
    // this.playerId = this.room.sessionId;
    // this._setupRoomHandlers();

    return false;
  }

  async createRoom(roomName: string, options?: Record<string, unknown>): Promise<boolean> {
    console.warn('[forge.net] Multiplayer requires Colyseus server. See docs for setup.');
    console.info(`[forge.net] Would create room "${roomName}" at ${this.serverUrl}`, options);
    return false;
  }

  leaveRoom(): void {
    if (this.room) {
      console.info('[forge.net] Leaving room');
      // this.room.leave();
      this.room = null;
      this.playerId = null;
    }
  }

  send(type: string, data: unknown): void {
    if (!this.room) {
      console.warn('[forge.net] Cannot send message: not connected');
      return;
    }
    console.info(`[forge.net] Would send message: ${type}`, data);
    // this.room.send(type, data);
  }

  onMessage(type: string, callback: (data: unknown) => void): void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(callback);
  }

  onPlayerJoin(callback: (playerId: string) => void): void {
    this.playerJoinHandlers.add(callback);
  }

  onPlayerLeave(callback: (playerId: string) => void): void {
    this.playerLeaveHandlers.add(callback);
  }

  onStateChange(callback: (state: unknown) => void): void {
    this.stateChangeHandlers.add(callback);
  }

  getPlayerId(): string | null {
    return this.playerId;
  }

  getPlayerCount(): number {
    // Would return this.room?.state?.players?.size ?? 0
    return 0;
  }

  getRoomState(): unknown {
    return this.room;
  }

  // Private helper to setup room event handlers (for when Colyseus is installed)
  // private _setupRoomHandlers(): void {
  //   if (!this.room) return;
  //
  //   this.room.onMessage('*', (type: string, message: unknown) => {
  //     const handlers = this.messageHandlers.get(type);
  //     if (handlers) {
  //       handlers.forEach(handler => handler(message));
  //     }
  //   });
  //
  //   this.room.onStateChange((state: unknown) => {
  //     this.stateChangeHandlers.forEach(handler => handler(state));
  //   });
  //
  //   this.room.state.players.onAdd((player: unknown, sessionId: string) => {
  //     this.playerJoinHandlers.forEach(handler => handler(sessionId));
  //   });
  //
  //   this.room.state.players.onRemove((player: unknown, sessionId: string) => {
  //     this.playerLeaveHandlers.forEach(handler => handler(sessionId));
  //   });
  // }
}

// Singleton instance for runtime use
let clientInstance: NetworkClient | null = null;

export function getNetworkClient(): NetworkClient | null {
  return clientInstance;
}

export function initNetworkClient(config: NetworkClientConfig): NetworkClient {
  clientInstance = new NetworkClient(config);
  return clientInstance;
}

export function destroyNetworkClient(): void {
  if (clientInstance) {
    clientInstance.leaveRoom();
    clientInstance = null;
  }
}
