'use client';

import { useState } from 'react';
import { MousePointerClick, RotateCw, Keyboard } from 'lucide-react';

const STORAGE_KEY = 'forge-welcomed';

function shouldShowWelcome(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return !localStorage.getItem(STORAGE_KEY);
}

export function WelcomeModal() {
  const [visible, setVisible] = useState(shouldShowWelcome);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const handleDismiss = () => {
    setVisible(false);
    if (dontShowAgain) {
      localStorage.setItem(STORAGE_KEY, '1');
    }
  };

  if (!visible) return null;

  return (
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
          <button
            onClick={handleDismiss}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors"
          >
            Get Started
          </button>
        </div>
      </div>
    </div>
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
