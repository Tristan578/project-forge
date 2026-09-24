/**
 * The "What can SpawnForge do?" tour (#10171) against the REAL onboarding and
 * editor stores and the REAL tutorial registry. The sibling
 * TutorialOverlay.test.tsx mocks all three, which is right for the overlay's
 * mechanics but could not show that this tour spends nothing and changes
 * nothing.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@/test/utils/componentTestUtils';
import { TutorialOverlay } from '../TutorialOverlay';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useEditorStore, setCommandDispatcher } from '@/stores/editorStore';
import { TUTORIAL_CAPABILITIES } from '@/data/tutorials';

const TITLES = TUTORIAL_CAPABILITIES.steps.map((s) => s.title);

/** Distinct rects per control, so a highlight on the wrong one is visible. */
const RECTS: Record<string, { left: number; top: number; width: number; height: number }> = {
  'quick-start-trigger': { left: 100, top: 20, width: 120, height: 32 },
  'play-controls-play': { left: 400, top: 24, width: 24, height: 24 },
  'scene-toolbar-export': { left: 700, top: 24, width: 24, height: 24 },
};

function rectOf(id: string): DOMRect {
  const r = RECTS[id]!;
  return {
    ...r,
    x: r.left,
    y: r.top,
    right: r.left + r.width,
    bottom: r.top + r.height,
    toJSON: () => r,
  } as DOMRect;
}

/** The three controls the tour points at, each with its own position. */
function Targets() {
  const place = (id: string) => (el: HTMLElement | null) => {
    if (el) el.getBoundingClientRect = () => rectOf(id);
  };
  return (
    <>
      <button type="button" data-testid="quick-start-trigger" ref={place('quick-start-trigger')}>
        Make me a game
      </button>
      <button type="button" data-testid="play-controls-play" ref={place('play-controls-play')} />
      <button type="button" data-testid="scene-toolbar-export" ref={place('scene-toolbar-export')} />
    </>
  );
}

function startTour() {
  act(() => {
    useOnboardingStore.getState().startTutorial('capabilities');
  });
}

function next() {
  fireEvent.click(screen.getByRole('button', { name: /^(Next|Complete)$/ }));
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
const dispatch = vi.fn();

beforeEach(() => {
  localStorage.clear();
  useOnboardingStore.setState({ activeTutorial: null, tutorialStep: 0, tutorialCompleted: {} });
  useEditorStore.setState({ sceneModified: false });
  dispatch.mockReset();
  setCommandDispatcher(dispatch);
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  cleanup();
  fetchSpy.mockRestore();
  useOnboardingStore.setState({ activeTutorial: null, tutorialStep: 0, tutorialCompleted: {} });
  localStorage.clear();
});

describe('capabilities tour (#10171)', () => {
  it('runs to its last step with no request, no engine command and no scene change', () => {
    const sceneBefore = useEditorStore.getState().sceneGraph;
    render(
      <>
        <Targets />
        <TutorialOverlay />
      </>,
    );
    startTour();

    for (const title of TITLES) {
      expect(screen.getByText(title, { selector: 'h3' })).toBeInTheDocument();
      next();
    }

    expect(useOnboardingStore.getState().activeTutorial).toBeNull();
    expect(useOnboardingStore.getState().tutorialCompleted.capabilities).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(useEditorStore.getState().sceneModified).toBe(false);
    expect(useEditorStore.getState().sceneGraph).toBe(sceneBefore);
  });

  it('highlights exactly the control each step points at', () => {
    render(
      <>
        <Targets />
        <TutorialOverlay />
      </>,
    );
    startTour();

    // Intro card: nothing to point at.
    expect(screen.queryByTestId('tutorial-highlight')).toBeNull();
    next();
    for (const id of ['quick-start-trigger', 'play-controls-play', 'scene-toolbar-export']) {
      const r = RECTS[id]!;
      const highlight = screen.getByTestId('tutorial-highlight');
      // The ring is drawn 8px outside the control.
      expect(highlight.style.left).toBe(`${r.left - 8}px`);
      expect(highlight.style.top).toBe(`${r.top - 8}px`);
      next();
    }
  });

  // Compact docks the quick-start trigger at the bottom. A bubble placed below
  // it and clamped back up covered the very control it pointed at.
  it('puts the bubble above a target docked at the bottom, not over it', () => {
    const viewportH = window.innerHeight;
    RECTS['quick-start-trigger'] = { left: 100, top: viewportH - 46, width: 44, height: 44 };
    try {
      render(
        <>
          <Targets />
          <TutorialOverlay />
        </>,
      );
      startTour();
      next();

      const bubble = screen.getByTestId('tutorial-bubble');
      const bubbleTop = parseFloat(bubble.style.top);
      // Its reserved 216px ends above the button.
      expect(bubbleTop + 216).toBeLessThanOrEqual(viewportH - 46);
    } finally {
      RECTS['quick-start-trigger'] = { left: 100, top: 20, width: 120, height: 32 };
    }
  });

  it('fits a 320px-wide screen', () => {
    const original = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    try {
      render(<TutorialOverlay />);
      startTour();

      const bubble = screen.getByTestId('tutorial-bubble');
      const left = parseFloat(bubble.style.left);
      const width = parseFloat(bubble.style.width);
      expect(left).toBeGreaterThanOrEqual(16);
      expect(left + width).toBeLessThanOrEqual(320 - 16);
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: original });
    }
  });

  // The compact layout renders no Export control (and, depending on width, may
  // lack others). A missing target must never strand the user.
  it('shows each step as a plain card that Next still advances when its target is absent', () => {
    render(<TutorialOverlay />);
    startTour();

    for (const title of TITLES) {
      expect(screen.getByText(title, { selector: 'h3' })).toBeInTheDocument();
      expect(screen.queryByTestId('tutorial-highlight')).toBeNull();
      const button = screen.getByRole('button', { name: /^(Next|Complete)$/ });
      expect(button).toHaveProperty('disabled', false);
      next();
    }

    expect(useOnboardingStore.getState().tutorialCompleted.capabilities).toBe(true);
  });

  it('ends through skip on Escape at step 2, records nothing, and can start again', () => {
    render(
      <>
        <Targets />
        <TutorialOverlay />
      </>,
    );
    startTour();
    next();
    expect(screen.getByText(TITLES[1] ?? '', { selector: 'h3' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(useOnboardingStore.getState().activeTutorial).toBeNull();
    expect(useOnboardingStore.getState().tutorialCompleted.capabilities).toBeUndefined();

    startTour();
    expect(screen.getByText(TITLES[0] ?? '', { selector: 'h3' })).toBeInTheDocument();
  });
});
