'use client';

import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { MousePointerClick, RotateCw, Keyboard, Sparkles, BookOpen, GraduationCap, Clock } from 'lucide-react';
import { TemplateGallery } from './TemplateGallery';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { getRecentProjects } from '@/lib/workspace/recentProjects';

const STORAGE_KEY = 'forge-welcomed';

// No-op subscribe — localStorage doesn't fire events in same tab
const noop = () => () => {};

export function WelcomeModal() {
  // useSyncExternalStore: server returns false (no modal in SSR HTML),
  // client returns true if not yet welcomed — React handles the transition after hydration
  const shouldShow = useSyncExternalStore(
    noop,
    () => !localStorage.getItem(STORAGE_KEY),
    () => false,
  );
  const [dismissed, setDismissed] = useState(false);
  const visible = shouldShow && !dismissed;
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const navigateDocs = useWorkspaceStore((s) => s.navigateDocs);
  const startTutorial = useOnboardingStore((s) => s.startTutorial);

  // Load recent projects once on mount (useState lazy init avoids referential instability
  // that useSyncExternalStore would cause with array snapshots — Object.is([], []) is false).
  // Security: filter out entries with IDs that don't match the expected format to prevent
  // stored XSS via malicious project records in localStorage (CodeQL js/xss-through-dom).
  const [recentProjects] = useState(() =>
    getRecentProjects()
      .filter((p) => /^[\w-]+$/.test(p.id))
      .slice(0, 5),
  );

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    if (dontShowAgain) {
      localStorage.setItem(STORAGE_KEY, '1');
    }
  }, [dontShowAgain]);

  const handleTemplateClose = useCallback(() => {
    setShowTemplates(false);
    handleDismiss();
  }, [handleDismiss]);

  const handleOpenDocs = useCallback(() => {
    navigateDocs('getting-started/editor-overview');
    handleDismiss();
  }, [navigateDocs, handleDismiss]);

  const handleStartTutorial = useCallback(() => {
    startTutorial('first-scene');
    handleDismiss();
  }, [startTutorial, handleDismiss]);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus trap: cycle Tab within the dialog
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleDismiss();
        return;
      }
      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
    [handleDismiss]
  );

  // Auto-focus the dialog when it becomes visible
  useEffect(() => {
    if (visible && dialogRef.current) {
      requestAnimationFrame(() => {
        dialogRef.current?.focus();
      });
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="welcome-modal-title"
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          className="mx-4 w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-2xl focus:outline-none"
        >
          <h2 id="welcome-modal-title" className="mb-1 text-lg font-semibold text-zinc-100">
            Welcome to SpawnForge
          </h2>
          <p className="mb-5 text-sm text-zinc-400">
            A 3D game editor in your browser. Here are some quick tips to get started:
          </p>

          <div className="mb-5 space-y-3">
            <Tip
              icon={MousePointerClick}
              text="Click objects to select them. Use W / E / R for Move, Rotate, and Scale."
            />
            <Tip
              icon={RotateCw}
              text="Right-click for context menu. Add entities from the + button in the sidebar."
            />
            <Tip
              icon={Keyboard}
              text="Press ? at any time to see all keyboard shortcuts."
            />
            <Tip
              icon={BookOpen}
              text="Press F1 to open the documentation browser, or click help buttons in inspector panels."
            />
          </div>

          {/* Recent projects */}
          {recentProjects.length > 0 && (
            <div className="mb-3 rounded border border-zinc-700 bg-zinc-800/50 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Clock size={14} className="text-zinc-400" />
                <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Recent Projects</h3>
              </div>
              <div className="space-y-1">
                {recentProjects.map((p) => (
                  <a
                    key={p.id}
                    href={`/editor/${p.id}`}
                    className="flex items-center justify-between rounded px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700/50 transition-colors"
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="ml-2 shrink-0 text-[10px] text-zinc-600">
                      {formatRelativeTime(p.openedAt)}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Tutorial section */}
          <div className="mb-3 rounded border border-blue-700/50 bg-blue-900/20 p-4">
            <div className="mb-2 flex items-center gap-2">
              <GraduationCap size={16} className="text-blue-400" />
              <h3 className="text-sm font-semibold text-zinc-200">First Time Here?</h3>
            </div>
            <p className="mb-3 text-xs text-zinc-400">
              Take a 3-minute guided tutorial to learn the basics of building 3D scenes.
            </p>
            <button
              onClick={handleStartTutorial}
              className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
            >
              Start Tutorial
            </button>
          </div>

          {/* Template selection section */}
          <div className="mb-5 rounded border border-zinc-700 bg-zinc-800/50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={16} className="text-purple-400" />
              <h3 className="text-sm font-semibold text-zinc-200">Start from a Template</h3>
            </div>
            <p className="mb-3 text-xs text-zinc-400">
              Choose from pre-built game templates with complete mechanics, or start with a blank project.
            </p>
            <button
              onClick={() => setShowTemplates(true)}
              className="w-full rounded bg-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-600 transition-colors"
            >
              Browse Templates
            </button>
          </div>

          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-zinc-500">
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
                className="rounded border-zinc-600 bg-zinc-800"
              />
              Don&apos;t show again
            </label>
            <div className="flex gap-2">
              <button
                onClick={handleOpenDocs}
                className="flex items-center gap-1 rounded bg-blue-900/30 px-3 py-1.5 text-sm font-medium text-blue-400 hover:bg-blue-900/50 transition-colors"
              >
                <BookOpen size={14} />
                Docs
              </button>
              <button
                onClick={handleDismiss}
                className="rounded bg-zinc-700 px-4 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-600 transition-colors"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Template Gallery Modal */}
      <TemplateGallery isOpen={showTemplates} onClose={handleTemplateClose} />
    </>
  );
}

function formatRelativeTime(ts: number): string {
  const diffMin = Math.round((Date.now() - ts) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  return `${Math.round(diffD / 30)}mo ago`;
}

function Tip({ icon: Icon, text }: { icon: typeof MousePointerClick; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-zinc-800">
        <Icon size={16} className="text-blue-400" />
      </div>
      <p className="text-sm text-zinc-300">{text}</p>
    </div>
  );
}
