'use client';

import { useState, useEffect, useCallback, lazy, Suspense, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { CanvasArea } from './CanvasArea';
import { SceneHierarchy } from './SceneHierarchy';
import { InspectorPanel } from './InspectorPanel';
import { PlayControls } from './PlayControls';
import { SceneToolbar } from './SceneToolbar';
import { LayoutMenu } from './LayoutMenu';
import { PanelsMenu } from './PanelsMenu';
import { TokenBalance } from '../settings/TokenBalance';
import { DrawerPanel } from './DrawerPanel';
import { MobileToolbar } from './MobileToolbar';

// Lazy-load heavy panels that aren't visible on initial render
const ScriptEditorPanel = lazy(() => import('./ScriptEditorPanel').then(m => ({ default: m.ScriptEditorPanel })));
const UIBuilderPanel = lazy(() => import('./UIBuilderPanel').then(m => ({ default: m.UIBuilderPanel })));
const ShaderEditorPanel = lazy(() => import('./ShaderEditorPanel').then(m => ({ default: m.ShaderEditorPanel })));
const ChatPanel = lazy(() => import('../chat/ChatPanel').then(m => ({ default: m.ChatPanel })));
const ModifyPanel = lazy(() => import('./ModifyPanel').then(m => ({ default: m.ModifyPanel })));
const GDDPanel = lazy(() => import('./GDDPanel').then(m => ({ default: m.GDDPanel })));
const WelcomeModal = lazy(() => import('./WelcomeModal').then(m => ({ default: m.WelcomeModal })));
const KeyboardShortcutsPanel = lazy(() => import('./KeyboardShortcutsPanel').then(m => ({ default: m.KeyboardShortcutsPanel })));
const ShortcutCheatSheet = lazy(() => import('./ShortcutCheatSheet').then(m => ({ default: m.ShortcutCheatSheet })));
const FeedbackDialog = lazy(() => import('./FeedbackDialog').then(m => ({ default: m.FeedbackDialog })));
const BehaviorTreePanel = lazy(() => import('./BehaviorTreePanel').then(m => ({ default: m.BehaviorTreePanel })));
const OnboardingWizard = lazy(() => import('../onboarding/OnboardingWizard').then(m => ({ default: m.OnboardingWizard })));

import { WorkspaceProvider } from './WorkspaceProvider';
import { SceneTransitionOverlay } from './SceneTransitionOverlay';
import { DialogueOverlay } from '../game/DialogueOverlay';
import { TutorialOverlay } from './TutorialOverlay';
import { OnboardingChecklist } from './OnboardingChecklist';
import { PerformanceProfiler } from './PerformanceProfiler';
import { GenerationStatus } from './GenerationStatus';
import { HelpMenu } from './HelpMenu';
import { AutoSaveRecovery } from './AutoSaveRecovery';
import { TokenWarningBanner } from './TokenWarningBanner';
import { TokenDepletedModal } from './TokenDepletedModal';
import { Celebration } from '@/components/ui/Celebration';
import { useCelebrations } from '@/hooks/useCelebrations';
import { useChatStore, type RightPanelTab } from '@/stores/chatStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useEditorStore, getCommandDispatcher } from '@/stores/editorStore';
import { useGenerationStore } from '@/stores/generationStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import { useGenerationPolling } from '@/hooks/useGenerationPolling';
import { startAutoSave } from '@/lib/storage/autoSave';
import { UserButton } from '@clerk/nextjs';

// Clerk validates key format — skip rendering Clerk components without a valid key (CI E2E)
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
const hasClerk = clerkKey.startsWith('pk_test_') || clerkKey.startsWith('pk_live_');

const MOBILE_DISMISSED_KEY = 'forge-mobile-dismissed';

// ---- Mobile-only components (unchanged) ----

const ReviewPanel = lazy(() => import('./ReviewPanel').then(m => ({ default: m.ReviewPanel })));

const TAB_ORDER: RightPanelTab[] = ['inspector', 'chat', 'modify', 'script', 'ui', 'gdd', 'review', 'behavior'];


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
        className={`flex-1 px-2 py-2.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
          activeTab === 'inspector'
            ? 'border-b border-blue-500 text-zinc-200'
            : 'text-zinc-400 hover:text-zinc-400'
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
        className={`relative flex-1 px-2 py-2.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
          activeTab === 'chat'
            ? 'border-b border-purple-500 text-zinc-200'
            : 'text-zinc-400 hover:text-zinc-400'
        }`}
      >
        AI Chat
        {hasUnread && activeTab !== 'chat' && (
          <span className="absolute top-1 right-2 h-1.5 w-1.5 rounded-full bg-purple-400 animate-pulse" aria-label="Unread messages" />
        )}
      </button>
      <button
        role="tab"
        id="tab-modify"
        aria-selected={activeTab === 'modify'}
        aria-controls="tabpanel-modify"
        tabIndex={activeTab === 'modify' ? 0 : -1}
        onClick={() => onTabChange('modify')}
        className={`flex-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
          activeTab === 'modify'
            ? 'border-b border-amber-500 text-zinc-200'
            : 'text-zinc-400 hover:text-zinc-400'
        }`}
      >
        Modify
      </button>
      <button
        role="tab"
        id="tab-script"
        aria-selected={activeTab === 'script'}
        aria-controls="tabpanel-script"
        tabIndex={activeTab === 'script' ? 0 : -1}
        onClick={() => onTabChange('script')}
        className={`flex-1 px-2 py-2.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
          activeTab === 'script'
            ? 'border-b border-green-500 text-zinc-200'
            : 'text-zinc-400 hover:text-zinc-400'
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
        className={`flex-1 px-2 py-2.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
          activeTab === 'ui'
            ? 'border-b border-orange-500 text-zinc-200'
            : 'text-zinc-400 hover:text-zinc-400'
        }`}
      >
        UI
      </button>
      <button
        role="tab"
        id="tab-gdd"
        aria-selected={activeTab === 'gdd'}
        aria-controls="tabpanel-gdd"
        tabIndex={activeTab === 'gdd' ? 0 : -1}
        onClick={() => onTabChange('gdd')}
        className={`flex-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
          activeTab === 'gdd'
            ? 'border-b border-amber-500 text-zinc-200'
            : 'text-zinc-400 hover:text-zinc-400'
        }`}
      >
        GDD
      </button>
      <button
        role="tab"
        id="tab-review"
        aria-selected={activeTab === 'review'}
        aria-controls="tabpanel-review"
        tabIndex={activeTab === 'review' ? 0 : -1}
        onClick={() => onTabChange('review')}
        className={`flex-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
          activeTab === 'review'
            ? 'border-b border-yellow-500 text-zinc-200'
            : 'text-zinc-400 hover:text-zinc-400'
        }`}
      >
        Review
      </button>
      <button
        role="tab"
        id="tab-behavior"
        aria-selected={activeTab === 'behavior'}
        aria-controls="tabpanel-behavior"
        tabIndex={activeTab === 'behavior' ? 0 : -1}
        onClick={() => onTabChange('behavior')}
        className={`flex-1 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider transition-colors ${
          activeTab === 'behavior'
            ? 'border-b border-teal-500 text-zinc-200'
            : 'text-zinc-400 hover:text-zinc-400'
        }`}
      >
        AI NPC

      </button>
    </div>
  );
}

function RightPanelContent({ activeTab }: { activeTab: RightPanelTab }) {
  return (
    <div role="tabpanel" id={`tabpanel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
      {activeTab === 'inspector' && <InspectorPanel />}
      <Suspense fallback={<div className="p-4 text-zinc-400">Loading...</div>}>
        {activeTab === 'script' && <ScriptEditorPanel />}
        {activeTab === 'ui' && <UIBuilderPanel />}
        {activeTab === 'chat' && <ChatPanel />}
        {activeTab === 'modify' && <ModifyPanel />}
        {activeTab === 'gdd' && <GDDPanel />}
        {activeTab === 'review' && <ReviewPanel />}
        {activeTab === 'behavior' && <BehaviorTreePanel />}

      </Suspense>
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
      <button onClick={handleDismiss} aria-label="Dismiss banner" className="shrink-0 flex items-center justify-center rounded h-8 w-8 hover:bg-amber-800">
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
            className="rounded p-0.5 text-zinc-400 hover:text-zinc-300"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<div className="p-4 text-zinc-400">Loading chat...</div>}>
            <ChatPanel />
          </Suspense>
        </div>
      </div>
    </>
  );
}

// ---- Onboarding gate ----
// No-op subscribe — localStorage doesn't fire events in the same tab
const noopSubscribe = () => () => {};

const LEGACY_QUICKSTART_KEY = 'forge-quickstart-completed';
const LEGACY_WELCOME_KEY = 'forge-welcomed';
const ONBOARDING_COMPLETED_KEY = 'forge-onboarding-completed';

/**
 * Shows the new OnboardingWizard for brand-new users.
 * Falls back to WelcomeModal for users who completed the legacy quickstart/welcome flow.
 * Users with any legacy key (forge-quickstart-completed, forge-welcomed) are treated as
 * returning users and never shown the new wizard.
 */
function OnboardingGate() {
  const onboardingCompleted = useOnboardingStore((s) => s.onboardingCompleted);
  const isNewUser = useOnboardingStore((s) => s.isNewUser);
  const completeOnboarding = useOnboardingStore((s) => s.completeOnboarding);

  // Check legacy localStorage keys (old quickstart/welcome flows)
  const legacyDone = useSyncExternalStore(
    noopSubscribe,
    () =>
      !!localStorage.getItem(LEGACY_QUICKSTART_KEY) ||
      !!localStorage.getItem(LEGACY_WELCOME_KEY),
    () => true, // SSR: treat as done to avoid hydration mismatch
  );

  // Check if new onboarding was completed (separate from legacy)
  const onboardingDone = useSyncExternalStore(
    noopSubscribe,
    () => !!localStorage.getItem(ONBOARDING_COMPLETED_KEY),
    () => false,
  );

  const [wizardDismissed, setWizardDismissed] = useState(false);

  const handleWizardComplete = useCallback(() => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, '1');
    completeOnboarding();
    setWizardDismissed(true);
  }, [completeOnboarding]);

  // New onboarding completed — no modals needed
  if (onboardingDone || onboardingCompleted || wizardDismissed) {
    return null;
  }

  // Legacy users who already completed the old welcome flow — no overlay needed.
  // WelcomeModal's internal useSyncExternalStore checks !forge-welcomed, so
  // rendering it here (when forge-welcomed IS set) would always be a no-op anyway.
  if (legacyDone) {
    return null;
  }

  // True first-time users (isNewUser=true in persisted Zustand store) → wizard
  if (isNewUser) {
    return <OnboardingWizard onComplete={handleWizardComplete} />;
  }

  // Returning users who don't have any legacy key (cleared storage after the wizard
  // or bypassed it) → WelcomeModal as the lightweight fallback welcome experience
  return <WelcomeModal />;
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

  // Milestone celebrations
  const { activeCelebration, dismissCelebration } = useCelebrations();

  // Hydrate generation jobs from server on mount
  useEffect(() => {
    hydrateFromServer();
  }, [hydrateFromServer]);

  // Drawer state for compact mode
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);
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

      if (isInput) return;

      // Alt+T: Toggle Tasks panel (avoid Ctrl+Shift+T — browser-reserved for reopen tab)
      if (e.code === 'KeyT' && e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const ws = useWorkspaceStore.getState();
        const existing = ws.api?.getPanel('taskboard');
        if (existing) {
          // If panel exists but is in a background tab, activate it first.
          // Only close if it's already the active/visible panel.
          if (!existing.api.isActive) {
            existing.api.setActive();
          } else {
            existing.api.close();
          }
        } else {
          ws.openPanel('taskboard');
        }
        return;
      }

      // ? key opens cheat sheet overlay — but not when another dialog is already open
      if (e.key === '?') {
        e.preventDefault();
        setCheatSheetOpen((prev) => {
          // If already open, always allow closing
          if (prev) return false;
          // If a modal dialog is open, don't stack the cheat sheet on top.
          // Uses aria-modal to distinguish true modals from drawers/sheets.
          const hasOpenModal = document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
          if (hasOpenModal) return false;
          return true;
        });
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
      // Expose command dispatcher for agent viewport integration (E2E/dev only).
      // SECURITY: This is gated behind NODE_ENV !== 'production' so it is never
      // accessible in production builds. A2: TypeScript global declaration is in
      // web/src/types/forge-globals.d.ts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__FORGE_DISPATCH = (cmd: string, payload: Record<string, unknown>) => {
        const dispatcher = getCommandDispatcher();
        if (dispatcher) {
          dispatcher(cmd, payload);
          return true;
        }
        return false;
      };
    }
  }, []);

  // Periodic IndexedDB auto-save (every 30 s)
  useEffect(() => {
    const handle = startAutoSave(
      () => {
        const s = useEditorStore.getState();
        return {
          projectId: s.projectId,
          sceneName: s.sceneName,
          sceneModified: s.sceneModified,
          autoSaveEnabled: s.autoSaveEnabled,
        };
      },
      () => {
        const dispatcher = getCommandDispatcher();
        if (dispatcher) dispatcher('save_scene', {});
      },
    );
    return () => handle.stop();
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
                <span className="truncate text-[10px] text-zinc-400">{sceneName}</span>
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

        <AutoSaveRecovery />
        <ChatOverlay />
        <SceneTransitionOverlay />
        <DialogueOverlay />
        <TutorialOverlay />
        <OnboardingChecklist />
        <TokenDepletedModal />
        <Suspense fallback={null}>
          <OnboardingGate />
          <ShaderEditorPanel />
          <KeyboardShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
          <ShortcutCheatSheet open={cheatSheetOpen} onClose={() => setCheatSheetOpen(false)} />
          <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
        </Suspense>
        {activeCelebration && (
          <Celebration
            key={activeCelebration.id}
            title={activeCelebration.title}
            message={activeCelebration.message}
            onDismiss={dismissCelebration}
          />
        )}
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
          <span className="max-w-[200px] truncate text-xs text-zinc-400" title={sceneName}>
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
          {hasClerk && <UserButton />}
        </div>
      </div>

      <TokenWarningBanner />

      {/* Main area: Sidebar + Dockview */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tool sidebar */}
        <Sidebar />

        {/* Dockview workspace fills remaining space */}
        <div className="flex-1 overflow-hidden">
          <WorkspaceProvider />
        </div>
      </div>

      <AutoSaveRecovery />
      <ChatOverlay />
      <SceneTransitionOverlay />
      <DialogueOverlay />
      <TutorialOverlay />
      <OnboardingChecklist />
      <TokenDepletedModal />
      <Suspense fallback={null}>
        <OnboardingGate />
        <ShaderEditorPanel />
        <KeyboardShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <ShortcutCheatSheet open={cheatSheetOpen} onClose={() => setCheatSheetOpen(false)} />
        <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
      </Suspense>
      <PerformanceProfiler />
      {activeCelebration && (
        <Celebration
          key={activeCelebration.id}
          title={activeCelebration.title}
          message={activeCelebration.message}
          onDismiss={dismissCelebration}
        />
      )}
    </div>
  );
}
