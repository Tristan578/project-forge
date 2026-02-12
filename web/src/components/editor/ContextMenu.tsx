/**
 * Context Menu component for the scene hierarchy panel.
 *
 * Displays a right-click menu with entity actions: Rename, Focus, Duplicate, Delete.
 * Features viewport clamping, keyboard shortcuts, and click-outside dismissal.
 */

'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Focus, Copy, Trash2, Edit3 } from 'lucide-react';

interface MenuItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface MenuDivider {
  type: 'divider';
}

type MenuItemOrDivider = MenuItem | MenuDivider;

interface ContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  onRename: () => void;
  onFocus: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function isDivider(item: MenuItemOrDivider): item is MenuDivider {
  return 'type' in item && item.type === 'divider';
}

export function ContextMenu({
  isOpen,
  position,
  onClose,
  onRename,
  onFocus,
  onDuplicate,
  onDelete,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [clampedPosition, setClampedPosition] = useState(position);

  // Reset position when it changes
  useEffect(() => {
    setClampedPosition(position);
  }, [position]);

  // Menu item definitions
  const menuItems: MenuItemOrDivider[] = [
    {
      id: 'rename',
      label: 'Rename',
      icon: Edit3,
      shortcut: 'F2',
      action: onRename,
    },
    {
      id: 'focus',
      label: 'Focus',
      icon: Focus,
      shortcut: 'F',
      action: onFocus,
    },
    { type: 'divider' },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: Copy,
      shortcut: 'Ctrl+D',
      action: onDuplicate,
    },
    { type: 'divider' },
    {
      id: 'delete',
      label: 'Delete',
      icon: Trash2,
      shortcut: 'Delete',
      action: onDelete,
      danger: true,
    },
  ];

  // Handle click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Use capture phase to intercept before other handlers
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isOpen, onClose]);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen, onClose]);

  // Update clamped position after layout (before paint)
  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current) {
      return;
    }

    const menuRect = menuRef.current.getBoundingClientRect();

    // Viewport bounds (with padding)
    const viewportPadding = 8;
    const maxX = window.innerWidth - viewportPadding;
    const maxY = window.innerHeight - viewportPadding;

    // Calculate clamped position
    let clampedX = position.x;
    let clampedY = position.y;

    // Clamp to right edge of viewport
    if (position.x + menuRect.width > maxX) {
      clampedX = maxX - menuRect.width;
    }

    // Clamp to bottom edge of viewport
    if (position.y + menuRect.height > maxY) {
      clampedY = maxY - menuRect.height;
    }

    // Ensure minimum x/y (don't go off left or top)
    clampedX = Math.max(viewportPadding, clampedX);
    clampedY = Math.max(viewportPadding, clampedY);

    setClampedPosition({ x: clampedX, y: clampedY });
  }, [isOpen, position]);

  if (!isOpen) return null;

  const handleMenuItemClick = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[180px] bg-neutral-800 border border-neutral-600 rounded-md shadow-lg py-1 text-sm"
      style={{
        left: `${clampedPosition.x}px`,
        top: `${clampedPosition.y}px`,
      }}
      // Prevent clicks from propagating to the canvas
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menuItems.map((item, index) => {
        if (isDivider(item)) {
          return (
            <div
              key={`divider-${index}`}
              className="h-px bg-neutral-600 my-1 mx-2"
            />
          );
        }

        const Icon = item.icon;
        const isDisabled = item.disabled ?? false;

        return (
          <button
            key={item.id}
            className={`
              w-full flex items-center gap-3 px-3 py-1.5 text-left
              ${isDisabled
                ? 'text-neutral-500 cursor-not-allowed'
                : item.danger
                  ? 'text-red-400 hover:bg-red-500/20'
                  : 'text-neutral-200 hover:bg-white/10'
              }
              transition-colors duration-75
            `}
            onClick={() => !isDisabled && handleMenuItemClick(item.action)}
            disabled={isDisabled}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <span className="text-xs text-neutral-500 ml-4">
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
