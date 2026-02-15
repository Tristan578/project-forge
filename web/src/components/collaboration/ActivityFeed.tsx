'use client';

import { useCollaborationStore } from '@/stores/collaborationStore';
import { useCallback, useMemo } from 'react';
import { Clock } from 'lucide-react';

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 1000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function ActivityFeed() {
  const { activityFeed, isCollaborating, clearActivityFeed } = useCollaborationStore();

  const handleClear = useCallback(() => {
    clearActivityFeed();
  }, [clearActivityFeed]);

  const sortedFeed = useMemo(() => {
    return [...activityFeed].sort((a, b) => b.timestamp - a.timestamp);
  }, [activityFeed]);

  if (!isCollaborating) {
    return null;
  }

  return (
    <div className="flex flex-col h-full bg-gray-900 border border-gray-700 rounded">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-100">
          <Clock className="w-4 h-4" />
          Activity
        </div>
        {activityFeed.length > 0 && (
          <button
            onClick={handleClear}
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sortedFeed.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-4">
            No activity yet
          </div>
        ) : (
          sortedFeed.map((entry) => (
            <div
              key={entry.id}
              className="text-xs text-gray-300 bg-gray-800 rounded px-2 py-1.5 hover:bg-gray-750 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-gray-100">{entry.userName}</span>
                  <span className="text-gray-400"> {entry.action}</span>
                </div>
                <span className="text-gray-500 text-[10px] whitespace-nowrap">
                  {formatRelativeTime(entry.timestamp)}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
