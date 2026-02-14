'use client';

import { useEffect, useCallback } from 'react';

interface DrawerPanelProps {
  side: 'left' | 'right';
  open: boolean;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}

export function DrawerPanel({ side, open, onClose, width = 280, children }: DrawerPanelProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 transition-opacity"
          onClick={onClose}
        />
      )}
      {/* Drawer */}
      <div
        className={`fixed top-0 z-50 h-full bg-zinc-900 border-zinc-700 shadow-xl transition-transform duration-200 ease-in-out overflow-hidden ${
          side === 'left' ? 'left-0 border-r' : 'right-0 border-l'
        } ${
          open
            ? 'translate-x-0'
            : side === 'left'
              ? '-translate-x-full'
              : 'translate-x-full'
        }`}
        style={{ width: `${width}px` }}
      >
        {children}
      </div>
    </>
  );
}
