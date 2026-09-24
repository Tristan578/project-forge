/**
 * Tutorial overlay component that guides users through interactive tutorials.
 * Highlights UI elements and shows step-by-step instructions.
 */

'use client';

import { useState, useEffect, useCallback, useMemo, useRef, useId, useSyncExternalStore } from 'react';
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
        stepKey={`${activeTutorialId}:${tutorialStep}`}
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
/**
 * Room a side must offer before the bubble is placed there: a worst case for a
 * 288px-wide bubble (header, title, a six-line description, the key hint and
 * 44px buttons). It only CHOOSES the side. The bubble is anchored to the edge
 * facing its target and capped at the room it was given, so it cannot overlap
 * the target or leave the viewport whatever its real height turns out to be.
 */
const BUBBLE_HEIGHT_BUDGET = 340;
/** With less room than this on either side, the step shows as a centred card. */
const BUBBLE_MIN_HEIGHT = 160;
/** Minimum gap between the bubble and the viewport edge. */
const EDGE = 16;
/** Gap between the bubble and its target. */
const GAP = 16;

type TargetRect = Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right' | 'width' | 'height'>;

/**
 * Where the bubble goes, in viewport pixels. Exactly one vertical anchor is
 * set: `top` (bubble below or beside its target), `bottom` (bubble above its
 * target, so it grows upward away from it), or `centred` (no usable target).
 */
export interface BubblePlacement {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
  centred?: true;
}

export function placeBubble(
  rect: TargetRect | null,
  position: TutorialStep['targetPosition'],
  viewportW: number,
  viewportH: number,
): BubblePlacement {
  const width = Math.max(0, Math.min(BUBBLE_MAX_WIDTH, viewportW - 2 * EDGE));
  const clampLeft = (left: number) => Math.max(EDGE, Math.min(left, viewportW - width - EDGE));
  const centredCard: BubblePlacement = {
    left: clampLeft((viewportW - width) / 2),
    width,
    maxHeight: Math.max(0, viewportH - 2 * EDGE),
    centred: true,
  };

  if (!rect || !position) return centredCard;

  // Above or below the target, preferring `prefer`. The compact layout docks
  // the quick-start trigger at the bottom of the screen, so a 'bottom' step
  // has to be able to flip above it (#10171).
  const vertical = (prefer: 'above' | 'below'): BubblePlacement => {
    const roomAbove = rect.top - GAP - EDGE;
    const roomBelow = viewportH - rect.bottom - GAP - EDGE;
    const other = prefer === 'above' ? 'below' : 'above';
    const room = (side: 'above' | 'below') => (side === 'above' ? roomAbove : roomBelow);
    let side: 'above' | 'below';
    if (room(prefer) >= BUBBLE_HEIGHT_BUDGET) side = prefer;
    else if (room(other) >= BUBBLE_HEIGHT_BUDGET) side = other;
    else side = room(other) > room(prefer) ? other : prefer;

    if (room(side) < BUBBLE_MIN_HEIGHT) return centredCard;
    const left = clampLeft(rect.left + rect.width / 2 - width / 2);
    return side === 'above'
      ? { left, width, bottom: viewportH - rect.top + GAP, maxHeight: roomAbove }
      : { left, width, top: rect.bottom + GAP, maxHeight: roomBelow };
  };

  switch (position) {
    case 'top':
      return vertical('above');
    case 'bottom':
      return vertical('below');
    case 'left':
    case 'right': {
      const left = position === 'left' ? rect.left - GAP - width : rect.right + GAP;
      // No room beside the target (a phone, or a target near that edge):
      // clamping would slide the bubble back over it, so go below instead.
      if (left < EDGE || left + width > viewportW - EDGE) return vertical('below');
      const budget = Math.min(BUBBLE_HEIGHT_BUDGET, viewportH - 2 * EDGE);
      const top = Math.max(
        EDGE,
        Math.min(rect.top + rect.height / 2 - budget / 2, viewportH - EDGE - budget),
      );
      return { left, width, top, maxHeight: Math.max(0, viewportH - EDGE - top) };
    }
  }
}

function subscribeToViewport(onChange: () => void) {
  window.addEventListener('resize', onChange, { passive: true });
  window.addEventListener('orientationchange', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
  };
}
const readViewportWidth = () => window.innerWidth;
const readViewportHeight = () => window.innerHeight;
const serverViewportWidth = () => 1024;
const serverViewportHeight = () => 768;

interface TutorialBubbleProps {
  /** Changes on every step of every tutorial; focus moves to Next when it does. */
  stepKey: string;
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
  stepKey,
  step,
  stepNumber,
  totalSteps,
  actionCompleted,
  isLastStep,
  highlightRect,
  onNext,
  onSkip,
}: TutorialBubbleProps) {
  // Re-laid out on resize and rotation, including for untargeted cards, which
  // have no highlight listener to re-render them.
  const viewportW = useSyncExternalStore(subscribeToViewport, readViewportWidth, serverViewportWidth);
  const viewportH = useSyncExternalStore(subscribeToViewport, readViewportHeight, serverViewportHeight);
  const placement = useMemo(
    () => placeBubble(highlightRect, step.targetPosition, viewportW, viewportH),
    [highlightRect, step.targetPosition, viewportW, viewportH],
  );

  const titleId = useId();
  const bodyId = useId();
  const hintId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Give focus back to whatever had it before the tour (the Help button, when
  // started from the Help menu) once the tour ends. Declared before the effect
  // below so it records the opener before focus moves into the bubble.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // Each step takes focus, so a keyboard or screen reader user lands in the
  // tour rather than on whatever launched it. A step waiting on an action has a
  // disabled Next, so the dialog itself takes focus instead.
  useEffect(() => {
    const next = nextRef.current;
    if (next && !next.disabled) next.focus();
    else dialogRef.current?.focus();
  }, [stepKey]);

  const anchor = placement.centred
    ? { top: '50%', transform: 'translateY(-50%)' }
    : placement.bottom !== undefined
      ? { bottom: `${placement.bottom}px` }
      : { top: `${placement.top}px` };

  return (
    <div
      ref={dialogRef}
      data-testid="tutorial-bubble"
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={`${bodyId} ${hintId}`}
      tabIndex={-1}
      className="fixed z-[102] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-2xl pointer-events-auto"
      style={{
        ...anchor,
        left: `${placement.left}px`,
        width: `${placement.width}px`,
        maxHeight: `${placement.maxHeight}px`,
      }}
    >
      {/* Announced on every step change; the first step is announced when focus enters the dialog. */}
      <p data-testid="tutorial-live" role="status" className="sr-only">
        {`Step ${stepNumber} of ${totalSteps}: ${step.title}. ${step.description}`}
      </p>

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
          type="button"
          onClick={onSkip}
          aria-label="Skip tutorial"
          className="-my-2 -mr-2 flex min-h-11 min-w-11 items-center justify-center rounded text-zinc-400 hover:text-zinc-300 transition-colors"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {/* Content */}
      <h3 id={titleId} className="mb-2 text-lg font-semibold text-zinc-100">{step.title}</h3>
      <p id={bodyId} className="mb-3 text-sm text-zinc-300">{step.description}</p>
      <p id={hintId} data-testid="tutorial-key-hint" className="mb-3 text-xs text-zinc-400">
        Keys: Right arrow for next, Left arrow for back, Esc to skip.
      </p>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="min-h-11 rounded bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Skip Tutorial
          </button>
          <button
            ref={nextRef}
            type="button"
            onClick={onNext}
            disabled={!actionCompleted && !!step.actionRequired}
            className="flex min-h-11 items-center gap-1 rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLastStep ? (
              <>
                Complete
                <Trophy size={16} aria-hidden="true" />
              </>
            ) : (
              <>
                Next
                <ChevronRight size={16} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
