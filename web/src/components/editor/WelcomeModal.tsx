'use client';

import { useState, useSyncExternalStore } from 'react';
import { MousePointerClick, RotateCw, Keyboard, Sparkles, BookOpen } from 'lucide-react';
import { TemplateGallery } from './TemplateGallery';
import { useWorkspaceStore } from '@/stores/workspaceStore';

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

  const handleDismiss = () => {
    setDismissed(true);
    if (dontShowAgain) {
      localStorage.setItem(STORAGE_KEY, '1');
    }
  };

  const handleTemplateClose = () => {
    setShowTemplates(false);
    handleDismiss();
  };

  const handleOpenDocs = () => {
    navigateDocs('getting-started/editor-overview');
    handleDismiss();
  };

  if (!visible) return null;

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
        <div className="mx-4 w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
          <h2 className="mb-1 text-lg font-semibold text-zinc-100">
            Welcome to Project Forge
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

          {/* Template selection section */}
          <div className="mb-5 rounded border border-zinc-700 bg-zinc-800/50 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles size={16} className="text-blue-400" />
              <h3 className="text-sm font-semibold text-zinc-200">Start from a Template</h3>
            </div>
            <p className="mb-3 text-xs text-zinc-400">
              Choose from pre-built game templates with complete mechanics, or start with a blank project.
            </p>
            <button
              onClick={() => setShowTemplates(true)}
              className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
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
