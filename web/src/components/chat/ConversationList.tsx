'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Plus, Trash2, ChevronDown, Pencil, Check, X } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';

/**
 * Dropdown conversation switcher for the chat panel header.
 */
export function ConversationList() {
  const conversations = useChatStore((s) => s.conversations);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const createConversation = useChatStore((s) => s.createConversation);
  const switchConversation = useChatStore((s) => s.switchConversation);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const loadConversations = useChatStore((s) => s.loadConversations);

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Close dropdown on outside click
  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
      setIsOpen(false);
      setEditingId(null);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, handleClickOutside]);

  const activeConv = conversations.find((c) => c.id === activeConversationId);
  const displayName = activeConv?.name || 'New Chat';

  const handleStartRename = useCallback((id: string, currentName: string) => {
    setEditingId(id);
    setEditName(currentName);
  }, []);

  const handleConfirmRename = useCallback(() => {
    if (editingId && editName.trim()) {
      renameConversation(editingId, editName.trim());
    }
    setEditingId(null);
  }, [editingId, editName, renameConversation]);

  const handleCancelRename = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleNewChat = useCallback(() => {
    createConversation();
    setIsOpen(false);
  }, [createConversation]);

  const handleSwitch = useCallback((id: string) => {
    switchConversation(id);
    setIsOpen(false);
  }, [switchConversation]);

  const handleDelete = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteConversation(id);
  }, [deleteConversation]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
        title="Switch conversation"
        aria-label="Switch conversation"
        aria-expanded={isOpen}
      >
        <span className="max-w-[120px] truncate">{displayName}</span>
        <ChevronDown size={10} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[200px] max-w-[280px] rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
          {/* New chat button */}
          <button
            onClick={handleNewChat}
            className="flex w-full items-center gap-1.5 border-b border-zinc-800 px-3 py-2 text-[11px] text-purple-400 hover:bg-zinc-800 transition-colors"
          >
            <Plus size={12} />
            New Chat
          </button>

          {/* Conversation list */}
          <div className="max-h-[240px] overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="px-3 py-2 text-[10px] text-zinc-500">
                No saved conversations
              </div>
            ) : (
              conversations
                .slice()
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((conv) => (
                  <div
                    key={conv.id}
                    className={`group flex items-center gap-1 px-3 py-1.5 cursor-pointer transition-colors ${
                      conv.id === activeConversationId
                        ? 'bg-purple-900/20 text-zinc-200'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300'
                    }`}
                    onClick={() => editingId !== conv.id && handleSwitch(conv.id)}
                  >
                    {editingId === conv.id ? (
                      <div className="flex flex-1 items-center gap-1">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleConfirmRename();
                            if (e.key === 'Escape') handleCancelRename();
                          }}
                          className="flex-1 rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-200 outline-none"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button
                          onClick={(e) => { e.stopPropagation(); handleConfirmRename(); }}
                          className="text-green-400 hover:text-green-300"
                          aria-label="Confirm rename"
                        >
                          <Check size={11} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleCancelRename(); }}
                          className="text-zinc-500 hover:text-zinc-300"
                          aria-label="Cancel rename"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="flex-1 truncate text-[11px]">{conv.name}</span>
                        <span className="text-[9px] text-zinc-500">
                          {conv.messages.length} msg{conv.messages.length !== 1 ? 's' : ''}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleStartRename(conv.id, conv.name); }}
                          className="hidden text-zinc-500 hover:text-zinc-300 group-hover:block"
                          aria-label={`Rename ${conv.name}`}
                        >
                          <Pencil size={10} />
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, conv.id)}
                          className="hidden text-zinc-500 hover:text-red-400 group-hover:block"
                          aria-label={`Delete ${conv.name}`}
                        >
                          <Trash2 size={10} />
                        </button>
                      </>
                    )}
                  </div>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
