'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { PanelTopOpen, Check } from 'lucide-react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { PANEL_DEFINITIONS } from '@/lib/workspace/panelRegistry';

const PANEL_LIST = Object.values(PANEL_DEFINITIONS);

export function PanelsMenu() {
  const [open, setOpen] = useState(false);
  // Counter to force re-read of open panels after toggling
  const [refreshKey, setRefreshKey] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const openPanel = useWorkspaceStore((s) => s.openPanel);
  const api = useWorkspaceStore((s) => s.api);

  // Read open panel IDs from the API — derived state, no effect needed
  const openPanelIds = api && open
    ? api.panels.map((p) => p.id)
    : [];
  // refreshKey is used to trigger re-render after panel toggle
  void refreshKey;

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = useCallback(
    (panelId: string) => {
      openPanel(panelId);
      // Bump refresh key to re-read panel list
      setRefreshKey((k) => k + 1);
    },
    [openPanel]
  );

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
        title="Show/hide panels"
      >
        <PanelTopOpen size={13} />
        <span className="text-[10px]">Panels</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded border border-zinc-700 bg-zinc-900 py-1 shadow-xl text-xs">
          <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
            Toggle Panels
          </div>
          {PANEL_LIST.map((panel) => {
            const isOpen = openPanelIds.includes(panel.id);
            return (
              <button
                key={panel.id}
                onClick={() => handleToggle(panel.id)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                {isOpen ? (
                  <Check size={12} className="text-green-400" />
                ) : (
                  <span className="w-3" />
                )}
                <span>{panel.title}</span>
                {isOpen && (
                  <span className="ml-auto text-[10px] text-zinc-600">open</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
