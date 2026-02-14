'use client';

import { useState, useEffect, useCallback } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { CanvasArea } from './CanvasArea';
import { AssetPanel } from './AssetPanel';
import { AudioMixerPanel } from './AudioMixerPanel';
import { SceneHierarchy } from './SceneHierarchy';
import { InspectorPanel } from './InspectorPanel';
import { ScriptEditorPanel } from './ScriptEditorPanel';
import { PlayControls } from './PlayControls';
import { SceneToolbar } from './SceneToolbar';
import { TokenBalance } from '../settings/TokenBalance';
import { ChatPanel } from '../chat/ChatPanel';
import { DrawerPanel } from './DrawerPanel';
import { MobileToolbar } from './MobileToolbar';
import { WelcomeModal } from './WelcomeModal';
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel';
import { useChatStore, type RightPanelTab } from '@/stores/chatStore';
import { useEditorStore } from '@/stores/editorStore';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { UserButton } from '@clerk/nextjs';

const MOBILE_DISMISSED_KEY = 'forge-mobile-dismissed';

function RightPanelTabs({ activeTab, onTabChange }: { activeTab: RightPanelTab; onTabChange: (tab: RightPanelTab) => void }) {
  const hasUnread = useChatStore((s) => s.hasUnreadMessages);

  return (
    <div className="flex border-b border-zinc-800">
      <button
        onClick={() => onTabChange('inspector')}
        className={`flex-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
          activeTab === 'inspector'
            ? 'border-b border-blue-500 text-zinc-200'
            : 'text-zinc-600 hover:text-zinc-400'
        }`}
      >
        Inspector
      </button>
      <button
        onClick={() => onTabChange('chat')}
        className={`relative flex-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
          activeTab === 'chat'
            ? 'border-b border-purple-500 text-zinc-200'
            : 'text-zinc-600 hover:text-zinc-400'
        }`}
      >
        AI Chat
        {hasUnread && activeTab !== 'chat' && (
          <span className="absolute top-1 right-2 h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" />
        )}
      </button>
      <button
        onClick={() => onTabChange('script')}
        className={`flex-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
          activeTab === 'script'
            ? 'border-b border-green-500 text-zinc-200'
            : 'text-zinc-600 hover:text-zinc-400'
        }`}
      >
        Script
      </button>
    </div>
  );
}

function RightPanelContent({ activeTab }: { activeTab: RightPanelTab }) {
  if (activeTab === 'inspector') return <InspectorPanel />;
  if (activeTab === 'script') return <ScriptEditorPanel />;
  return <ChatPanel />;
}

function isMobileBannerDismissed(): boolean {
  if (typeof localStorage === 'undefined') return true;
  return !!localStorage.getItem(MOBILE_DISMISSED_KEY);
}

function MobileBanner() {
  const [dismissed, setDismissed] = useState(isMobileBannerDismissed);

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(MOBILE_DISMISSED_KEY, '1');
  };

  if (dismissed) return null;

  return (
    <div className="absolute top-10 left-2 right-2 z-20 flex items-center gap-2 rounded border border-amber-700/50 bg-amber-900/80 px-3 py-2 text-xs text-amber-200 shadow-lg">
      <span className="flex-1">Project Forge is optimized for desktop browsers. Some features may be limited on mobile.</span>
      <button onClick={handleDismiss} className="shrink-0 rounded p-0.5 hover:bg-amber-800">
        <X size={14} />
      </button>
    </div>
  );
}

export function EditorLayout() {
  const rightPanelTab = useChatStore((s) => s.rightPanelTab);
  const setRightPanelTab = useChatStore((s) => s.setRightPanelTab);
  const mixerPanelOpen = useEditorStore((s) => s.mixerPanelOpen);
  const layout = useResponsiveLayout();

  // Drawer state for compact mode
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Close drawers when switching away from compact mode (prev-value pattern)
  const [prevMode, setPrevMode] = useState(layout.mode);
  if (prevMode !== layout.mode) {
    setPrevMode(layout.mode);
    if (layout.mode !== 'compact') {
      setLeftDrawerOpen(false);
      setRightDrawerOpen(false);
    }
  }

  // ? key opens shortcuts panel
  const handleGlobalKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (isInput) return;
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
      }
    },
    []
  );

  useEffect(() => {
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  const rightPanelWidth = rightPanelTab === 'script' ? '480px' : '280px';

  // --- Compact layout (mobile/tablet) ---
  if (layout.mode === 'compact') {
    return (
      <div className="relative h-screen w-screen bg-zinc-950">
        {/* Top bar - simplified */}
        <div className="flex h-8 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-2">
          <span className="text-xs font-semibold text-zinc-400">Project Forge</span>
          <PlayControls />
          <button
            onClick={() => setShortcutsOpen(true)}
            className="rounded p-1 text-zinc-500 hover:text-zinc-300"
            title="Keyboard shortcuts"
          >
            <HelpCircle size={14} />
          </button>
        </div>

        {/* Canvas fills remaining space */}
        <div className="absolute inset-0 top-8 bottom-12">
          <CanvasArea />
          <MobileBanner />
        </div>

        {/* Bottom toolbar */}
        <MobileToolbar
          onToggleLeft={() => setLeftDrawerOpen((o) => !o)}
          onToggleRight={() => setRightDrawerOpen((o) => !o)}
        />

        {/* Drawers */}
        <DrawerPanel side="left" open={leftDrawerOpen} onClose={() => setLeftDrawerOpen(false)} width={280}>
          <SceneHierarchy />
        </DrawerPanel>
        <DrawerPanel side="right" open={rightDrawerOpen} onClose={() => setRightDrawerOpen(false)} width={300}>
          <RightPanelTabs activeTab={rightPanelTab} onTabChange={setRightPanelTab} />
          <div className="flex-1 overflow-hidden">
            <RightPanelContent activeTab={rightPanelTab} />
          </div>
        </DrawerPanel>

        <WelcomeModal />
        <KeyboardShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      </div>
    );
  }

  // --- Condensed / Full layout (laptop / desktop+) ---
  const hierarchyWidth = layout.hierarchyWidth;
  const bottomHeight = layout.bottomPanelHeight;

  return (
    <div
      className="grid h-screen w-screen bg-zinc-950 transition-[grid-template-columns] duration-200"
      style={{
        gridTemplateColumns: `56px ${hierarchyWidth}px 1fr ${rightPanelWidth}`,
        gridTemplateRows: `32px 1fr ${bottomHeight}px`,
      }}
    >
      {/* Top bar */}
      <div className="col-span-4 flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-zinc-400">Project Forge</span>
          <SceneToolbar />
        </div>
        <PlayControls />
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShortcutsOpen(true)}
            className="rounded p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
            title="Keyboard shortcuts (?)"
          >
            <HelpCircle size={14} />
          </button>
          <TokenBalance />
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </div>

      {/* Tool sidebar */}
      <Sidebar />

      {/* Scene hierarchy panel */}
      <div className="border-r border-zinc-800 bg-zinc-900 overflow-hidden">
        <SceneHierarchy />
      </div>

      {/* Main canvas */}
      <CanvasArea />

      {/* Right panel: Inspector / Chat tabs */}
      <div className="flex flex-col border-l border-zinc-800 bg-zinc-900 overflow-hidden">
        <RightPanelTabs activeTab={rightPanelTab} onTabChange={setRightPanelTab} />
        <div className="flex-1 overflow-hidden">
          <RightPanelContent activeTab={rightPanelTab} />
        </div>
      </div>

      {/* Bottom panel: Asset panel or Audio mixer */}
      <div className="col-span-4">
        {mixerPanelOpen ? <AudioMixerPanel /> : <AssetPanel />}
      </div>

      <WelcomeModal />
      <KeyboardShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
