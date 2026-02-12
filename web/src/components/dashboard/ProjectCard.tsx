'use client';

import { useState, useMemo } from 'react';
import { MoreVertical, FolderOpen, Edit, Trash2 } from 'lucide-react';

interface ProjectCardProps {
  project: {
    id: string;
    name: string;
    thumbnail: string | null;
    entityCount: number;
    updatedAt: string;
  };
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newName: string) => void;
}

export function ProjectCard({ project, onOpen, onDelete, onRename }: ProjectCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(project.name);
  const [showConfirm, setShowConfirm] = useState(false);

  const relativeTime = useMemo(() => {
    const then = new Date(project.updatedAt).getTime();
    // eslint-disable-next-line react-hooks/purity -- relative time inherently requires current time
    const diffMinutes = Math.round((Date.now() - then) / 60000);
    if (diffMinutes < 1) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.round(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.round(diffDays / 30);
    return `${diffMonths}mo ago`;
  }, [project.updatedAt]);

  const handleRename = () => {
    if (editValue.trim() && editValue !== project.name) {
      onRename(project.id, editValue.trim());
    }
    setEditing(false);
  };

  const handleDelete = () => {
    if (showConfirm) {
      onDelete(project.id);
      setShowConfirm(false);
    } else {
      setShowConfirm(true);
    }
  };

  return (
    <div className="group relative overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] transition-all hover:border-[var(--color-accent)]">
      {/* Thumbnail */}
      <div
        className="h-[180px] cursor-pointer"
        onClick={() => onOpen(project.id)}
        style={{
          background: project.thumbnail
            ? `url(${project.thumbnail}) center/cover`
            : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        }}
      />

      {/* Info */}
      <div className="p-3">
        {/* Name */}
        {editing ? (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
              if (e.key === 'Escape') {
                setEditValue(project.name);
                setEditing(false);
              }
            }}
            autoFocus
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-2 py-1 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          />
        ) : (
          <h3 className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
            {project.name}
          </h3>
        )}

        {/* Metadata */}
        <div className="mt-2 flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
          <span>{project.entityCount} entities</span>
          <span>{relativeTime}</span>
        </div>
      </div>

      {/* Menu button */}
      <div className="absolute right-2 top-2">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="rounded bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
        >
          <MoreVertical size={16} />
        </button>

        {/* Dropdown menu */}
        {showMenu && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setShowMenu(false)}
            />
            <div className="absolute right-0 top-8 z-20 w-40 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] shadow-xl">
              <button
                onClick={() => {
                  setShowMenu(false);
                  onOpen(project.id);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-primary)]"
              >
                <FolderOpen size={14} />
                Open
              </button>
              <button
                onClick={() => {
                  setShowMenu(false);
                  setEditing(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-primary)]"
              >
                <Edit size={14} />
                Rename
              </button>
              <button
                onClick={() => {
                  setShowMenu(false);
                  handleDelete();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-400 hover:bg-[var(--color-bg-primary)]"
              >
                <Trash2 size={14} />
                {showConfirm ? 'Confirm Delete?' : 'Delete'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Confirm delete overlay */}
      {showConfirm && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/80"
          onClick={() => setShowConfirm(false)}
        >
          <div className="text-center">
            <p className="mb-3 text-sm text-white">Delete this project?</p>
            <div className="flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete();
                }}
                className="rounded bg-red-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowConfirm(false);
                }}
                className="rounded bg-gray-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
