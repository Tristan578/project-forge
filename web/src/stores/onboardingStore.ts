import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type OnboardingPath = 'ai' | 'template' | 'blank' | 'tour';
export type VisibilityTier = 'novice' | 'intermediate' | 'advanced' | 'expert';

// Legacy localStorage keys — if any are set, the user is NOT new
const LEGACY_KEYS = ['forge-quickstart-completed', 'forge-welcomed'];

function checkLegacyKeys(): boolean {
  if (typeof window === 'undefined') return false;
  return LEGACY_KEYS.some((key) => !!localStorage.getItem(key));
}

const BASIC_TASK_IDS = new Set([
  'create-entity',
  'customize-material',
  'add-physics',
  'write-script',
  'use-ai-chat',
  'export-game',
]);

const BASIC_TASKS_FOR_INTERMEDIATE = 3;
const ADVANCED_TASKS_FOR_ADVANCED = 3;

export interface OnboardingState {
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

  // Phase 1 additions — onboarding wizard state
  onboardingPath: OnboardingPath | null;
  onboardingStartedAt: number | null;
  featureVisibilityTier: VisibilityTier;
  firstInteractions: Record<string, boolean>;
  onboardingCompleted: boolean;
  dismissWizard: () => void;

  // Actions
  startTutorial: (id: string) => void;
  advanceTutorial: () => void;
  retreatTutorial: () => void;
  completeTutorial: () => void;
  skipTutorial: () => void;
  completeTask: (taskId: string) => void;
  dismissTip: (tipId: string) => void;
  unlockAchievement: (id: string) => void;
  dismissAchievementToast: () => void;
  setShowOnboardingPanel: (show: boolean) => void;
  dismissWhatsNew: () => void;
  recordVisit: () => void;

  // Phase 1 new actions
  selectPath: (path: OnboardingPath) => void;
  setVisibilityTier: (tier: VisibilityTier) => void;
  recordFirstInteraction: (panelId: string) => void;
  completeOnboarding: () => void;
  autoPromoteVisibilityTier: () => void;
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

      lastVisitTimestamp: 0,
      isNewUser: true,
      showWhatsNew: false,

      showOnboardingPanel: false,
      showAchievementToast: false,

      // Phase 1 initial state
      onboardingPath: null,
      onboardingStartedAt: null,
      featureVisibilityTier: 'novice',
      firstInteractions: {},
      onboardingCompleted: false,

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

      retreatTutorial: () => {
        set((state) => ({
          tutorialStep: Math.max(0, state.tutorialStep - 1),
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
        const isBasic = BASIC_TASK_IDS.has(taskId) || taskId.startsWith('create-');

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

        // Auto-promote tier after updating tasks
        get().autoPromoteVisibilityTier();
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
        const daysSinceLastVisit =
          state.lastVisitTimestamp > 0
            ? (now - state.lastVisitTimestamp) / (1000 * 60 * 60 * 24)
            : 0;

        set({
          lastVisitTimestamp: now,
          isNewUser: false,
          showWhatsNew: daysSinceLastVisit > 7,
        });
      },

      // Phase 1 new actions
      selectPath: (path: OnboardingPath) => {
        set({
          onboardingPath: path,
          onboardingStartedAt: Date.now(),
        });
      },

      setVisibilityTier: (tier: VisibilityTier) => {
        set({ featureVisibilityTier: tier });
      },

      recordFirstInteraction: (panelId: string) => {
        const state = get();
        if (state.firstInteractions[panelId]) return;
        set({
          firstInteractions: {
            ...state.firstInteractions,
            [panelId]: true,
          },
        });
      },

      completeOnboarding: () => {
        set({
          onboardingCompleted: true,
          isNewUser: false,
          lastVisitTimestamp: Date.now(),
        });
      },

      dismissWizard: () => {
        set({
          onboardingCompleted: true,
          isNewUser: false,
        });
      },

      autoPromoteVisibilityTier: () => {
        const state = get();
        const basicCount = Object.values(state.basicTasks).filter(Boolean).length;
        const advancedCount = Object.values(state.advancedTasks).filter(Boolean).length;
        const current = state.featureVisibilityTier;

        if (current === 'novice' && basicCount >= BASIC_TASKS_FOR_INTERMEDIATE) {
          set({ featureVisibilityTier: 'intermediate' });
        } else if (current === 'intermediate' && advancedCount >= ADVANCED_TASKS_FOR_ADVANCED) {
          set({ featureVisibilityTier: 'advanced' });
        }
      },
    }),
    {
      name: 'forge-onboarding-v2',
      // Migrate legacy key if it exists — users on old key should not see wizard
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const hasLegacy = checkLegacyKeys();
        if (hasLegacy && state.isNewUser) {
          state.isNewUser = false;
          state.onboardingCompleted = true;
        }
      },
    }
  )
);
