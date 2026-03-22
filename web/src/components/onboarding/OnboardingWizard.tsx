'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare, LayoutGrid, Plus, Compass, Lock, X } from 'lucide-react';
import { useOnboardingStore, type OnboardingPath } from '@/stores/onboardingStore';
import { useUserStore } from '@/stores/userStore';
import { useChatStore } from '@/stores/chatStore';

export interface OnboardingWizardProps {
  onComplete: () => void;
}

interface PathCard {
  id: OnboardingPath;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClass: string;
  bgClass: string;
  requiresAI?: boolean;
}

const PATH_CARDS: PathCard[] = [
  {
    id: 'ai',
    label: 'Build with AI',
    description: 'Describe your game and AI builds it',
    icon: MessageSquare,
    accentClass: 'border-purple-500',
    bgClass: 'bg-purple-600 group-hover:bg-purple-700',
    requiresAI: true,
  },
  {
    id: 'template',
    label: 'Start from Template',
    description: 'Pick a starter game and customize it',
    icon: LayoutGrid,
    accentClass: 'border-blue-500',
    bgClass: 'bg-blue-600 group-hover:bg-blue-700',
  },
  {
    id: 'blank',
    label: 'Blank Canvas',
    description: 'Start from scratch with an empty scene',
    icon: Plus,
    accentClass: 'border-green-500',
    bgClass: 'bg-green-600 group-hover:bg-green-700',
  },
  {
    id: 'tour',
    label: 'Take a Tour',
    description: 'Learn the editor step by step',
    icon: Compass,
    accentClass: 'border-amber-500',
    bgClass: 'bg-amber-600 group-hover:bg-amber-700',
  },
];

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const selectPath = useOnboardingStore((s) => s.selectPath);
  const completeOnboarding = useOnboardingStore((s) => s.completeOnboarding);
  const startTutorial = useOnboardingStore((s) => s.startTutorial);
  const canUseAI = useUserStore((s) => s.canUseAI);
  const setRightPanelTab = useChatStore((s) => s.setRightPanelTab);

  const [showTemplates, setShowTemplates] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus trap: focus the dialog on mount
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => {
      prev?.focus();
    };
  }, []);

  // Escape dismisses the wizard (goes to blank path)
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        completeOnboarding();
        onComplete();
      }
    },
    [completeOnboarding, onComplete]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [handleEscape]);

  const handleSelectPath = useCallback(
    (path: OnboardingPath) => {
      selectPath(path);

      if (path === 'ai') {
        completeOnboarding();
        setRightPanelTab('chat');
        onComplete();
        return;
      }

      if (path === 'blank') {
        completeOnboarding();
        onComplete();
        return;
      }

      if (path === 'tour') {
        completeOnboarding();
        startTutorial('first-scene');
        onComplete();
        return;
      }

      if (path === 'template') {
        setShowTemplates(true);
        return;
      }
    },
    [selectPath, completeOnboarding, setRightPanelTab, startTutorial, onComplete]
  );

  const handleTemplateChosen = useCallback(
    async (templateId: string) => {
      setLoadingTemplate(templateId);
      try {
        // Templates are loaded via the editor store if available
        // For now, complete onboarding and let the user proceed
        completeOnboarding();
        onComplete();
      } finally {
        setLoadingTemplate(null);
      }
    },
    [completeOnboarding, onComplete]
  );

  const isAIEnabled = canUseAI();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-wizard-title"
      className="fixed inset-0 z-[65] flex items-center justify-center bg-black/70 p-4"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-2xl rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-5">
          <div>
            <h2 id="onboarding-wizard-title" className="text-xl font-bold text-zinc-100">
              Welcome to SpawnForge
            </h2>
            <p className="mt-0.5 text-sm text-zinc-400">
              How would you like to start?
            </p>
          </div>
          <button
            onClick={() => {
              completeOnboarding();
              onComplete();
            }}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Dismiss and start with blank canvas"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {!showTemplates ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {PATH_CARDS.map((card) => {
                const Icon = card.icon;
                const locked = card.requiresAI && !isAIEnabled;

                if (locked) {
                  return (
                    <div
                      key={card.id}
                      data-testid={`path-card-${card.id}`}
                      className="relative flex cursor-not-allowed flex-col rounded-lg border border-zinc-700 bg-zinc-800/50 p-5 opacity-60"
                      aria-disabled="true"
                    >
                      {/* Lock badge */}
                      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-zinc-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-300">
                        <Lock className="h-2.5 w-2.5" />
                        <span>Upgrade</span>
                      </div>

                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-700">
                        <Icon className="h-6 w-6 text-zinc-400" />
                      </div>
                      <h3 className="mb-1 font-semibold text-zinc-300">{card.label}</h3>
                      <p className="text-sm text-zinc-500">{card.description}</p>
                      <a
                        href="/pricing"
                        className="mt-3 text-xs text-purple-400 hover:text-purple-300 hover:underline"
                        aria-label="Upgrade to unlock AI features"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Upgrade to unlock AI
                      </a>
                    </div>
                  );
                }

                return (
                  <button
                    key={card.id}
                    data-testid={`path-card-${card.id}`}
                    onClick={() => handleSelectPath(card.id)}
                    className={`group flex flex-col rounded-lg border border-zinc-700 bg-zinc-800 p-5 text-left transition-all duration-150 hover:${card.accentClass} hover:bg-zinc-750 focus:outline-none focus:ring-2 focus:ring-blue-500`}
                  >
                    <div
                      className={`mb-4 flex h-12 w-12 items-center justify-center rounded-lg transition-colors ${card.bgClass}`}
                    >
                      <Icon className="h-6 w-6 text-white" />
                    </div>
                    <h3 className="mb-1 font-semibold text-zinc-100">{card.label}</h3>
                    <p className="text-sm text-zinc-400">{card.description}</p>
                  </button>
                );
              })}
            </div>
          ) : (
            <TemplateSelector
              onSelect={handleTemplateChosen}
              onBack={() => setShowTemplates(false)}
              loadingId={loadingTemplate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Inline template selector ----

interface TemplateSelectorProps {
  onSelect: (templateId: string) => Promise<void>;
  onBack: () => void;
  loadingId: string | null;
}

interface TemplateOption {
  id: string;
  label: string;
  description: string;
  tags: string[];
}

const TEMPLATES: TemplateOption[] = [
  {
    id: 'platformer',
    label: 'Platformer',
    description: 'Jump, run, collect coins — classic side-scrolling action',
    tags: ['2D', 'beginner'],
  },
  {
    id: 'runner',
    label: 'Runner',
    description: 'Endless runner with obstacles and power-ups',
    tags: ['2D', 'beginner'],
  },
  {
    id: 'shooter',
    label: 'Shooter',
    description: 'Arena shooter with enemies and projectiles',
    tags: ['3D', 'intermediate'],
  },
  {
    id: 'puzzle',
    label: 'Puzzle',
    description: 'Push crates, flip switches, solve levels',
    tags: ['3D', 'beginner'],
  },
  {
    id: 'explorer',
    label: 'Explorer',
    description: 'Open-world adventure and discovery',
    tags: ['3D', 'intermediate'],
  },
];

function TemplateSelector({ onSelect, onBack, loadingId }: TemplateSelectorProps) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-sm text-zinc-400 transition-colors hover:text-zinc-200"
          aria-label="Back to path selection"
        >
          Back
        </button>
        <h3 className="text-sm font-semibold text-zinc-200">Choose a starter template</h3>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            data-testid={`template-card-${tpl.id}`}
            onClick={() => onSelect(tpl.id)}
            disabled={loadingId !== null}
            className="flex flex-col rounded-lg border border-zinc-700 bg-zinc-800 p-4 text-left transition-all duration-150 hover:border-blue-500 hover:bg-zinc-750 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-wait disabled:opacity-60"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold text-zinc-100">{tpl.label}</span>
              <div className="flex gap-1">
                {tpl.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-zinc-700 px-2 py-0.5 text-[10px] font-medium text-zinc-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-xs text-zinc-400">{tpl.description}</p>
            {loadingId === tpl.id && (
              <span className="mt-2 text-xs text-blue-400">Loading...</span>
            )}
          </button>
        ))}
      </div>

      <p className="mt-4 text-center text-xs text-zinc-500">
        All templates are fully customizable. Your game, your rules.
      </p>
    </div>
  );
}
