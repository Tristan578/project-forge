'use client';

import { useState } from 'react';
import { GraduationCap, Sparkles, Rocket } from 'lucide-react';
import { useOnboardingStore } from '@/stores/onboardingStore';

interface WelcomeWizardProps {
  onStartTutorial: () => void;
  onChooseTemplate: () => void;
  onSkip: () => void;
}

export function WelcomeWizard({ onStartTutorial, onChooseTemplate, onSkip }: WelcomeWizardProps) {
  const { isNewUser, recordVisit } = useOnboardingStore();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  if (!isNewUser) return null;

  const handleChoice = (action: () => void) => {
    if (dontShowAgain) {
      recordVisit();
    }
    action();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 rounded-lg shadow-2xl max-w-2xl w-full p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-zinc-100 mb-3">
            Welcome to Project Forge!
          </h1>
          <p className="text-zinc-400 text-lg">
            Your AI-powered game creation platform. How would you like to begin?
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <button
            onClick={() => handleChoice(onStartTutorial)}
            className="bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 hover:border-blue-500 rounded-lg p-6 text-center transition-all group"
          >
            <div className="w-16 h-16 rounded-full bg-blue-600 group-hover:bg-blue-700 flex items-center justify-center mx-auto mb-4 transition-colors">
              <GraduationCap className="w-8 h-8 text-white" />
            </div>
            <h3 className="font-semibold text-zinc-100 mb-2">Start a Tutorial</h3>
            <p className="text-sm text-zinc-400">
              Learn the basics with a guided walkthrough
            </p>
          </button>

          <button
            onClick={() => handleChoice(onChooseTemplate)}
            className="bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 hover:border-purple-500 rounded-lg p-6 text-center transition-all group"
          >
            <div className="w-16 h-16 rounded-full bg-purple-600 group-hover:bg-purple-700 flex items-center justify-center mx-auto mb-4 transition-colors">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h3 className="font-semibold text-zinc-100 mb-2">Choose a Template</h3>
            <p className="text-sm text-zinc-400">
              Start with a pre-built game template
            </p>
          </button>

          <button
            onClick={() => handleChoice(onSkip)}
            className="bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 hover:border-green-500 rounded-lg p-6 text-center transition-all group"
          >
            <div className="w-16 h-16 rounded-full bg-green-600 group-hover:bg-green-700 flex items-center justify-center mx-auto mb-4 transition-colors">
              <Rocket className="w-8 h-8 text-white" />
            </div>
            <h3 className="font-semibold text-zinc-100 mb-2">Jump Right In</h3>
            <p className="text-sm text-zinc-400">
              Start with a blank scene and explore
            </p>
          </button>
        </div>

        <div className="flex items-center justify-center">
          <label className="flex items-center gap-2 cursor-pointer text-zinc-400 hover:text-zinc-300 transition-colors">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-zinc-900"
            />
            <span className="text-sm">Don&apos;t show this again</span>
          </label>
        </div>
      </div>
    </div>
  );
}
