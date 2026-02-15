import { create } from 'zustand';

export interface CollaboratorInfo {
  userId: string;
  name: string;
  color: string; // Unique cursor color
  avatarUrl?: string;
  selectedEntityIds: string[];
  cursorPosition?: { x: number; y: number };
  isOnline: boolean;
  lastSeen: number;
}

export interface ActivityEntry {
  id: string;
  userId: string;
  userName: string;
  action: string; // "moved Player", "changed material on Box", etc.
  timestamp: number;
  entityId?: string;
}

interface CollaborationState {
  isCollaborating: boolean;
  sessionId: string | null;
  collaborators: Record<string, CollaboratorInfo>;
  myUserId: string | null;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  lockedEntities: Record<string, string>; // entityId -> userId who locked it
  activityFeed: ActivityEntry[];

  // Actions
  startSession: (projectId: string, userId: string) => void;
  endSession: () => void;
  setConnectionStatus: (status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting') => void;
  updateCollaborator: (userId: string, info: Partial<CollaboratorInfo>) => void;
  removeCollaborator: (userId: string) => void;
  lockEntity: (entityId: string, userId: string) => void;
  unlockEntity: (entityId: string) => void;
  addActivity: (entry: Omit<ActivityEntry, 'id' | 'timestamp'>) => void;
  setCollaborators: (collaborators: Record<string, CollaboratorInfo>) => void;
  clearActivityFeed: () => void;
}

const USER_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ef4444', // red
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
];

function getColorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

export const useCollaborationStore = create<CollaborationState>((set, get) => ({
  isCollaborating: false,
  sessionId: null,
  collaborators: {},
  myUserId: null,
  connectionStatus: 'disconnected',
  lockedEntities: {},
  activityFeed: [],

  startSession: (projectId, userId) => {
    set({
      isCollaborating: true,
      sessionId: projectId,
      myUserId: userId,
      connectionStatus: 'connecting',
      collaborators: {},
      lockedEntities: {},
      activityFeed: [],
    });
  },

  endSession: () => {
    set({
      isCollaborating: false,
      sessionId: null,
      myUserId: null,
      connectionStatus: 'disconnected',
      collaborators: {},
      lockedEntities: {},
      activityFeed: [],
    });
  },

  setConnectionStatus: (status) => {
    set({ connectionStatus: status });
  },

  updateCollaborator: (userId, info) => {
    const { collaborators } = get();
    const existing = collaborators[userId] || {
      userId,
      name: info.name || 'Unknown',
      color: getColorForUser(userId),
      selectedEntityIds: [],
      isOnline: true,
      lastSeen: Date.now(),
    };

    set({
      collaborators: {
        ...collaborators,
        [userId]: {
          ...existing,
          ...info,
          lastSeen: Date.now(),
        },
      },
    });
  },

  removeCollaborator: (userId) => {
    const { collaborators, lockedEntities } = get();
    const newCollaborators = { ...collaborators };
    delete newCollaborators[userId];

    // Release any locks held by this user
    const newLocks = { ...lockedEntities };
    Object.keys(newLocks).forEach((entityId) => {
      if (newLocks[entityId] === userId) {
        delete newLocks[entityId];
      }
    });

    set({ collaborators: newCollaborators, lockedEntities: newLocks });
  },

  lockEntity: (entityId, userId) => {
    const { lockedEntities } = get();
    set({ lockedEntities: { ...lockedEntities, [entityId]: userId } });
  },

  unlockEntity: (entityId) => {
    const { lockedEntities } = get();
    const newLocks = { ...lockedEntities };
    delete newLocks[entityId];
    set({ lockedEntities: newLocks });
  },

  addActivity: (entry) => {
    const { activityFeed } = get();
    const newEntry: ActivityEntry = {
      ...entry,
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
    };
    const newFeed = [newEntry, ...activityFeed].slice(0, 100); // Keep last 100
    set({ activityFeed: newFeed });
  },

  setCollaborators: (collaborators) => {
    set({ collaborators });
  },

  clearActivityFeed: () => {
    set({ activityFeed: [] });
  },
}));
