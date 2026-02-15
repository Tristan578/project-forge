/**
 * Zustand store for onboarding and tutorial state.
 * Tracks tutorial progress, completed tasks, and user preferences.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'forge-onboarding-v1';

interface PersistedState {
  completedSteps: string[];
  completedTutorials: string[];
  activeTutorial: { id: string; step: number } | null;
  showTips: boolean;
  hasCompletedOnboarding: boolean;
}

function loadPersistedState(): PersistedState {
  if (typeof localStorage === 'undefined') {
    return {
      completedSteps: [],
      completedTutorials: [],
      activeTutorial: null,
      showTips: true,
      hasCompletedOnboarding: false,
    };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw) as PersistedState;
    }
  } catch {
    /* ignore */
  }

  return {
    completedSteps: [],
    completedTutorials: [],
    activeTutorial: null,
    showTips: true,
    hasCompletedOnboarding: false,
  };
}

function savePersistedState(state: PersistedState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export interface OnboardingState {
  // Persisted state
  completedSteps: string[];
  completedTutorials: string[];
  activeTutorial: { id: string; step: number } | null;
  showTips: boolean;
  hasCompletedOnboarding: boolean;

  // Actions
  startTutorial: (id: string) => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTutorial: () => void;
  completeTutorial: () => void;
  toggleTips: () => void;
  markStepComplete: (stepId: string) => void;
  resetOnboarding: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set, get) => {
  const persisted = loadPersistedState();

  return {
    ...persisted,

    startTutorial: (id) => {
      const newState = { id, step: 0 };
      set({ activeTutorial: newState });

      const persistedUpdate: PersistedState = {
        completedSteps: get().completedSteps,
        completedTutorials: get().completedTutorials,
        activeTutorial: newState,
        showTips: get().showTips,
        hasCompletedOnboarding: get().hasCompletedOnboarding,
      };
      savePersistedState(persistedUpdate);
    },

    nextStep: () => {
      const { activeTutorial } = get();
      if (!activeTutorial) return;

      const newState = {
        id: activeTutorial.id,
        step: activeTutorial.step + 1,
      };
      set({ activeTutorial: newState });

      const persistedUpdate: PersistedState = {
        completedSteps: get().completedSteps,
        completedTutorials: get().completedTutorials,
        activeTutorial: newState,
        showTips: get().showTips,
        hasCompletedOnboarding: get().hasCompletedOnboarding,
      };
      savePersistedState(persistedUpdate);
    },

    prevStep: () => {
      const { activeTutorial } = get();
      if (!activeTutorial || activeTutorial.step === 0) return;

      const newState = {
        id: activeTutorial.id,
        step: activeTutorial.step - 1,
      };
      set({ activeTutorial: newState });

      const persistedUpdate: PersistedState = {
        completedSteps: get().completedSteps,
        completedTutorials: get().completedTutorials,
        activeTutorial: newState,
        showTips: get().showTips,
        hasCompletedOnboarding: get().hasCompletedOnboarding,
      };
      savePersistedState(persistedUpdate);
    },

    skipTutorial: () => {
      set({ activeTutorial: null });

      const persistedUpdate: PersistedState = {
        completedSteps: get().completedSteps,
        completedTutorials: get().completedTutorials,
        activeTutorial: null,
        showTips: get().showTips,
        hasCompletedOnboarding: get().hasCompletedOnboarding,
      };
      savePersistedState(persistedUpdate);
    },

    completeTutorial: () => {
      const { activeTutorial, completedTutorials } = get();
      if (!activeTutorial) return;

      const newCompleted = [...completedTutorials, activeTutorial.id];
      set({
        activeTutorial: null,
        completedTutorials: newCompleted,
        hasCompletedOnboarding: newCompleted.length > 0,
      });

      const persistedUpdate: PersistedState = {
        completedSteps: get().completedSteps,
        completedTutorials: newCompleted,
        activeTutorial: null,
        showTips: get().showTips,
        hasCompletedOnboarding: true,
      };
      savePersistedState(persistedUpdate);
    },

    toggleTips: () => {
      set((s) => ({ showTips: !s.showTips }));

      const persistedUpdate: PersistedState = {
        completedSteps: get().completedSteps,
        completedTutorials: get().completedTutorials,
        activeTutorial: get().activeTutorial,
        showTips: !get().showTips,
        hasCompletedOnboarding: get().hasCompletedOnboarding,
      };
      savePersistedState(persistedUpdate);
    },

    markStepComplete: (stepId) => {
      const { completedSteps } = get();
      if (completedSteps.includes(stepId)) return;

      const newSteps = [...completedSteps, stepId];
      set({ completedSteps: newSteps });

      const persistedUpdate: PersistedState = {
        completedSteps: newSteps,
        completedTutorials: get().completedTutorials,
        activeTutorial: get().activeTutorial,
        showTips: get().showTips,
        hasCompletedOnboarding: get().hasCompletedOnboarding,
      };
      savePersistedState(persistedUpdate);
    },

    resetOnboarding: () => {
      const resetState: PersistedState = {
        completedSteps: [],
        completedTutorials: [],
        activeTutorial: null,
        showTips: true,
        hasCompletedOnboarding: false,
      };
      set(resetState);
      savePersistedState(resetState);
    },
  };
});
