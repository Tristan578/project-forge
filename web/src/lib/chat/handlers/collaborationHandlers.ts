/**
 * Collaboration handlers for MCP commands.
 */

import type { ToolHandler } from './types';
import { useCollaborationStore } from '@/stores/collaborationStore';

export const collaborationHandlers: Record<string, ToolHandler> = {
  start_collaboration: async (args, _ctx) => {
    const projectId = args.projectId as string;
    const userId = args.userId as string;

    // Start collaboration session in store
    useCollaborationStore.getState().startSession(projectId, userId);

    return {
      success: true,
      result: {
        message: 'Collaboration session started',
        projectId,
        sessionId: projectId,
      },
    };
  },

  invite_collaborator: async (args, _ctx) => {
    const projectId = args.projectId as string;
    const permissionLevel = (args.permissionLevel as 'editor' | 'viewer') || 'editor';

    const { sessionId } = useCollaborationStore.getState();
    if (!sessionId) {
      return {
        success: false,
        error: 'No active collaboration session',
      };
    }

    // Generate invite link (in browser context, this would use window.location)
    const inviteUrl = `/editor/${projectId}?join=${sessionId}&role=${permissionLevel}`;

    return {
      success: true,
      result: {
        inviteUrl,
        permissionLevel,
        expiresIn: '24h',
      },
    };
  },

  list_collaborators: async (_args, _ctx) => {
    const { collaborators, isCollaborating } = useCollaborationStore.getState();

    if (!isCollaborating) {
      return {
        success: false,
        error: 'No active collaboration session',
      };
    }

    const collaboratorList = Object.values(collaborators);

    return {
      success: true,
      result: {
        total: collaboratorList.length,
        collaborators: collaboratorList.map((c) => ({
          userId: c.userId,
          name: c.name,
          isOnline: c.isOnline,
          selectedEntities: c.selectedEntityIds.length,
        })),
      },
    };
  },

  lock_entity: async (args, _ctx) => {
    const entityId = args.entityId as string;
    const userId = args.userId as string;

    const { isCollaborating, myUserId } = useCollaborationStore.getState();
    if (!isCollaborating) {
      return {
        success: false,
        error: 'No active collaboration session',
      };
    }

    useCollaborationStore.getState().lockEntity(entityId, userId || myUserId || 'unknown');

    return {
      success: true,
      result: {
        entityId,
        lockedBy: userId || myUserId,
      },
    };
  },

  unlock_entity: async (args, _ctx) => {
    const entityId = args.entityId as string;

    const { isCollaborating } = useCollaborationStore.getState();
    if (!isCollaborating) {
      return {
        success: false,
        error: 'No active collaboration session',
      };
    }

    useCollaborationStore.getState().unlockEntity(entityId);

    return {
      success: true,
      result: {
        entityId,
        unlocked: true,
      },
    };
  },

  send_activity_message: async (args, _ctx) => {
    const action = args.action as string;
    const userId = args.userId as string;
    const userName = args.userName as string;
    const entityId = args.entityId as string | undefined;

    const { isCollaborating } = useCollaborationStore.getState();
    if (!isCollaborating) {
      return {
        success: false,
        error: 'No active collaboration session',
      };
    }

    useCollaborationStore.getState().addActivity({
      userId,
      userName,
      action,
      entityId,
    });

    return {
      success: true,
      result: {
        message: 'Activity logged',
      },
    };
  },
};
