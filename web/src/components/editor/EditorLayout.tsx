'use client';

import { useState, useEffect, useCallback } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { CanvasArea } from './CanvasArea';
import { SceneHierarchy } from './SceneHierarchy';
import { InspectorPanel } from './InspectorPanel';
import { ScriptEditorPanel } from './ScriptEditorPanel';
import { UIBuilderPanel } from './UIBuilderPanel';
import { ShaderEditorPanel } from './ShaderEditorPanel';
import { PlayControls } from './PlayControls';
import { SceneToolbar } from './SceneToolbar';
import { LayoutMenu } from './LayoutMenu';
import { PanelsMenu } from './PanelsMenu';
import { TokenBalance } from '../settings/TokenBalance';
import { ChatPanel } from '../chat/ChatPanel';
import { DrawerPanel } from './DrawerPanel';
import { MobileToolbar } from './MobileToolbar';
import { WelcomeModal } from './WelcomeModal';
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel';
import { WorkspaceProvider } from './WorkspaceProvider';
import { SceneTransitionOverlay } from './SceneTransitionOverlay';
import { DialogueOverlay } from '../game/DialogueOverlay';
import { TutorialOverlay } from './TutorialOverlay';
import { OnboardingChecklist } from './OnboardingChecklist';
import { PerformanceProfiler } from './PerformanceProfiler';
import { useChatStore, type RightPanelTab } from '@/stores/chatStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { UserButton } from '@clerk/nextjs';

const MOBILE_DISMISSED_KEY = 'forge-mobile-dismissed';

// ---- Mobile-only components (unchanged) ----

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
      <button
        onClick={() => onTabChange('ui')}
        className={`flex-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
          activeTab === 'ui'
            ? 'border-b border-orange-500 text-zinc-200'
            : 'text-zinc-600 hover:text-zinc-400'
        }`}
      >
        UI
      </button>
    </div>
  );
}

function RightPanelContent({ activeTab }: { activeTab: RightPanelTab }) {
  if (activeTab === 'inspector') return <InspectorPanel />;
  if (activeTab === 'script') return <ScriptEditorPanel />;
  if (activeTab === 'ui') return <UIBuilderPanel />;
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

// ---- Floating Chat Overlay ----

function ChatOverlay() {
  const chatOverlayOpen = useWorkspaceStore((s) => s.chatOverlayOpen);
  const setChatOverlayOpen = useWorkspaceStore((s) => s.setChatOverlayOpen);

  if (!chatOverlayOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={() => setChatOverlayOpen(false)}
      />
      {/* Chat panel */}
      <div className="fixed left-1/2 top-[10vh] z-50 flex h-[70vh] w-[600px] max-w-[90vw] -translate-x-1/2 flex-col rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
          <span className="text-xs font-medium text-zinc-400">AI Chat (Ctrl+K to toggle)</span>
          <button
            onClick={() => setChatOverlayOpen(false)}
            className="rounded p-0.5 text-zinc-500 hover:text-zinc-300"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <ChatPanel />
        </div>
      </div>
    </>
  );
}

// ---- Main EditorLayout ----

export function EditorLayout() {
  const rightPanelTab = useChatStore((s) => s.rightPanelTab);
  const setRightPanelTab = useChatStore((s) => s.setRightPanelTab);
  const toggleChatOverlay = useWorkspaceStore((s) => s.toggleChatOverlay);
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

  // Global keyboard shortcuts
  const handleGlobalKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Ctrl+K / Cmd+K: Toggle AI chat overlay (works even in inputs)
      if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        toggleChatOverlay();
        return;
      }

      // F1: Open docs panel
      if (e.key === 'F1') {
        e.preventDefault();
        useWorkspaceStore.getState().openPanel('docs');
        return;
      }

      if (isInput) return;

      // ? key opens shortcuts panel
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
      }
    },
    [toggleChatOverlay]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
  }, [handleGlobalKeyDown]);

  // --- Compact layout (mobile/tablet) --- unchanged
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

        <ChatOverlay />
        <SceneTransitionOverlay />
        <DialogueOverlay />
        <TutorialOverlay />
        <OnboardingChecklist />
        <WelcomeModal />
        <ShaderEditorPanel />
        <KeyboardShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      </div>
    );
  }

  // --- Desktop layout: Sidebar + Dockview Workspace ---
  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-950">
      {/* Top bar */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-zinc-400">Project Forge</span>
          <SceneToolbar />
        </div>
        <PlayControls />
        <div className="flex items-center gap-3">
          <PanelsMenu />
          <LayoutMenu />
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

      {/* Main area: Sidebar + Dockview */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tool sidebar */}
        <Sidebar />

        {/* Dockview workspace fills remaining space */}
        <div className="flex-1 overflow-hidden">
          <WorkspaceProvider />
        </div>
      </div>

      <ChatOverlay />
      <SceneTransitionOverlay />
      <DialogueOverlay />
      <TutorialOverlay />
      <OnboardingChecklist />
      <WelcomeModal />
      <ShaderEditorPanel />
      <PerformanceProfiler />
      <KeyboardShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
