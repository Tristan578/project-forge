/**
 * The tutorial registry's contract for the highlight-only capabilities tour
 * (#10171): what it points at, in what order, that it never asks the user to
 * act, and whether finishing it counts as onboarding.
 */

import { describe, it, expect } from 'vitest';
import {
  TUTORIALS,
  TUTORIAL_CAPABILITIES,
  tutorialCompletesOnboarding,
} from '../tutorials';

const TARGETS = [
  '[data-testid="quick-start-trigger"]',
  '[aria-label="Play"]',
  '[aria-label="Export game"]',
];

describe('TUTORIAL_CAPABILITIES', () => {
  it('is registered under the id the Help menu starts', () => {
    expect(TUTORIALS.find((t) => t.id === 'capabilities')).toBe(TUTORIAL_CAPABILITIES);
  });

  it('points at AI building, Play and Export, in that order', () => {
    const targets = TUTORIAL_CAPABILITIES.steps.map((s) => s.target).filter(Boolean);
    expect(targets).toEqual(TARGETS);
  });

  // Non-destructive by construction: a step with `actionRequired` waits for the
  // user to change the editor, and Next stays disabled until they do.
  it('asks the user to do nothing: no step requires an action or auto-advances', () => {
    expect(TUTORIAL_CAPABILITIES.steps.length).toBeGreaterThan(0);
    for (const step of TUTORIAL_CAPABILITIES.steps) {
      expect(step.actionRequired).toBeUndefined();
      expect(step.autoAdvance).toBeUndefined();
    }
  });

  it('does not count as finishing onboarding, while the hands-on tutorials still do', () => {
    expect(tutorialCompletesOnboarding('capabilities')).toBe(false);
    for (const t of TUTORIALS.filter((x) => x.id !== 'capabilities')) {
      expect(tutorialCompletesOnboarding(t.id)).toBe(true);
    }
    // A completion recorded by an older build for an id no longer registered
    // keeps its historical meaning.
    expect(tutorialCompletesOnboarding('retired-tutorial')).toBe(true);
  });
});

// That each selector matches exactly ONE rendered control is pinned where the
// control renders: PlayControls.test.tsx and SceneToolbar.test.tsx, and
// EditorLayout.quickStart.test.tsx for the quick-start trigger on both layouts.
