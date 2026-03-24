'use client';

import { useEffect, useCallback, useRef } from 'react';
import { trackPanelOpened, trackPanelClosed } from '@/lib/analytics/panelTracking';

interface DrawerPanelProps {
  side: 'left' | 'right';
  open: boolean;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}

// Map side to a stable analytics panel ID.
const PANEL_ID: Record<'left' | 'right', string> = {
  left: 'scene-hierarchy',
  right: 'inspector',
};

export function DrawerPanel({ side, open, onClose, width = 280, children }: DrawerPanelProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Track panel open/close lifecycle with duration.
  // Uses useEffect to avoid side effects during render (concurrent mode safety).
  const openedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const panelId = PANEL_ID[side];
    if (open) {
      openedAtRef.current = Date.now();
      trackPanelOpened(panelId);
    } else if (openedAtRef.current !== null) {
      trackPanelClosed(panelId, Date.now() - openedAtRef.current);
      openedAtRef.current = null;
    }
  }, [open, side]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Focus trap within the drawer
      if (e.key === 'Tab') {
        const drawer = drawerRef.current;
        if (!drawer) return;
        const focusable = drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  // Auto-focus the drawer when it opens
  useEffect(() => {
    if (open && drawerRef.current) {
      requestAnimationFrame(() => {
        drawerRef.current?.focus();
      });
    }
  }, [open]);

  const label = side === 'left' ? 'Scene hierarchy panel' : 'Inspector panel';

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
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`fixed top-0 z-50 h-full bg-zinc-900 border-zinc-700 shadow-xl transition-transform duration-200 ease-in-out overflow-hidden focus:outline-none ${
          side === 'left' ? 'left-0 border-r' : 'right-0 border-l'
        } ${
          open
            ? 'translate-x-0'
            : side === 'left'
              ? '-translate-x-full'
              : 'translate-x-full'
        }`}
        style={{ width: `min(${width}px, 85vw)` }}
      >
        {children}
      </div>
    </>
  );
}
