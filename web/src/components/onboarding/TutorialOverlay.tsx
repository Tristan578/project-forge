'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { TUTORIALS, TutorialStep } from '@/data/tutorials';

export function TutorialOverlay() {
  const {
    activeTutorial,
    tutorialStep,
    advanceTutorial,
    completeTutorial,
    skipTutorial,
  } = useOnboardingStore();

  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const [stepCardPos, setStepCardPos] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  const tutorial = TUTORIALS.find(t => t.id === activeTutorial);
  const currentStep: TutorialStep | undefined = tutorial?.steps[tutorialStep];

  const updatePosition = useCallback(() => {
    if (!currentStep?.target) return;

    const element = document.querySelector(currentStep.target);
    if (!element) return;

    const rect = element.getBoundingClientRect();
    setHighlightRect(rect);

    if (cardRef.current) {
      const cardRect = cardRef.current.getBoundingClientRect();
      const position = currentStep.targetPosition || 'bottom';

      let top = 0;
      let left = 0;

      switch (position) {
        case 'top':
          top = rect.top - cardRect.height - 16;
          left = rect.left + (rect.width - cardRect.width) / 2;
          break;
        case 'bottom':
          top = rect.bottom + 16;
          left = rect.left + (rect.width - cardRect.width) / 2;
          break;
        case 'left':
          top = rect.top + (rect.height - cardRect.height) / 2;
          left = rect.left - cardRect.width - 16;
          break;
        case 'right':
          top = rect.top + (rect.height - cardRect.height) / 2;
          left = rect.right + 16;
          break;
      }

      top = Math.max(16, Math.min(window.innerHeight - cardRect.height - 16, top));
      left = Math.max(16, Math.min(window.innerWidth - cardRect.width - 16, left));

      setStepCardPos({ top, left });
    }
  }, [currentStep]);

  useEffect(() => {
    if (!currentStep?.target) return;

    const scheduleUpdate = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updatePosition);
    };

    scheduleUpdate();
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate);
    };
  }, [currentStep, updatePosition]);

  if (!tutorial || !currentStep) return null;

  const isLastStep = tutorialStep === tutorial.steps.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      completeTutorial();
    } else {
      advanceTutorial();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none">
      <div className="absolute inset-0 bg-black/70 pointer-events-auto" onClick={skipTutorial} />

      {highlightRect && (
        <div
          className="absolute border-4 border-blue-500 rounded pointer-events-none animate-pulse"
          style={{
            top: highlightRect.top - 4,
            left: highlightRect.left - 4,
            width: highlightRect.width + 8,
            height: highlightRect.height + 8,
          }}
        />
      )}

      <div
        ref={cardRef}
        className="absolute bg-zinc-900 rounded-lg shadow-2xl border border-zinc-700 p-6 max-w-md pointer-events-auto"
        style={
          stepCardPos
            ? { top: stepCardPos.top, left: stepCardPos.left }
            : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
        }
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm text-zinc-400">
            Step {tutorialStep + 1} of {tutorial.steps.length}
          </span>
          <button
            onClick={skipTutorial}
            className="p-1 hover:bg-zinc-800 rounded transition-colors"
          >
            <X className="w-4 h-4 text-zinc-400" />
          </button>
        </div>

        <h3 className="text-lg font-semibold text-zinc-100 mb-3">
          {currentStep.title}
        </h3>

        <p className="text-zinc-300 mb-6 leading-relaxed">
          {currentStep.description}
        </p>

        <div className="flex items-center justify-between">
          <button
            onClick={skipTutorial}
            className="px-4 py-2 text-zinc-400 hover:text-zinc-300 transition-colors text-sm"
          >
            Skip Tutorial
          </button>
          <button
            onClick={handleNext}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            {isLastStep ? 'Complete' : 'Next'}
            {!isLastStep && <ArrowRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
