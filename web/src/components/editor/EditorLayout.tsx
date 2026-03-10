'use client';

import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
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
import { FeedbackDialog } from './FeedbackDialog';
import { WorkspaceProvider } from './WorkspaceProvider';
import { SceneTransitionOverlay } from './SceneTransitionOverlay';
import { DialogueOverlay } from '../game/DialogueOverlay';
import { TutorialOverlay } from './TutorialOverlay';
import { OnboardingChecklist } from './OnboardingChecklist';
import { PerformanceProfiler } from './PerformanceProfiler';
import { GenerationStatus } from './GenerationStatus';
import { HelpMenu } from './HelpMenu';
import { useChatStore, type RightPanelTab } from '@/stores/chatStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useEditorStore } from '@/stores/editorStore';
import { useGenerationStore } from '@/stores/generationStore';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { useGenerationPolling } from '@/hooks/useGenerationPolling';
import { UserButton } from '@clerk/nextjs';

// Clerk validates key format — skip rendering Clerk components without a valid key (CI E2E)
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
const hasClerk = clerkKey.startsWith('pk_test_') || clerkKey.startsWith('pk_live_');

const MOBILE_DISMISSED_KEY = 'forge-mobile-dismissed';

// ---- Mobile-only components (unchanged) ----

const TAB_ORDER: RightPanelTab[] = ['inspector', 'chat', 'script', 'ui'];

function RightPanelTabs({ activeTab, onTabChange }: { activeTab: RightPanelTab; onTabChange: (tab: RightPanelTab) => void }) {
  const hasUnread = useChatStore((s) => s.hasUnreadMessages);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const idx = TAB_ORDER.indexOf(activeTab);
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        onTabChange(TAB_ORDER[(idx + 1) % TAB_ORDER.length]);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        onTabChange(TAB_ORDER[(idx - 1 + TAB_ORDER.length) % TAB_ORDER.length]);
      } else if (e.key === 'Home') {
        e.preventDefault();
        onTabChange(TAB_ORDER[0]);
      } else if (e.key === 'End') {
        e.preventDefault();
        onTabChange(TAB_ORDER[TAB_ORDER.length - 1]);
      }
    },
    [activeTab, onTabChange]
  );

  return (
    <div role="tablist" aria-label="Right panel tabs" className="flex border-b border-zinc-800" onKeyDown={handleKeyDown}>
      <button
        role="tab"
        id="tab-inspector"
        aria-selected={activeTab === 'inspector'}
        aria-controls="tabpanel-inspector"
        tabIndex={activeTab === 'inspector' ? 0 : -1}
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
        role="tab"
        id="tab-chat"
        aria-selected={activeTab === 'chat'}
        aria-controls="tabpanel-chat"
        tabIndex={activeTab === 'chat' ? 0 : -1}
        onClick={() => onTabChange('chat')}
        className={`relative flex-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
          activeTab === 'chat'
            ? 'border-b border-purple-500 text-zinc-200'
            : 'text-zinc-600 hover:text-zinc-400'
        }`}
      >
        AI Chat
        {hasUnread && activeTab !== 'chat' && (
          <span className="absolute top-1 right-2 h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" aria-label="Unread messages" />
        )}
      </button>
      <button
        role="tab"
        id="tab-script"
        aria-selected={activeTab === 'script'}
        aria-controls="tabpanel-script"
        tabIndex={activeTab === 'script' ? 0 : -1}
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
        role="tab"
        id="tab-ui"
        aria-selected={activeTab === 'ui'}
        aria-controls="tabpanel-ui"
        tabIndex={activeTab === 'ui' ? 0 : -1}
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
  return (
    <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
      {activeTab === 'inspector' && <InspectorPanel />}
      {activeTab === 'script' && <ScriptEditorPanel />}
      {activeTab === 'ui' && <UIBuilderPanel />}
      {activeTab === 'chat' && <ChatPanel />}
    </div>
  );
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
      <span className="flex-1">SpawnForge is optimized for desktop browsers. Some features may be limited on mobile.</span>
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

  // Close on Escape key
  useEffect(() => {
    if (!chatOverlayOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setChatOverlayOpen(false);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [chatOverlayOpen, setChatOverlayOpen]);

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
  const sceneName = useEditorStore((s) => s.sceneName);
  const hydrateFromServer = useGenerationStore((s) => s.hydrateFromServer);
  const layout = useResponsiveLayout();

  // Start generation job polling
  useGenerationPolling();

  // Hydrate generation jobs from server on mount
  useEffect(() => {
    hydrateFromServer();
  }, [hydrateFromServer]);

  // Drawer state for compact mode
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

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

      // Ctrl+Shift+T / Cmd+Shift+T: Toggle Tasks panel
      if (e.key === 't' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault();
        useWorkspaceStore.getState().openPanel('taskboard');
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

  // Signal that React has hydrated and event handlers are attached (used by E2E tests).
  // Also expose the Zustand store on window for E2E tests to read/manipulate state.
  // This MUST happen here (not as a module-level side effect in editorStore.ts) because
  // Next.js evaluates modules during SSR where `typeof window === 'undefined'`, and
  // client-side module evaluation timing is unreliable relative to React hydration.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__REACT_HYDRATED = true;
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__EDITOR_STORE = useEditorStore;
    }
  }, []);

  // --- Compact layout (mobile/tablet) --- unchanged
  if (layout.mode === 'compact') {
    return (
      <div className="relative h-screen w-screen bg-zinc-950">
        {/* Top bar - simplified */}
        <div className="flex h-8 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="shrink-0 text-xs font-semibold text-zinc-400">SpawnForge</span>
            {sceneName !== 'Untitled' && (
              <>
                <span className="text-zinc-700">/</span>
                <span className="truncate text-[10px] text-zinc-500">{sceneName}</span>
              </>
            )}
          </div>
          <PlayControls />
          <HelpMenu onOpenShortcuts={() => setShortcutsOpen(true)} onOpenFeedback={() => setFeedbackOpen(true)} />
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
        <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      </div>
    );
  }

  // --- Desktop layout: Sidebar + Dockview Workspace ---
  return (
    <div className="flex h-screen w-screen flex-col bg-zinc-950">
      {/* Top bar */}
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-zinc-400">SpawnForge</span>
          <div className="h-3 w-px bg-zinc-700" />
          <span className="max-w-[200px] truncate text-xs text-zinc-500" title={sceneName}>
            {sceneName}
          </span>
          <SceneToolbar />
        </div>
        <div className="flex items-center gap-2">
          <PlayControls />
          <GenerationStatus />
        </div>
        <div className="flex items-center gap-3">
          <PanelsMenu />
          <LayoutMenu />
          <HelpMenu onOpenShortcuts={() => setShortcutsOpen(true)} onOpenFeedback={() => setFeedbackOpen(true)} />
          <TokenBalance />
          {hasClerk && <UserButton afterSignOutUrl="/sign-in" />}
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
        <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}
