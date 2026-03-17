/**
 * Milestone tracking and celebration data.
 *
 * Each milestone fires at most once per user session, tracked in localStorage.
 * Multiple simultaneous milestones are queued rather than overlaid.
 */

export const MILESTONE_STORAGE_KEY = 'spawnforge-celebrated-milestones';

export type MilestoneId =
  | 'FIRST_ENTITY'
  | 'FIRST_SCENE'
  | 'FIRST_PLAY'
  | 'FIRST_PUBLISH'
  | 'FIRST_AI_GENERATION'
  | 'ENTITY_COUNT_50'
  | 'ENTITY_COUNT_100';

export interface CelebrationData {
  title: string;
  message: string;
}

const MILESTONE_DATA: Record<MilestoneId, CelebrationData> = {
  FIRST_ENTITY: {
    title: 'First entity created!',
    message: "You've placed your first object in the scene. Your game world is taking shape.",
  },
  FIRST_SCENE: {
    title: 'First scene saved!',
    message: "Your scene is saved and ready. You're building something real.",
  },
  FIRST_PLAY: {
    title: 'First playtest!',
    message: "You pressed Play — and your game ran. That feeling never gets old.",
  },
  FIRST_PUBLISH: {
    title: 'Game published!',
    message: "Your game is live and shareable. You're officially a game developer.",
  },
  FIRST_AI_GENERATION: {
    title: 'First AI generation!',
    message: "You collaborated with AI to build something. This is the future of game creation.",
  },
  ENTITY_COUNT_50: {
    title: '50 entities!',
    message: "Your scene is growing. Keep building — the best games have layers.",
  },
  ENTITY_COUNT_100: {
    title: '100 entities!',
    message: "A hundred objects in your world. That is a real game taking shape.",
  },
};

/**
 * Returns the set of milestone IDs that have already been celebrated.
 * Reads from localStorage; returns empty set if unavailable (SSR, private browsing).
 */
export function getCelebratedMilestones(): Set<MilestoneId> {
  try {
    const raw = localStorage.getItem(MILESTONE_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed as MilestoneId[]);
  } catch {
    return new Set();
  }
}

/**
 * Marks a milestone as having been celebrated so it never fires again.
 */
function markCelebrated(milestone: MilestoneId): void {
  try {
    const existing = getCelebratedMilestones();
    existing.add(milestone);
    localStorage.setItem(MILESTONE_STORAGE_KEY, JSON.stringify([...existing]));
  } catch {
    // localStorage unavailable — silently skip persistence
  }
}

/**
 * Returns true if this milestone has already been celebrated.
 */
export function hasCelebrated(milestone: MilestoneId): boolean {
  return getCelebratedMilestones().has(milestone);
}

/**
 * Checks whether a milestone should trigger a celebration.
 *
 * If this is the first time the milestone is reached, marks it as celebrated
 * and returns the associated CelebrationData. Returns null if already shown.
 */
export function checkMilestone(milestone: MilestoneId): CelebrationData | null {
  if (hasCelebrated(milestone)) return null;
  markCelebrated(milestone);
  return MILESTONE_DATA[milestone];
}

/**
 * Resets all tracked milestones (used in tests and dev reset flows).
 */
export function resetMilestones(): void {
  try {
    localStorage.removeItem(MILESTONE_STORAGE_KEY);
  } catch {
    // ignore
  }
}
