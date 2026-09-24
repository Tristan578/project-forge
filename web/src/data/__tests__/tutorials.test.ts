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
  '[data-testid="play-controls-play"]',
  '[data-testid="scene-toolbar-export"]',
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

  // The tour's promise is showing what costs tokens before anyone spends them.
  // The compact route to export is an AI chat message, which /api/chat charges
  // up front, and export_game can write an HTML file or a zip but never embed
  // code. Only the Export dialog offers embed code.
  it('says the compact export route is an AI chat message that uses tokens, and promises no embed code there', () => {
    const description = TUTORIAL_CAPABILITIES.steps.find((s) => s.id === 'export')?.description ?? '';
    const at = description.indexOf('small screen');
    expect(at).toBeGreaterThan(0);
    const compact = description.slice(at);
    expect(compact).toMatch(/AI chat/);
    expect(compact).toMatch(/uses tokens/);
    expect(compact).toMatch(/HTML file or a zip/);
    expect(compact).not.toMatch(/embed/i);
  });
});

// Each target is a dedicated data-testid, so no other control can match it.
// That the owning component renders it exactly once is pinned where it
// renders: PlayControls.test.tsx (edit AND paused), SceneToolbar.test.tsx, and
// EditorLayout.quickStart.test.tsx for the quick-start trigger on both layouts.
// No test here proves uniqueness across the whole editor tree.
