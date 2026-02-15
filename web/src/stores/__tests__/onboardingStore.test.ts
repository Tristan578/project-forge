/**
 * Unit tests for the onboardingStore Zustand store.
 *
 * Tests cover tutorial state, task completion, tips, achievements,
 * and returning user detection.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useOnboardingStore } from '../onboardingStore';

describe('onboardingStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useOnboardingStore.setState({
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
    });
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('Initial State', () => {
    it('should initialize with no active tutorial', () => {
      const state = useOnboardingStore.getState();
      expect(state.activeTutorial).toBeNull();
      expect(state.tutorialStep).toBe(0);
    });

    it('should initialize with empty task lists', () => {
      const state = useOnboardingStore.getState();
      expect(state.basicTasks).toEqual({});
      expect(state.advancedTasks).toEqual({});
    });

    it('should initialize with no dismissed tips', () => {
      const state = useOnboardingStore.getState();
      expect(state.dismissedTips).toEqual([]);
      expect(state.tipCooldownUntil).toBe(0);
    });

    it('should initialize with no achievements', () => {
      const state = useOnboardingStore.getState();
      expect(state.unlockedAchievements).toEqual([]);
      expect(state.lastAchievementShown).toBeNull();
    });

    it('should initialize as new user', () => {
      const state = useOnboardingStore.getState();
      expect(state.isNewUser).toBe(true);
      expect(state.showWhatsNew).toBe(false);
    });

    it('should initialize with panels closed', () => {
      const state = useOnboardingStore.getState();
      expect(state.showOnboardingPanel).toBe(false);
      expect(state.showAchievementToast).toBe(false);
    });
  });

  describe('Tutorial State', () => {
    it('should start a tutorial', () => {
      const { startTutorial } = useOnboardingStore.getState();

      startTutorial('basics');

      const state = useOnboardingStore.getState();
      expect(state.activeTutorial).toBe('basics');
      expect(state.tutorialStep).toBe(0);
    });

    it('should advance tutorial step', () => {
      const { startTutorial, advanceTutorial } = useOnboardingStore.getState();

      startTutorial('basics');
      advanceTutorial();

      const state = useOnboardingStore.getState();
      expect(state.tutorialStep).toBe(1);
    });

    it('should advance multiple steps', () => {
      const { startTutorial, advanceTutorial } = useOnboardingStore.getState();

      startTutorial('basics');
      advanceTutorial();
      advanceTutorial();
      advanceTutorial();

      const state = useOnboardingStore.getState();
      expect(state.tutorialStep).toBe(3);
    });

    it('should complete tutorial', () => {
      const { startTutorial, completeTutorial } = useOnboardingStore.getState();

      startTutorial('basics');
      completeTutorial();

      const state = useOnboardingStore.getState();
      expect(state.tutorialCompleted.basics).toBe(true);
      expect(state.activeTutorial).toBeNull();
      expect(state.tutorialStep).toBe(0);
    });

    it('should not complete tutorial if none active', () => {
      const { completeTutorial } = useOnboardingStore.getState();

      completeTutorial();

      const state = useOnboardingStore.getState();
      expect(state.tutorialCompleted).toEqual({});
    });

    it('should skip tutorial', () => {
      const { startTutorial, skipTutorial } = useOnboardingStore.getState();

      startTutorial('basics');
      skipTutorial();

      const state = useOnboardingStore.getState();
      expect(state.activeTutorial).toBeNull();
      expect(state.tutorialStep).toBe(0);
      expect(state.tutorialCompleted.basics).toBeUndefined();
    });

    it('should track multiple completed tutorials', () => {
      const { startTutorial, completeTutorial } = useOnboardingStore.getState();

      startTutorial('basics');
      completeTutorial();

      startTutorial('advanced');
      completeTutorial();

      const state = useOnboardingStore.getState();
      expect(state.tutorialCompleted.basics).toBe(true);
      expect(state.tutorialCompleted.advanced).toBe(true);
    });
  });

  describe('Task Completion', () => {
    it('should complete basic task: create-entity', () => {
      const { completeTask } = useOnboardingStore.getState();

      completeTask('create-cube');

      const state = useOnboardingStore.getState();
      expect(state.basicTasks['create-cube']).toBe(true);
    });

    it('should complete basic task: customize-material', () => {
      const { completeTask } = useOnboardingStore.getState();

      completeTask('customize-material');

      const state = useOnboardingStore.getState();
      expect(state.basicTasks['customize-material']).toBe(true);
    });

    it('should complete basic task: add-physics', () => {
      const { completeTask } = useOnboardingStore.getState();

      completeTask('add-physics');

      const state = useOnboardingStore.getState();
      expect(state.basicTasks['add-physics']).toBe(true);
    });

    it('should complete basic task: write-script', () => {
      const { completeTask } = useOnboardingStore.getState();

      completeTask('write-script');

      const state = useOnboardingStore.getState();
      expect(state.basicTasks['write-script']).toBe(true);
    });

    it('should complete basic task: use-ai-chat', () => {
      const { completeTask } = useOnboardingStore.getState();

      completeTask('use-ai-chat');

      const state = useOnboardingStore.getState();
      expect(state.basicTasks['use-ai-chat']).toBe(true);
    });

    it('should complete basic task: export-game', () => {
      const { completeTask } = useOnboardingStore.getState();

      completeTask('export-game');

      const state = useOnboardingStore.getState();
      expect(state.basicTasks['export-game']).toBe(true);
    });

    it('should complete advanced task', () => {
      const { completeTask } = useOnboardingStore.getState();

      completeTask('advanced-shader');

      const state = useOnboardingStore.getState();
      expect(state.advancedTasks['advanced-shader']).toBe(true);
    });

    it('should complete multiple tasks', () => {
      const { completeTask } = useOnboardingStore.getState();

      completeTask('create-cube');
      completeTask('add-physics');
      completeTask('advanced-shader');

      const state = useOnboardingStore.getState();
      expect(state.basicTasks['create-cube']).toBe(true);
      expect(state.basicTasks['add-physics']).toBe(true);
      expect(state.advancedTasks['advanced-shader']).toBe(true);
    });
  });

  describe('Tips', () => {
    it('should dismiss a tip', () => {
      const { dismissTip } = useOnboardingStore.getState();
      const nowBefore = Date.now();

      dismissTip('tip-gizmo');

      const state = useOnboardingStore.getState();
      const nowAfter = Date.now();

      expect(state.dismissedTips).toContain('tip-gizmo');
      expect(state.tipCooldownUntil).toBeGreaterThanOrEqual(nowBefore + 30000);
      expect(state.tipCooldownUntil).toBeLessThanOrEqual(nowAfter + 30000);
    });

    it('should dismiss multiple tips', () => {
      const { dismissTip } = useOnboardingStore.getState();

      dismissTip('tip-1');
      dismissTip('tip-2');

      const state = useOnboardingStore.getState();
      expect(state.dismissedTips).toEqual(['tip-1', 'tip-2']);
    });

    it('should update cooldown on each dismissal', () => {
      const { dismissTip } = useOnboardingStore.getState();

      dismissTip('tip-1');
      const cooldown1 = useOnboardingStore.getState().tipCooldownUntil;

      vi.useFakeTimers();
      vi.advanceTimersByTime(1000);

      dismissTip('tip-2');
      const cooldown2 = useOnboardingStore.getState().tipCooldownUntil;

      expect(cooldown2).toBeGreaterThan(cooldown1);
      vi.useRealTimers();
    });
  });

  describe('Achievements', () => {
    it('should unlock achievement', () => {
      const { unlockAchievement } = useOnboardingStore.getState();

      unlockAchievement('first-cube');

      const state = useOnboardingStore.getState();
      expect(state.unlockedAchievements).toContain('first-cube');
      expect(state.lastAchievementShown).toBe('first-cube');
      expect(state.showAchievementToast).toBe(true);
    });

    it('should not unlock duplicate achievement', () => {
      const { unlockAchievement } = useOnboardingStore.getState();

      unlockAchievement('first-cube');
      unlockAchievement('first-cube');

      const state = useOnboardingStore.getState();
      expect(state.unlockedAchievements).toEqual(['first-cube']);
    });

    it('should unlock multiple achievements', () => {
      const { unlockAchievement } = useOnboardingStore.getState();

      unlockAchievement('first-cube');
      unlockAchievement('first-light');

      const state = useOnboardingStore.getState();
      expect(state.unlockedAchievements).toHaveLength(2);
      expect(state.lastAchievementShown).toBe('first-light');
    });

    it('should dismiss achievement toast', () => {
      const { unlockAchievement, dismissAchievementToast } = useOnboardingStore.getState();

      unlockAchievement('first-cube');
      dismissAchievementToast();

      const state = useOnboardingStore.getState();
      expect(state.showAchievementToast).toBe(false);
      expect(state.unlockedAchievements).toContain('first-cube');
    });
  });

  describe('UI State', () => {
    it('should show onboarding panel', () => {
      const { setShowOnboardingPanel } = useOnboardingStore.getState();

      setShowOnboardingPanel(true);

      const state = useOnboardingStore.getState();
      expect(state.showOnboardingPanel).toBe(true);
    });

    it('should hide onboarding panel', () => {
      const { setShowOnboardingPanel } = useOnboardingStore.getState();

      setShowOnboardingPanel(true);
      setShowOnboardingPanel(false);

      const state = useOnboardingStore.getState();
      expect(state.showOnboardingPanel).toBe(false);
    });

    it('should dismiss whats new', () => {
      useOnboardingStore.setState({ showWhatsNew: true });

      const { dismissWhatsNew } = useOnboardingStore.getState();
      dismissWhatsNew();

      const state = useOnboardingStore.getState();
      expect(state.showWhatsNew).toBe(false);
    });
  });

  describe('Returning User Detection', () => {
    it('should record first visit', () => {
      const { recordVisit } = useOnboardingStore.getState();
      const nowBefore = Date.now();

      recordVisit();

      const state = useOnboardingStore.getState();
      const nowAfter = Date.now();

      expect(state.lastVisitTimestamp).toBeGreaterThanOrEqual(nowBefore);
      expect(state.lastVisitTimestamp).toBeLessThanOrEqual(nowAfter);
      expect(state.isNewUser).toBe(false);
      expect(state.showWhatsNew).toBe(false);
    });

    it('should show whats new after 7 days', () => {
      const { recordVisit } = useOnboardingStore.getState();

      // Set last visit to 8 days ago
      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
      useOnboardingStore.setState({ lastVisitTimestamp: eightDaysAgo });

      recordVisit();

      const state = useOnboardingStore.getState();
      expect(state.showWhatsNew).toBe(true);
      expect(state.isNewUser).toBe(false);
    });

    it('should not show whats new for recent visit', () => {
      const { recordVisit } = useOnboardingStore.getState();

      // Set last visit to 5 days ago
      const fiveDaysAgo = Date.now() - 5 * 24 * 60 * 60 * 1000;
      useOnboardingStore.setState({ lastVisitTimestamp: fiveDaysAgo });

      recordVisit();

      const state = useOnboardingStore.getState();
      expect(state.showWhatsNew).toBe(false);
    });

    it('should update timestamp on subsequent visits', () => {
      const { recordVisit } = useOnboardingStore.getState();

      const firstTimestamp = Date.now() - 10000;
      useOnboardingStore.setState({ lastVisitTimestamp: firstTimestamp });

      recordVisit();

      const state = useOnboardingStore.getState();
      expect(state.lastVisitTimestamp).toBeGreaterThan(firstTimestamp);
    });
  });

  describe('Edge Cases', () => {
    it('should handle advanceTutorial without starting tutorial', () => {
      const { advanceTutorial } = useOnboardingStore.getState();

      advanceTutorial();

      const state = useOnboardingStore.getState();
      expect(state.tutorialStep).toBe(1);
    });

    it('should handle completing same task multiple times', () => {
      const { completeTask } = useOnboardingStore.getState();

      completeTask('create-cube');
      completeTask('create-cube');

      const state = useOnboardingStore.getState();
      expect(state.basicTasks['create-cube']).toBe(true);
    });

    it('should handle empty tip id', () => {
      const { dismissTip } = useOnboardingStore.getState();

      dismissTip('');

      const state = useOnboardingStore.getState();
      expect(state.dismissedTips).toContain('');
    });

    it('should handle empty achievement id', () => {
      const { unlockAchievement } = useOnboardingStore.getState();

      unlockAchievement('');

      const state = useOnboardingStore.getState();
      expect(state.unlockedAchievements).toContain('');
    });
  });
});
