'use client';

import { useCollaborationStore } from '@/stores/collaborationStore';
import { useMemo } from 'react';
import { Lock } from 'lucide-react';

interface EntityLockBadgeProps {
  entityId: string;
}

export function EntityLockBadge({ entityId }: EntityLockBadgeProps) {
  const { lockedEntities, collaborators, isCollaborating } = useCollaborationStore();

  const lockInfo = useMemo(() => {
    if (!isCollaborating) return null;

    const lockedBy = lockedEntities[entityId];
    if (!lockedBy) return null;

    const collaborator = collaborators[lockedBy];
    return collaborator || null;
  }, [entityId, lockedEntities, collaborators, isCollaborating]);

  if (!lockInfo) return null;

  return (
    <div
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs"
      style={{ backgroundColor: `${lockInfo.color}20`, color: lockInfo.color }}
      title={`Being edited by ${lockInfo.name}`}
    >
      <Lock className="w-3 h-3" />
      <span className="font-medium">{lockInfo.name}</span>
    </div>
  );
}
