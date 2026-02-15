'use client';

import { useCallback, useState, useMemo } from 'react';
import { useCollaborationStore } from '@/stores/collaborationStore';
import { Copy, Check, Users, X } from 'lucide-react';

interface ShareDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
}

export function ShareDialog({ isOpen, onClose, projectId }: ShareDialogProps) {
  const { collaborators, sessionId } = useCollaborationStore();
  const [copied, setCopied] = useState(false);
  const [permissionLevel, setPermissionLevel] = useState<'editor' | 'viewer'>('editor');

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined' || !sessionId) return '';
    return `${window.location.origin}/editor/${projectId}?join=${sessionId}`;
  }, [projectId, sessionId]);

  const collaboratorList = useMemo(() => Object.values(collaborators), [collaborators]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [shareUrl]);

  const handleKick = useCallback((_userId: string) => {
    // TODO: Implement kick functionality
    console.log('Kick user not yet implemented');
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2 text-lg font-medium text-gray-100">
            <Users className="w-5 h-5" />
            Share Project
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Share Link */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Share Link
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={shareUrl}
                readOnly
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 font-mono"
              />
              <button
                onClick={handleCopy}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors flex items-center gap-2"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Permission Level */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Permission Level
            </label>
            <select
              value={permissionLevel}
              onChange={(e) => setPermissionLevel(e.target.value as 'editor' | 'viewer')}
              className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-100"
            >
              <option value="editor">Editor (can edit)</option>
              <option value="viewer">Viewer (read-only)</option>
            </select>
          </div>

          {/* Connected Users */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Connected Users ({collaboratorList.length}/8)
            </label>
            <div className="bg-gray-900 border border-gray-700 rounded max-h-40 overflow-y-auto">
              {collaboratorList.length === 0 ? (
                <div className="text-center text-gray-500 text-sm py-4">
                  No collaborators yet
                </div>
              ) : (
                <div className="divide-y divide-gray-700">
                  {collaboratorList.map((collab) => (
                    <div key={collab.userId} className="flex items-center justify-between px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
                          style={{ backgroundColor: collab.color }}
                        >
                          {collab.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm text-gray-100">{collab.name}</div>
                          <div className="text-xs text-gray-500">
                            {collab.isOnline ? 'Online' : 'Offline'}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleKick(collab.userId)}
                        className="text-xs text-red-400 hover:text-red-300 transition-colors"
                      >
                        Kick
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="text-xs text-gray-500">
            Maximum 8 collaborators per session
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-100 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
