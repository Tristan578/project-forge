'use client';

import { useCollaborationStore } from '@/stores/collaborationStore';
import { useMemo } from 'react';

export function CollaboratorAvatars() {
  const { collaborators, isCollaborating } = useCollaborationStore();

  const collaboratorList = useMemo(() => Object.values(collaborators), [collaborators]);

  if (!isCollaborating || collaboratorList.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-1.5">
      {collaboratorList.map((collab) => (
        <div
          key={collab.userId}
          className="relative group"
          title={`${collab.name} ${collab.isOnline ? '(online)' : '(offline)'}`}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium border-2 transition-transform hover:scale-110"
            style={{
              backgroundColor: collab.color,
              borderColor: collab.isOnline ? collab.color : '#666',
              opacity: collab.isOnline ? 1 : 0.5,
            }}
          >
            {collab.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={collab.avatarUrl} alt={collab.name} className="w-full h-full rounded-full object-cover" />
            ) : (
              <span>{collab.name.charAt(0).toUpperCase()}</span>
            )}
          </div>
          {collab.isOnline && (
            <div
              className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 rounded-full border border-gray-900"
            />
          )}
        </div>
      ))}
    </div>
  );
}
