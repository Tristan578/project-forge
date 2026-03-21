'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { HelpCircle, Keyboard, BookOpen, GraduationCap, RotateCcw, MessageSquareText } from 'lucide-react';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const WELCOMED_KEY = 'forge-welcomed';

interface HelpMenuProps {
  onOpenShortcuts: () => void;
  onOpenFeedback: () => void;
}

export function HelpMenu({ onOpenShortcuts, onOpenFeedback }: HelpMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const startTutorial = useOnboardingStore((s) => s.startTutorial);
  const openPanel = useWorkspaceStore((s) => s.openPanel);
  const hasWorkspaceApi = useWorkspaceStore((s) => s.api !== null);

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, close]);

  // Focus first item when menu opens
  useEffect(() => {
    if (open) {
      // Defer to next frame so items are rendered
      requestAnimationFrame(() => {
        itemsRef.current[0]?.focus();
      });
    }
  }, [open]);

  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const items = itemsRef.current.filter(Boolean) as HTMLButtonElement[];
      const idx = items.indexOf(document.activeElement as HTMLButtonElement);

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = idx < items.length - 1 ? idx + 1 : 0;
          items[next]?.focus();
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = idx > 0 ? idx - 1 : items.length - 1;
          items[prev]?.focus();
          break;
        }
        case 'Escape':
          e.preventDefault();
          close();
          break;
        case 'Tab':
          close();
          break;
      }
    },
    [close]
  );

  const handleRestartTutorial = () => {
    close();
    startTutorial('first-scene');
  };

  const handleResetWelcome = () => {
    close();
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(WELCOMED_KEY);
    }
    window.location.reload();
  };

  const handleOpenShortcuts = () => {
    close();
    onOpenShortcuts();
  };

  const handleOpenDocs = () => {
    if (!hasWorkspaceApi) return;
    close();
    openPanel('docs');
  };

  const handleOpenFeedback = () => {
    close();
    onOpenFeedback();
  };

  // Track item index for ref assignment
  let itemIndex = 0;
  const getItemRef = () => {
    const i = itemIndex++;
    return (el: HTMLButtonElement | null) => {
      itemsRef.current[i] = el;
    };
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="rounded p-1 text-zinc-400 hover:text-zinc-300 transition-colors"
        title="Help"
        aria-label="Help menu"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <HelpCircle size={14} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-[60] w-52 rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl"
          onKeyDown={handleMenuKeyDown}
        >
          <MenuItem
            ref={getItemRef()}
            icon={<Keyboard size={14} />}
            label="Keyboard Shortcuts"
            shortcut="?"
            onClick={handleOpenShortcuts}
          />
          <MenuItem
            ref={getItemRef()}
            icon={<BookOpen size={14} />}
            label="Documentation"
            shortcut="F1"
            onClick={handleOpenDocs}
            disabled={!hasWorkspaceApi}
          />
          <div className="my-1 h-px bg-zinc-800" role="separator" />
          <MenuItem
            ref={getItemRef()}
            icon={<GraduationCap size={14} />}
            label="Restart Tutorial"
            onClick={handleRestartTutorial}
          />
          <MenuItem
            ref={getItemRef()}
            icon={<RotateCcw size={14} />}
            label="Show Welcome Screen"
            onClick={handleResetWelcome}
          />
          <div className="my-1 h-px bg-zinc-800" role="separator" />
          <MenuItem
            ref={getItemRef()}
            icon={<MessageSquareText size={14} />}
            label="Send Feedback"
            onClick={handleOpenFeedback}
          />
        </div>
      )}
    </div>
  );
}

import { forwardRef } from 'react';

const MenuItem = forwardRef<
  HTMLButtonElement,
  {
    icon: React.ReactNode;
    label: string;
    shortcut?: string;
    onClick: () => void;
    disabled?: boolean;
  }
>(function MenuItem({ icon, label, shortcut, onClick, disabled }, ref) {
  return (
    <button
      ref={ref}
      role="menuitem"
      tabIndex={-1}
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span className="text-zinc-400">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-[10px] text-zinc-400">{shortcut}</span>}
    </button>
  );
});
