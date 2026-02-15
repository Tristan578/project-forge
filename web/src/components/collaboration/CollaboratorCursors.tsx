'use client';

import { useCollaborationStore } from '@/stores/collaborationStore';
import { useMemo } from 'react';

export function CollaboratorCursors() {
  const { collaborators, isCollaborating, myUserId } = useCollaborationStore();

  const collaboratorList = useMemo(() => {
    return Object.values(collaborators).filter(
      (collab) => collab.userId !== myUserId && collab.isOnline && collab.cursorPosition
    );
  }, [collaborators, myUserId]);

  if (!isCollaborating || collaboratorList.length === 0) {
    return null;
  }

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-50"
      style={{ width: '100%', height: '100%' }}
    >
      {collaboratorList.map((collab) => {
        const pos = collab.cursorPosition;
        if (!pos) return null;

        return (
          <g key={collab.userId}>
            {/* Cursor pointer */}
            <path
              d="M 0 0 L 0 16 L 4 12 L 7 18 L 9 17 L 6 11 L 11 11 Z"
              transform={`translate(${pos.x}, ${pos.y})`}
              fill={collab.color}
              stroke="white"
              strokeWidth="1"
            />
            {/* Name label */}
            <text
              x={pos.x + 12}
              y={pos.y + 4}
              fontSize="12"
              fill="white"
              stroke="black"
              strokeWidth="0.5"
              paintOrder="stroke"
              className="select-none"
            >
              {collab.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
