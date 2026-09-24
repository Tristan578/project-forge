'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare, LayoutGrid, Plus, Compass, Lock, X } from 'lucide-react';
import { useOnboardingStore, type OnboardingPath } from '@/stores/onboardingStore';
import { useUserStore } from '@/stores/userStore';
import { useChatStore } from '@/stores/chatStore';
import { useEditorStore } from '@/stores/editorStore';
import type { TemplateLoadResult } from '@/stores/slices/sceneSlice';
import { trackEvent, AnalyticsEvent } from '@/lib/analytics/posthog';
import { TEMPLATE_REGISTRY } from '@/data/templates';
import { offerCustomizeWithAi } from '@/lib/chat/customizeWithAi';

export interface OnboardingWizardProps {
  onComplete: () => void;
  /**
   * Opens the quick-start dialog (PF-1215). The "Build with AI" path used to do
   * nothing but switch the right panel to chat and hope the user typed something
   * the intent classifier recognised; it now hands the user the real control.
   * Optional so the wizard still renders standalone in tests and stories.
   */
  onStartAi?: () => void;
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

/** Shown when `loadTemplate` throws rather than reporting a failure. */
const GENERIC_TEMPLATE_ERROR = 'Could not load that template. Please try again.';

export function OnboardingWizard({ onComplete, onStartAi }: OnboardingWizardProps) {
  const selectPath = useOnboardingStore((s) => s.selectPath);
  const completeOnboarding = useOnboardingStore((s) => s.completeOnboarding);
  const startTutorial = useOnboardingStore((s) => s.startTutorial);
  // Select the RESULT, not the function. `canUseAI` is a stable store action,
  // so selecting it never re-rendered the wizard when `tier`, `activeFeatures`
  // or `profileLoaded` changed; the profile arrives in an EditorLayout effect
  // AFTER the render that mounts this wizard, so a paying user saw the locked
  // "Upgrade to unlock AI" card until some unrelated re-render (#10156).
  // Zustand compares the selected boolean, so this re-renders exactly when the
  // verdict flips.
  const isAIEnabled = useUserStore((s) => s.canUseAI());
  const profileLoaded = useUserStore((s) => s.profileLoaded);
  const setRightPanelTab = useChatStore((s) => s.setRightPanelTab);

  const [showTemplates, setShowTemplates] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // A template load is asynchronous and the store does not cancel it, so a
  // result can land after the user has left this screen. Two guards: every
  // exit (Back, Escape, the X) is inert while a load is pending, and a result
  // that arrives after unmount is dropped rather than completing onboarding a
  // second time on top of whatever path replaced it.
  const templateLoading = loadingTemplate !== null;
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
        if (templateLoading) return;
        completeOnboarding();
        onComplete();
      }
    },
    [completeOnboarding, onComplete, templateLoading]
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
        onStartAi?.();
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
    [selectPath, completeOnboarding, setRightPanelTab, startTutorial, onComplete, onStartAi]
  );

  // Load the chosen template through the store, and complete onboarding only
  // once it has landed. This used to be a no-op that completed onboarding and
  // returned: a user who picked "Platformer" got a blank scene (#10156).
  //
  // Ordering matters: `completeOnboarding()` makes OnboardingGate unmount this
  // wizard, so it must come AFTER the load settles or a failure has nowhere to
  // show. On failure the wizard stays up, says what went wrong, and re-enables
  // the cards. The analytics pair mirrors TemplateGallery, with this surface
  // as the source.
  const handleTemplateChosen = useCallback(
    async (templateId: string) => {
      setLoadingTemplate(templateId);
      setTemplateError(null);
      let result: TemplateLoadResult;
      try {
        result = await useEditorStore.getState().loadTemplate(templateId);
      } catch {
        result = { success: false, error: GENERIC_TEMPLATE_ERROR };
      }
      if (!mountedRef.current) return;
      setLoadingTemplate(null);
      if (!result.success) {
        setTemplateError(result.error);
        return;
      }
      // Offer to make the starter theirs via a pre-filled chat draft (#10172).
      // Only on success: a failed load has nothing to customise.
      offerCustomizeWithAi(TEMPLATE_REGISTRY.find((t) => t.id === templateId)?.name ?? templateId);

      trackEvent(AnalyticsEvent.TEMPLATE_USED, { templateId });
      trackEvent(AnalyticsEvent.TEMPLATE_APPLIED, { templateId, source: 'onboarding' });
      completeOnboarding();
      onComplete();
    },
    [completeOnboarding, onComplete]
  );

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
            disabled={templateLoading}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-wait disabled:opacity-50 disabled:hover:bg-transparent"
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

                // Until the profile has resolved the verdict is unknown: the
                // store starts at tier 'starter', so rendering the locked card
                // here would be a false upsell for a paying user, and an
                // enabled button would be a false offer for a starter. Neither
                // the link nor the button, until the answer is in.
                if (card.requiresAI && !profileLoaded) {
                  return (
                    <div
                      key={card.id}
                      data-testid={`path-card-${card.id}`}
                      className="relative flex flex-col rounded-lg border border-zinc-700 bg-zinc-800/50 p-5 opacity-60"
                      aria-busy="true"
                      aria-disabled="true"
                    >
                      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-zinc-700">
                        <Icon className="h-6 w-6 text-zinc-400" />
                      </div>
                      <h3 className="mb-1 font-semibold text-zinc-300">{card.label}</h3>
                      <p className="text-sm text-zinc-500">{card.description}</p>
                      <p className="mt-3 text-xs text-zinc-500">Checking your plan…</p>
                    </div>
                  );
                }

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
              onBack={() => {
                setShowTemplates(false);
                // A stale error must not greet the user when the selector is
                // reopened; it described a load that is no longer on screen.
                setTemplateError(null);
              }}
              loadingId={loadingTemplate}
              error={templateError}
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
  /** The last failed load's message; cleared when a new load starts. */
  error: string | null;
}

interface TemplateOption {
  id: string;
  label: string;
  description: string;
  /** Difficulty only. The 2D/3D tag is read from the registry, see below. */
  level: string;
}

const TEMPLATES: TemplateOption[] = [
  {
    id: 'platformer',
    label: 'Platformer',
    description: 'Jump, run, collect coins — classic side-scrolling action',
    level: 'beginner',
  },
  {
    id: 'runner',
    label: 'Runner',
    description: 'Endless runner with obstacles and power-ups',
    level: 'beginner',
  },
  {
    id: 'shooter',
    label: 'Shooter',
    description: 'Arena shooter with enemies and projectiles',
    level: 'intermediate',
  },
  {
    id: 'puzzle',
    label: 'Puzzle',
    description: 'Push crates, flip switches, solve levels',
    level: 'beginner',
  },
  {
    id: 'explorer',
    label: 'Explorer',
    description: 'Open-world adventure and discovery',
    level: 'intermediate',
  },
];

/**
 * The dimension tag comes from the registry entry the id resolves to, never
 * from a literal here: `platformer` and `runner` were hand-tagged '2D' while
 * the registry lists them as 3D games (#10156). A template the registry does
 * not know gets no dimension tag rather than a guessed one.
 */
export function templateDimension(templateId: string): '2D' | '3D' | null {
  const tags = TEMPLATE_REGISTRY.find((entry) => entry.id === templateId)?.tags ?? [];
  if (tags.includes('3d')) return '3D';
  if (tags.includes('2d')) return '2D';
  return null;
}

function TemplateSelector({ onSelect, onBack, loadingId, error }: TemplateSelectorProps) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={onBack}
          disabled={loadingId !== null}
          className="text-sm text-zinc-400 transition-colors hover:text-zinc-200 disabled:cursor-wait disabled:opacity-50"
          aria-label="Back to path selection"
        >
          Back
        </button>
        <h3 className="text-sm font-semibold text-zinc-200">Choose a starter template</h3>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-red-500/60 bg-red-500/10 px-3 py-2 text-xs text-red-200"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {TEMPLATES.map((tpl) => {
          const tags = [templateDimension(tpl.id), tpl.level].filter((t): t is string => t !== null);
          return (
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
                  {tags.map((tag) => (
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
          );
        })}
      </div>

      <p className="mt-4 text-center text-xs text-zinc-500">
        All templates are fully customizable. Your game, your rules.
      </p>
    </div>
  );
}
