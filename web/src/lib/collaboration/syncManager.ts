/**
 * Collaboration sync manager - infrastructure-ready layer.
 * NOTE: yjs and @hocuspocus/provider are NOT installed.
 * This module uses dynamic imports with graceful fallbacks.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SyncChangeEvent {
  type: 'entity_update' | 'entity_create' | 'entity_delete';
  entityId: string;
  field?: string;
  value?: unknown;
  snapshot?: unknown;
}

export interface AwarenessState {
  cursor?: { x: number; y: number };
  selectedEntities?: string[];
  name?: string;
  color?: string;
}

type ChangeCallback = (changes: SyncChangeEvent[]) => void;
type AwarenessCallback = (states: Map<number, AwarenessState>) => void;

/**
 * Collaboration sync manager using Yjs + HocusPocus (when available).
 */
export class CollaborationSyncManager {
  private doc: unknown | null = null;
  private provider: unknown | null = null;
  private connected = false;
  private changeCallbacks: ChangeCallback[] = [];
  private awarenessCallbacks: AwarenessCallback[] = [];

  /**
   * Connect to a collaboration session.
   * Attempts to load yjs/hocuspocus dynamically.
   */
  async connect(projectId: string, userId: string): Promise<void> {
    try {
      // Dynamic import (will fail gracefully if packages not installed)
      const Y = await import('yjs' as any).catch(() => null);
      const { HocuspocusProvider } = await import('@hocuspocus/provider' as any).catch(() => ({ HocuspocusProvider: null }));

      if (!Y || !HocuspocusProvider) {
        console.warn('[CollaborationSyncManager] yjs/hocuspocus not installed. Collaboration disabled.');
        return;
      }

      // Create Yjs document
      this.doc = new Y.Doc();

      // Connect to HocusPocus server (stub URL - replace with actual server)
      this.provider = new HocuspocusProvider({
        url: `ws://localhost:1234`,
        name: `project-${projectId}`,
        document: this.doc,
        token: userId,
      });

      // Listen for changes
      (this.doc as any).on('update', (_update: Uint8Array, _origin: unknown) => {
        this.emitChanges([]);
      });

      // Listen for awareness updates
      (this.provider as any).on('awarenessUpdate', ({ states }: { states: Map<number, unknown> }) => {
        this.emitAwarenessUpdate(states as Map<number, AwarenessState>);
      });

      this.connected = true;
      console.log(`[CollaborationSyncManager] Connected to project ${projectId}`);
    } catch (err) {
      console.error('[CollaborationSyncManager] Failed to connect:', err);
    }
  }

  /**
   * Disconnect from the session.
   */
  disconnect(): void {
    if (this.provider && typeof (this.provider as any).destroy === 'function') {
      (this.provider as any).destroy();
    }
    this.doc = null;
    this.provider = null;
    this.connected = false;
    this.changeCallbacks = [];
    this.awarenessCallbacks = [];
    console.log('[CollaborationSyncManager] Disconnected');
  }

  /**
   * Sync an entity update to the Yjs document.
   */
  syncEntityUpdate(entityId: string, field: string, value: unknown): void {
    if (!this.connected || !this.doc) return;

    try {
      const entities = (this.doc as any).getMap('entities');
      const entity = entities.get(entityId) || (this.doc as any).Map();
      entity.set(field, value);
      entities.set(entityId, entity);
    } catch (err) {
      console.error('[CollaborationSyncManager] syncEntityUpdate failed:', err);
    }
  }

  /**
   * Sync an entity creation to the Yjs document.
   */
  syncEntityCreate(entityId: string, snapshot: unknown): void {
    if (!this.connected || !this.doc) return;

    try {
      const entities = (this.doc as any).getMap('entities');
      entities.set(entityId, snapshot);
    } catch (err) {
      console.error('[CollaborationSyncManager] syncEntityCreate failed:', err);
    }
  }

  /**
   * Sync an entity deletion to the Yjs document.
   */
  syncEntityDelete(entityId: string): void {
    if (!this.connected || !this.doc) return;

    try {
      const entities = (this.doc as any).getMap('entities');
      entities.delete(entityId);
    } catch (err) {
      console.error('[CollaborationSyncManager] syncEntityDelete failed:', err);
    }
  }

  /**
   * Update awareness state (cursor position, selected entities).
   */
  updateAwareness(state: AwarenessState): void {
    if (!this.connected || !this.provider) return;

    try {
      const awareness = (this.provider as any).awareness;
      if (awareness && typeof awareness.setLocalState === 'function') {
        awareness.setLocalState(state);
      }
    } catch (err) {
      console.error('[CollaborationSyncManager] updateAwareness failed:', err);
    }
  }

  /**
   * Register a callback for remote changes.
   */
  onRemoteChange(callback: ChangeCallback): void {
    this.changeCallbacks.push(callback);
  }

  /**
   * Register a callback for awareness updates.
   */
  onAwarenessChange(callback: AwarenessCallback): void {
    this.awarenessCallbacks.push(callback);
  }

  /**
   * Emit changes to all registered callbacks.
   */
  private emitChanges(changes: SyncChangeEvent[]): void {
    for (const cb of this.changeCallbacks) {
      cb(changes);
    }
  }

  /**
   * Emit awareness updates to all registered callbacks.
   */
  private emitAwarenessUpdate(states: Map<number, AwarenessState>): void {
    for (const cb of this.awarenessCallbacks) {
      cb(states);
    }
  }

  /**
   * Check if currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }
}
