'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { HelpCircle, Keyboard, BookOpen, GraduationCap, RotateCcw } from 'lucide-react';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

const WELCOMED_KEY = 'forge-welcomed';

interface HelpMenuProps {
  onOpenShortcuts: () => void;
}

export function HelpMenu({ onOpenShortcuts }: HelpMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const startTutorial = useOnboardingStore((s) => s.startTutorial);
  const openPanel = useWorkspaceStore((s) => s.openPanel);

  const close = useCallback(() => setOpen(false), []);

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

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, close]);

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
    close();
    openPanel('docs');
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="rounded p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
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
        >
          <MenuItem
            icon={<Keyboard size={14} />}
            label="Keyboard Shortcuts"
            shortcut="?"
            onClick={handleOpenShortcuts}
          />
          <MenuItem
            icon={<BookOpen size={14} />}
            label="Documentation"
            shortcut="F1"
            onClick={handleOpenDocs}
          />
          <div className="my-1 h-px bg-zinc-800" />
          <MenuItem
            icon={<GraduationCap size={14} />}
            label="Restart Tutorial"
            onClick={handleRestartTutorial}
          />
          <MenuItem
            icon={<RotateCcw size={14} />}
            label="Show Welcome Screen"
            onClick={handleResetWelcome}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, shortcut, onClick }: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
    >
      <span className="text-zinc-500">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {shortcut && <span className="text-[10px] text-zinc-600">{shortcut}</span>}
    </button>
  );
}
