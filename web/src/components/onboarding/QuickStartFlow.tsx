'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Gamepad2, Crosshair, Puzzle, Compass, Sparkles, Play, X, ArrowLeft, Loader2 } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';

const STORAGE_KEY = 'forge-quickstart-completed';

export type QuickStartGameType = 'platformer' | 'shooter' | 'puzzle' | 'explorer';

interface GameTypeCard {
  id: QuickStartGameType;
  label: string;
  description: string;
  gradient: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
  templateId: string;
  placeholder: string;
}

const GAME_TYPE_CARDS: GameTypeCard[] = [
  {
    id: 'platformer',
    label: 'Platformer',
    description: 'Jump, run, collect coins',
    gradient: 'linear-gradient(135deg, #22c55e, #059669)',
    icon: Gamepad2,
    accentColor: '#22c55e',
    templateId: 'platformer',
    placeholder: 'A jungle platformer where the player collects gems to unlock a golden door',
  },
  {
    id: 'shooter',
    label: 'Shooter',
    description: 'Aim, shoot, destroy targets',
    gradient: 'linear-gradient(135deg, #ef4444, #b91c1c)',
    icon: Crosshair,
    accentColor: '#ef4444',
    templateId: 'shooter',
    placeholder: 'A sci-fi arena where robots shoot back and drop power-ups',
  },
  {
    id: 'puzzle',
    label: 'Puzzle',
    description: 'Think, solve, advance levels',
    gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
    icon: Puzzle,
    accentColor: '#8b5cf6',
    templateId: 'puzzle',
    placeholder: 'Push crates onto switches to open doors in a haunted mansion',
  },
  {
    id: 'explorer',
    label: 'Explorer',
    description: 'Wander, discover, experience',
    gradient: 'linear-gradient(135deg, #06b6d4, #0891b2)',
    icon: Compass,
    accentColor: '#06b6d4',
    templateId: 'explorer',
    placeholder: 'A peaceful forest walk where you find glowing crystals and hidden messages',
  },
];

export interface QuickStartFlowProps {
  onComplete: () => void;
  onSkip: () => void;
}

type FlowStep = 1 | 2 | 3;

export function QuickStartFlow({ onComplete, onSkip }: QuickStartFlowProps) {
  const [step, setStep] = useState<FlowStep>(1);
  const [selectedType, setSelectedType] = useState<QuickStartGameType | null>(null);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const startDecomposition = useEditorStore((s) => s.startDecomposition);
  const setEngineMode = useEditorStore((s) => s.setEngineMode);

  const selectedCard = GAME_TYPE_CARDS.find((c) => c.id === selectedType) ?? null;

  const handleSelectType = useCallback((type: QuickStartGameType) => {
    setSelectedType(type);
    setGenerateError(null);
    const card = GAME_TYPE_CARDS.find((c) => c.id === type);
    if (card) setPrompt(card.placeholder);
    setStep(2);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!selectedType || isGenerating) return;
    const card = GAME_TYPE_CARDS.find((c) => c.id === selectedType);
    if (!card) return;

    setIsGenerating(true);
    setGenerateError(null);
    try {
      // Build full prompt: "{card label}: {user prompt}"
      const fullPrompt = prompt.trim() || card.placeholder;
      const gamePrompt = `${card.label}: ${fullPrompt}`;

      // Start the game creation pipeline (decompose -> plan -> approve -> execute)
      // startDecomposition handles errors internally (sets orchestratorStatus to 'failed')
      // so we must check store state after the await to detect failures.
      await startDecomposition(gamePrompt, '3d');

      // Read fresh state imperatively — React hook values are stale inside callbacks
      const { orchestratorStatus: status, orchestratorError: error } = useEditorStore.getState();
      if (status === 'failed') {
        throw new Error(error ?? 'Failed to create game. Please try again.');
      }

      setIsReady(true);
      setStep(3);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create game. Please try again.';
      setGenerateError(message);
    } finally {
      setIsGenerating(false);
    }
  }, [selectedType, isGenerating, prompt, startDecomposition]);

  const handlePlay = useCallback(() => {
    setEngineMode('play');
    localStorage.setItem(STORAGE_KEY, '1');
    onComplete();
  }, [setEngineMode, onComplete]);

  const handleSkipWithStorage = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, '1');
    onSkip();
  }, [onSkip]);

  const handleBack = useCallback(() => {
    if (step === 2) {
      setStep(1);
      setSelectedType(null);
      setPrompt('');
    } else if (step === 3) {
      setStep(2);
      setIsReady(false);
    }
  }, [step]);

  // Auto-focus textarea when reaching step 2
  useEffect(() => {
    if (step === 2 && inputRef.current) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [step]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quickstart-title"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
    >
      <div className="w-full max-w-2xl rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div className="flex items-center gap-3">
            {step > 1 && (
              <button
                onClick={handleBack}
                className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <div>
              <h2 id="quickstart-title" className="text-base font-semibold text-zinc-100">
                {step === 1 && 'What kind of game?'}
                {step === 2 && 'Describe your game'}
                {step === 3 && 'Your game is ready!'}
              </h2>
              <p className="text-xs text-zinc-400">
                Step {step} of 3 — less than 60 seconds to a playable game
              </p>
            </div>
          </div>
          <button
            onClick={handleSkipWithStorage}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
            aria-label="Skip quickstart"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step progress */}
        <div className="flex h-1 bg-zinc-800">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${(step / 3) * 100}%` }}
          />
        </div>

        {/* Step content */}
        <div className="p-6">
          {step === 1 && (
            <div className="grid grid-cols-2 gap-3">
              {GAME_TYPE_CARDS.map((card) => {
                const Icon = card.icon;
                return (
                  <button
                    key={card.id}
                    onClick={() => handleSelectType(card.id)}
                    className="group relative overflow-hidden rounded-lg border border-zinc-700 p-5 text-left transition-all duration-150 hover:border-zinc-500 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    style={{ background: card.gradient }}
                  >
                    <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-black/30">
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                    <h3 className="mb-1 text-base font-semibold text-white">{card.label}</h3>
                    <p className="text-xs text-white/70">{card.description}</p>
                  </button>
                );
              })}
            </div>
          )}

          {step === 2 && selectedCard && (
            <div className="space-y-4">
              {/* Selected type badge */}
              <div className="flex items-center gap-2">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-md"
                  style={{ background: selectedCard.gradient }}
                >
                  <selectedCard.icon className="h-4 w-4 text-white" />
                </div>
                <span className="text-sm font-medium text-zinc-200">{selectedCard.label}</span>
              </div>

              <div className="space-y-2">
                <label htmlFor="quickstart-prompt" className="block text-sm text-zinc-300">
                  Describe your game in one sentence
                </label>
                <textarea
                  id="quickstart-prompt"
                  ref={inputRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder={selectedCard.placeholder}
                />
                <p className="text-xs text-zinc-400">
                  AI will analyze your description and build a custom game — you can customize everything afterwards.
                </p>
              </div>

              {generateError && (
                <p role="alert" className="rounded-md border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-400">
                  {generateError}
                </p>
              )}

              <button
                onClick={handleGenerate}
                disabled={isGenerating || prompt.trim().length === 0}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Building your game...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate Game
                  </>
                )}
              </button>
            </div>
          )}

          {step === 3 && isReady && (
            <div className="space-y-6 text-center">
              <div className="flex flex-col items-center gap-3">
                <div
                  className="flex h-16 w-16 items-center justify-center rounded-full"
                  style={{ background: selectedCard?.gradient ?? 'linear-gradient(135deg, #22c55e, #059669)' }}
                >
                  {selectedCard && <selectedCard.icon className="h-8 w-8 text-white" />}
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-zinc-100">
                    {selectedCard?.label ?? 'Game'} is ready!
                  </h3>
                  <p className="mt-1 text-sm text-zinc-400">
                    Your game plan is ready. Review it in the Game Creator panel, then hit Play.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-4 text-left">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  What happens next
                </h4>
                <ul className="space-y-1 text-sm text-zinc-300">
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    AI analyzed your description and created a game plan
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    Review and approve the plan in the Game Creator panel
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    AI builds your game step by step — customize everything afterwards
                  </li>
                </ul>
              </div>

              <button
                onClick={handlePlay}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-green-600 px-4 py-4 text-base font-bold text-white shadow-lg transition-all hover:bg-green-500 hover:shadow-green-900/50 focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <Play className="h-5 w-5 fill-white" />
                Play Now
              </button>

              <button
                onClick={() => {
                  localStorage.setItem(STORAGE_KEY, '1');
                  onComplete();
                }}
                className="text-sm text-zinc-400 hover:text-zinc-300 transition-colors"
              >
                Edit first, play later
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Returns true if the user should see the quick-start flow.
 * Uses useSyncExternalStore pattern to avoid SSR/hydration mismatch.
 */
export function shouldShowQuickStart(): boolean {
  if (typeof window === 'undefined') return false;
  return !localStorage.getItem(STORAGE_KEY);
}
