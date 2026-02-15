import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface OnboardingState {
  // Tutorial state
  activeTutorial: string | null;
  tutorialStep: number;
  tutorialCompleted: Record<string, boolean>;

  // Feature checklist
  basicTasks: Record<string, boolean>;
  advancedTasks: Record<string, boolean>;

  // Tips
  dismissedTips: string[];
  tipCooldownUntil: number;

  // Achievements
  unlockedAchievements: string[];
  lastAchievementShown: string | null;

  // Returning user
  lastVisitTimestamp: number;
  isNewUser: boolean;
  showWhatsNew: boolean;

  // UI
  showOnboardingPanel: boolean;
  showAchievementToast: boolean;

  // Actions
  startTutorial: (id: string) => void;
  advanceTutorial: () => void;
  completeTutorial: () => void;
  skipTutorial: () => void;
  completeTask: (taskId: string) => void;
  dismissTip: (tipId: string) => void;
  unlockAchievement: (id: string) => void;
  dismissAchievementToast: () => void;
  setShowOnboardingPanel: (show: boolean) => void;
  dismissWhatsNew: () => void;
  recordVisit: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      // Initial state
      activeTutorial: null,
      tutorialStep: 0,
      tutorialCompleted: {},

      basicTasks: {},
      advancedTasks: {},

      dismissedTips: [],
      tipCooldownUntil: 0,

      unlockedAchievements: [],
      lastAchievementShown: null,

      lastVisitTimestamp: Date.now(),
      isNewUser: true,
      showWhatsNew: false,

      showOnboardingPanel: false,
      showAchievementToast: false,

      // Actions
      startTutorial: (id: string) => {
        set({
          activeTutorial: id,
          tutorialStep: 0,
        });
      },

      advanceTutorial: () => {
        set((state) => ({
          tutorialStep: state.tutorialStep + 1,
        }));
      },

      completeTutorial: () => {
        const state = get();
        if (!state.activeTutorial) return;

        set({
          tutorialCompleted: {
            ...state.tutorialCompleted,
            [state.activeTutorial]: true,
          },
          activeTutorial: null,
          tutorialStep: 0,
        });
      },

      skipTutorial: () => {
        set({
          activeTutorial: null,
          tutorialStep: 0,
        });
      },

      completeTask: (taskId: string) => {
        const state = get();
        const isBasic = taskId.startsWith('create-') || 
          taskId === 'customize-material' ||
          taskId === 'add-physics' ||
          taskId === 'write-script' ||
          taskId === 'use-ai-chat' ||
          taskId === 'export-game';

        if (isBasic) {
          set({
            basicTasks: {
              ...state.basicTasks,
              [taskId]: true,
            },
          });
        } else {
          set({
            advancedTasks: {
              ...state.advancedTasks,
              [taskId]: true,
            },
          });
        }
      },

      dismissTip: (tipId: string) => {
        const state = get();
        set({
          dismissedTips: [...state.dismissedTips, tipId],
          tipCooldownUntil: Date.now() + 30000, // 30 seconds
        });
      },

      unlockAchievement: (id: string) => {
        const state = get();
        if (state.unlockedAchievements.includes(id)) return;

        set({
          unlockedAchievements: [...state.unlockedAchievements, id],
          lastAchievementShown: id,
          showAchievementToast: true,
        });
      },

      dismissAchievementToast: () => {
        set({
          showAchievementToast: false,
        });
      },

      setShowOnboardingPanel: (show: boolean) => {
        set({
          showOnboardingPanel: show,
        });
      },

      dismissWhatsNew: () => {
        set({
          showWhatsNew: false,
        });
      },

      recordVisit: () => {
        const state = get();
        const now = Date.now();
        const daysSinceLastVisit = (now - state.lastVisitTimestamp) / (1000 * 60 * 60 * 24);

        set({
          lastVisitTimestamp: now,
          isNewUser: false,
          showWhatsNew: daysSinceLastVisit > 7,
        });
      },
    }),
    {
      name: 'forge-onboarding',
    }
  )
);
