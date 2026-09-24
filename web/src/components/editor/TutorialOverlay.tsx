/**
 * Tutorial overlay component that guides users through interactive tutorials.
 * Highlights UI elements and shows step-by-step instructions.
 */

'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { X, ChevronRight, Trophy } from 'lucide-react';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useEditorStore } from '@/stores/editorStore';
import { TUTORIALS, type TutorialStep } from '@/data/tutorials';

export function TutorialOverlay() {
  const activeTutorialId = useOnboardingStore((s) => s.activeTutorial);
  const tutorialStep = useOnboardingStore((s) => s.tutorialStep);
  const advanceTutorial = useOnboardingStore((s) => s.advanceTutorial);
  const retreatTutorial = useOnboardingStore((s) => s.retreatTutorial);
  const skipTutorial = useOnboardingStore((s) => s.skipTutorial);
  const completeTutorial = useOnboardingStore((s) => s.completeTutorial);

  const [actionCompleted, setActionCompleted] = useState(false);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);

  // Compute tutorial and step data
  const tutorial = useMemo(
    () => (activeTutorialId ? TUTORIALS.find((t) => t.id === activeTutorialId) : null),
    [activeTutorialId]
  );

  const currentStep = useMemo(
    () => (tutorial ? tutorial.steps[tutorialStep] : null),
    [tutorial, tutorialStep]
  );

  const isLastStep = useMemo(
    () => (tutorial ? tutorialStep === tutorial.steps.length - 1 : false),
    [tutorial, tutorialStep]
  );

  // Prev-value pattern: Reset actionCompleted when step changes
  const [prevStep_, setPrevStep_] = useState(tutorialStep);
  if (prevStep_ !== tutorialStep) {
    setPrevStep_(tutorialStep);
    setActionCompleted(currentStep?.actionRequired ? false : true);
  }

  // Prev-value pattern: Update highlightRect when target changes
  const [prevTarget, setPrevTarget] = useState(currentStep?.target ?? '');
  if (prevTarget !== (currentStep?.target ?? '')) {
    setPrevTarget(currentStep?.target ?? '');
    if (!currentStep?.target) {
      setHighlightRect(null);
    }
  }

  const handleNext = useCallback(() => {
    if (isLastStep) {
      completeTutorial();
    } else {
      advanceTutorial();
    }
  }, [isLastStep, completeTutorial, advanceTutorial]);

  const handleSkip = useCallback(() => {
    skipTutorial();
  }, [skipTutorial]);

  // Keyboard navigation: Escape closes, ArrowRight/ArrowLeft navigates steps.
  // Use a ref to hold the latest handler state so the listener itself only
  // re-registers when activeTutorialId changes (not on every step transition).
  const keyHandlerState = useRef({
    isLastStep,
    currentStep,
    tutorialStep,
    skipTutorial,
    completeTutorial,
    advanceTutorial,
    retreatTutorial,
  });
  useEffect(() => {
    keyHandlerState.current = {
      isLastStep,
      currentStep,
      tutorialStep,
      skipTutorial,
      completeTutorial,
      advanceTutorial,
      retreatTutorial,
    };
  });

  useEffect(() => {
    if (!activeTutorialId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const s = keyHandlerState.current;
      switch (e.key) {
        case 'Escape':
          s.skipTutorial();
          break;
        case 'ArrowRight':
          if (s.isLastStep) {
            s.completeTutorial();
          } else if (!s.currentStep?.actionRequired) {
            s.advanceTutorial();
          }
          break;
        case 'ArrowLeft':
          if (s.tutorialStep > 0) {
            s.retreatTutorial();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTutorialId]);

  // Update highlight position via DOM query
  useEffect(() => {
    if (!currentStep?.target) return;

    const updateHighlight = () => {
      const el = document.querySelector(currentStep.target!);
      if (el) {
        const rect = el.getBoundingClientRect();
        setHighlightRect(rect);
      } else {
        setHighlightRect(null);
      }
    };

    updateHighlight();
    window.addEventListener('resize', updateHighlight, { passive: true });
    return () => window.removeEventListener('resize', updateHighlight);
  }, [currentStep?.target]);

  // Action detection via subscription
  useEffect(() => {
    if (!currentStep?.actionRequired) return;

    const unsubscribe = useEditorStore.subscribe((state, prevState) => {
      const { type, value: _value } = currentStep.actionRequired!;

      switch (type) {
        case 'select-entity':
          if (state.primaryId && !prevState.primaryId) {
            setActionCompleted(true);
            if (currentStep.autoAdvance) {
              setTimeout(() => advanceTutorial(), 500);
            }
          }
          break;

        case 'transform-change':
          if (
            state.primaryId &&
            state.primaryTransform !== prevState.primaryTransform
          ) {
            setActionCompleted(true);
            if (currentStep.autoAdvance) {
              setTimeout(() => advanceTutorial(), 500);
            }
          }
          break;

        case 'material-change':
          if (
            state.primaryId &&
            state.primaryMaterial !== prevState.primaryMaterial
          ) {
            setActionCompleted(true);
            if (currentStep.autoAdvance) {
              setTimeout(() => advanceTutorial(), 500);
            }
          }
          break;

        case 'entity-created':
          if (Object.keys(state.sceneGraph.nodes).length > Object.keys(prevState.sceneGraph.nodes).length) {
            // Check if correct entity type (simplified - just check count increase for now)
            setActionCompleted(true);
            if (currentStep.autoAdvance) {
              setTimeout(() => advanceTutorial(), 500);
            }
          }
          break;

        case 'play-mode':
          if (state.engineMode === 'play' && prevState.engineMode === 'edit') {
            setActionCompleted(true);
            if (currentStep.autoAdvance) {
              setTimeout(() => advanceTutorial(), currentStep.delay ?? 500);
            }
          }
          break;

        case 'edit-mode':
          if (state.engineMode === 'edit' && prevState.engineMode === 'play') {
            setActionCompleted(true);
            if (currentStep.autoAdvance) {
              setTimeout(() => advanceTutorial(), 500);
            }
          }
          break;

        case 'script-edit':
          if (
            state.primaryId &&
            state.primaryScript !== prevState.primaryScript
          ) {
            setActionCompleted(true);
            if (currentStep.autoAdvance) {
              setTimeout(() => advanceTutorial(), 500);
            }
          }
          break;
      }
    });

    return unsubscribe;
  }, [currentStep, advanceTutorial]);

  // Early return after all hooks
  if (!activeTutorialId || !tutorial || !currentStep) return null;

  return (
    <>
      {/* Backdrop with spotlight */}
      <div className="fixed inset-0 z-[100] bg-black/60 pointer-events-none" />

      {/* Highlight border */}
      {highlightRect && (
        <div
          data-testid="tutorial-highlight"
          className="fixed z-[101] border-3 border-blue-500 rounded-lg pointer-events-none"
          style={{
            left: `${highlightRect.left - 8}px`,
            top: `${highlightRect.top - 8}px`,
            width: `${highlightRect.width + 16}px`,
            height: `${highlightRect.height + 16}px`,
            boxShadow: '0 0 20px rgba(59, 130, 246, 0.5)',
          }}
        />
      )}

      {/* Instruction bubble */}
      <TutorialBubble
        step={currentStep}
        stepNumber={tutorialStep + 1}
        totalSteps={tutorial.steps.length}
        actionCompleted={actionCompleted}
        isLastStep={isLastStep}
        highlightRect={highlightRect}
        onNext={handleNext}
        onSkip={handleSkip}
      />
    </>
  );
}

/** Widest the bubble gets; narrower on small screens. */
const BUBBLE_MAX_WIDTH = 400;
/** Height the placement reserves for the bubble (title, 3-line body, buttons). */
const BUBBLE_HEIGHT = 216;
/** Minimum gap between the bubble and the viewport edge. */
const EDGE = 16;

interface TutorialBubbleProps {
  step: TutorialStep;
  stepNumber: number;
  totalSteps: number;
  actionCompleted: boolean;
  isLastStep: boolean;
  highlightRect: DOMRect | null;
  onNext: () => void;
  onSkip: () => void;
}

function TutorialBubble({
  step,
  stepNumber,
  totalSteps,
  actionCompleted,
  isLastStep,
  highlightRect,
  onNext,
  onSkip,
}: TutorialBubbleProps) {
  // Computed at render time. The bubble is at most 400px wide and never wider
  // than the viewport less a 16px margin each side, so it fits a 320px phone.
  // A step placed below (or above) its target flips to the other side when
  // there is no room: the compact layout docks the quick-start trigger at the
  // bottom of the screen, and a bubble clamped onto it hid the very control it
  // was pointing at (#10171).
  const position = useMemo(() => {
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : 768;
    const width = Math.min(BUBBLE_MAX_WIDTH, viewportW - 2 * EDGE);
    const clampLeft = (left: number) => Math.max(EDGE, Math.min(left, viewportW - width - EDGE));
    const clampTop = (top: number) =>
      Math.max(EDGE, Math.min(top, viewportH - BUBBLE_HEIGHT - EDGE));

    if (!highlightRect || !step.targetPosition) {
      return {
        top: clampTop(viewportH / 2 - BUBBLE_HEIGHT / 2),
        left: clampLeft((viewportW - width) / 2),
        width,
      };
    }

    const gap = 16;
    const above = highlightRect.top - BUBBLE_HEIGHT - gap;
    const below = highlightRect.bottom + gap;
    const fitsAbove = above >= EDGE;
    const fitsBelow = below + BUBBLE_HEIGHT <= viewportH - EDGE;
    const centredLeft = highlightRect.left + highlightRect.width / 2 - width / 2;
    let top: number;
    let left: number;

    switch (step.targetPosition) {
      case 'top':
        top = fitsAbove || !fitsBelow ? above : below;
        left = centredLeft;
        break;
      case 'bottom':
        top = fitsBelow || !fitsAbove ? below : above;
        left = centredLeft;
        break;
      case 'left':
        top = highlightRect.top + highlightRect.height / 2 - BUBBLE_HEIGHT / 2;
        left = highlightRect.left - width - gap;
        break;
      case 'right':
        top = highlightRect.top + highlightRect.height / 2 - BUBBLE_HEIGHT / 2;
        left = highlightRect.right + gap;
        break;
    }

    return { top: clampTop(top), left: clampLeft(left), width };
  }, [highlightRect, step.targetPosition]);

  return (
    <div
      data-testid="tutorial-bubble"
      className="fixed z-[102] rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl pointer-events-auto"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        width: `${position.width}px`,
      }}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
            {stepNumber}
          </div>
          <span className="text-xs text-zinc-400">
            Step {stepNumber} of {totalSteps}
          </span>
        </div>
        <button
          onClick={onSkip}
          className="rounded p-1 text-zinc-400 hover:text-zinc-300 transition-colors"
          title="Skip tutorial"
        >
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <h3 className="mb-2 text-lg font-semibold text-zinc-100">{step.title}</h3>
      <p className="mb-4 text-sm text-zinc-300">{step.description}</p>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <div className="flex gap-2">
          <button
            onClick={onSkip}
            className="min-h-11 rounded bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Skip Tutorial
          </button>
          <button
            onClick={onNext}
            disabled={!actionCompleted && !!step.actionRequired}
            className="flex min-h-11 items-center gap-1 rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLastStep ? (
              <>
                Complete
                <Trophy size={16} />
              </>
            ) : (
              <>
                Next
                <ChevronRight size={16} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
