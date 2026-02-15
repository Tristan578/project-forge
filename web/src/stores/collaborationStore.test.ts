import { describe, it, expect, beforeEach } from 'vitest';
import { useCollaborationStore } from './collaborationStore';

describe('collaborationStore', () => {
  beforeEach(() => {
    useCollaborationStore.setState({
      isCollaborating: false,
      sessionId: null,
      collaborators: {},
      myUserId: null,
      connectionStatus: 'disconnected',
      lockedEntities: {},
      activityFeed: [],
    });
  });

  it('starts a collaboration session', () => {
    const { startSession } = useCollaborationStore.getState();

    startSession('project-123', 'user-456');

    const state = useCollaborationStore.getState();
    expect(state.isCollaborating).toBe(true);
    expect(state.sessionId).toBe('project-123');
    expect(state.myUserId).toBe('user-456');
    expect(state.connectionStatus).toBe('connecting');
  });

  it('ends a collaboration session', () => {
    const { startSession, endSession } = useCollaborationStore.getState();

    startSession('project-123', 'user-456');
    endSession();

    const state = useCollaborationStore.getState();
    expect(state.isCollaborating).toBe(false);
    expect(state.sessionId).toBeNull();
    expect(state.myUserId).toBeNull();
    expect(state.connectionStatus).toBe('disconnected');
    expect(state.collaborators).toEqual({});
  });

  it('updates a collaborator', () => {
    const { updateCollaborator } = useCollaborationStore.getState();

    updateCollaborator('user-789', {
      name: 'Alice',
      selectedEntityIds: ['entity-1', 'entity-2'],
      isOnline: true,
    });

    const state = useCollaborationStore.getState();
    const alice = state.collaborators['user-789'];

    expect(alice).toBeDefined();
    expect(alice.name).toBe('Alice');
    expect(alice.selectedEntityIds).toEqual(['entity-1', 'entity-2']);
    expect(alice.isOnline).toBe(true);
    expect(alice.color).toBeDefined(); // Auto-assigned color
  });

  it('removes a collaborator and releases their locks', () => {
    const { updateCollaborator, lockEntity, removeCollaborator } = useCollaborationStore.getState();

    updateCollaborator('user-789', { name: 'Alice', isOnline: true, selectedEntityIds: [] });
    lockEntity('entity-1', 'user-789');
    lockEntity('entity-2', 'user-789');

    removeCollaborator('user-789');

    const state = useCollaborationStore.getState();
    expect(state.collaborators['user-789']).toBeUndefined();
    expect(state.lockedEntities['entity-1']).toBeUndefined();
    expect(state.lockedEntities['entity-2']).toBeUndefined();
  });

  it('locks and unlocks entities', () => {
    const { lockEntity, unlockEntity } = useCollaborationStore.getState();

    lockEntity('entity-1', 'user-789');

    let state = useCollaborationStore.getState();
    expect(state.lockedEntities['entity-1']).toBe('user-789');

    unlockEntity('entity-1');

    state = useCollaborationStore.getState();
    expect(state.lockedEntities['entity-1']).toBeUndefined();
  });

  it('adds activity feed entries', () => {
    const { addActivity } = useCollaborationStore.getState();

    addActivity({
      userId: 'user-789',
      userName: 'Alice',
      action: 'moved Player',
      entityId: 'entity-1',
    });

    const state = useCollaborationStore.getState();
    expect(state.activityFeed).toHaveLength(1);
    expect(state.activityFeed[0].userName).toBe('Alice');
    expect(state.activityFeed[0].action).toBe('moved Player');
    expect(state.activityFeed[0].id).toBeDefined(); // Auto-generated
    expect(state.activityFeed[0].timestamp).toBeGreaterThan(0);
  });

  it('limits activity feed to 100 entries', () => {
    const { addActivity } = useCollaborationStore.getState();

    // Add 150 entries
    for (let i = 0; i < 150; i++) {
      addActivity({
        userId: 'user-789',
        userName: 'Alice',
        action: `action ${i}`,
      });
    }

    const state = useCollaborationStore.getState();
    expect(state.activityFeed).toHaveLength(100);
    // Most recent should be first
    expect(state.activityFeed[0].action).toBe('action 149');
  });

  it('sets connection status', () => {
    const { setConnectionStatus } = useCollaborationStore.getState();

    setConnectionStatus('connected');
    expect(useCollaborationStore.getState().connectionStatus).toBe('connected');

    setConnectionStatus('reconnecting');
    expect(useCollaborationStore.getState().connectionStatus).toBe('reconnecting');
  });

  it('clears activity feed', () => {
    const { addActivity, clearActivityFeed } = useCollaborationStore.getState();

    addActivity({ userId: 'user-1', userName: 'Alice', action: 'test' });
    addActivity({ userId: 'user-2', userName: 'Bob', action: 'test' });

    clearActivityFeed();

    const state = useCollaborationStore.getState();
    expect(state.activityFeed).toHaveLength(0);
  });
});
