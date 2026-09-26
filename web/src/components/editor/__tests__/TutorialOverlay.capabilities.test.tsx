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
import { HelpMenu } from '../HelpMenu';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useEditorStore, setCommandDispatcher } from '@/stores/editorStore';
import { TUTORIAL_CAPABILITIES, TUTORIALS } from '@/data/tutorials';
import userEvent from '@testing-library/user-event';

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
  // it and clamped back up covered the very control it pointed at. Above it,
  // the bubble is anchored by its BOTTOM edge 16px over the target, so no
  // bubble height, guessed or real, can reach the button.
  it('anchors the bubble above a target docked at the bottom, by its bottom edge', () => {
    const viewportH = window.innerHeight;
    const targetTop = viewportH - 46;
    RECTS['quick-start-trigger'] = { left: 100, top: targetTop, width: 44, height: 44 };
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
      expect(bubble.style.bottom).toBe(`${viewportH - targetTop + 16}px`);
      expect(bubble.style.top).toBe('');
      // Capped to the room above, so it cannot run off the top either.
      expect(bubble.style.maxHeight).toBe(`${targetTop - 16 - 16}px`);
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

  // The intro card has no target, so nothing else re-renders it on resize: a
  // rotation to portrait must still re-fit it or Next and Skip end up off-screen.
  it('re-fits the untargeted intro card when the window is resized', () => {
    const original = window.innerWidth;
    try {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
      render(<TutorialOverlay />);
      startTour();
      const bubble = screen.getByTestId('tutorial-bubble');
      expect(bubble.style.width).toBe('400px');

      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });

      expect(bubble.style.width).toBe(`${320 - 32}px`);
      expect(bubble.style.left).toBe('16px');
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

// The intro promises "This tour only points at things". A highlight ring the
// pointer passes straight through, or a Tab order that walks out of the bubble
// onto the highlighted control, would let one stray click start a real Quick
// Start flow, enter play mode or download an export.
describe('capabilities tour blocks the controls it points at (#10171)', () => {
  function SpiedTargets({ onActivate }: { onActivate: (id: string) => void }) {
    const place = (id: string) => (el: HTMLElement | null) => {
      if (el) el.getBoundingClientRect = () => rectOf(id);
    };
    return (
      <>
        {Object.keys(RECTS).map((id) => (
          <button key={id} type="button" data-testid={id} ref={place(id)} onClick={() => onActivate(id)}>
            {id}
          </button>
        ))}
      </>
    );
  }

  it('a click on each highlighted control does not reach it', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(
      <>
        <SpiedTargets onActivate={onActivate} />
        <TutorialOverlay />
      </>,
    );
    startTour();
    next();

    for (const id of ['quick-start-trigger', 'play-controls-play', 'scene-toolbar-export']) {
      const highlight = screen.getByTestId('tutorial-highlight');
      expect(highlight.style.left).toBe(`${RECTS[id]!.left - 8}px`);
      expect(screen.getByTestId('tutorial-backdrop').className).toContain('pointer-events-auto');
      expect(highlight.className).toContain('pointer-events-auto');

      await user.click(screen.getByTestId(id));
      fireEvent.click(screen.getByTestId(id));
      expect(onActivate).not.toHaveBeenCalled();
      next();
    }
    expect(useOnboardingStore.getState().tutorialCompleted.capabilities).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('Tab and Shift+Tab stay inside the bubble and never land on the highlighted control', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(
      <>
        <SpiedTargets onActivate={onActivate} />
        <TutorialOverlay />
      </>,
    );
    startTour();
    next();
    next(); // the Play step
    expect(screen.getByText(TITLES[2] ?? '', { selector: 'h3' })).toBeInTheDocument();

    const bubble = screen.getByTestId('tutorial-bubble');
    const seen = new Set<Element | null>();
    for (let i = 0; i < 6; i++) {
      await user.tab();
      seen.add(document.activeElement);
      expect(bubble.contains(document.activeElement)).toBe(true);
    }
    for (let i = 0; i < 6; i++) {
      await user.tab({ shift: true });
      seen.add(document.activeElement);
      expect(bubble.contains(document.activeElement)).toBe(true);
    }
    // It really cycles through the bubble's three buttons.
    expect(seen.size).toBe(3);

    // Even with focus forced onto the control, Enter does not activate it.
    screen.getByTestId('play-controls-play').focus();
    await user.keyboard('{Enter}');
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('gives the page back once the tour ends', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(
      <>
        <SpiedTargets onActivate={onActivate} />
        <TutorialOverlay />
      </>,
    );
    startTour();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('tutorial-backdrop')).toBeNull();

    await user.click(screen.getByTestId('play-controls-play'));
    expect(onActivate).toHaveBeenCalledWith('play-controls-play');
  });

  // The older tutorials ask the user to press the real control; those steps
  // must still let the click through, exactly as before.
  it('an action-required step in another tutorial still lets the click and Tab through', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    render(
      <>
        <button type="button" aria-label="Play" onClick={onPlay} />
        <TutorialOverlay />
      </>,
    );
    const steps = TUTORIALS.find((t) => t.id === 'first-scene')!.steps;
    const pressPlay = steps.findIndex((s) => s.id === 'press-play');
    expect(steps[pressPlay]!.actionRequired).toBeTruthy();
    act(() => {
      useOnboardingStore.setState({ activeTutorial: 'first-scene', tutorialStep: pressPlay });
    });

    expect(screen.getByTestId('tutorial-backdrop').className).toContain('pointer-events-none');
    expect(screen.getByTestId('tutorial-highlight').className).toContain('pointer-events-none');
    expect(screen.getByTestId('tutorial-bubble').getAttribute('aria-modal')).toBeNull();

    const play = screen.getByRole('button', { name: 'Play' });
    await user.click(play);
    expect(onPlay).toHaveBeenCalledTimes(1);

    let reached = false;
    for (let i = 0; i < 6 && !reached; i++) {
      await user.tab();
      reached = document.activeElement === play;
    }
    expect(reached).toBe(true);
  });
});

describe('capabilities tour accessibility (#10171)', () => {
  function nextButton() {
    return screen.getByRole('button', { name: /^(Next|Complete)$/ });
  }

  // Modal because it is: a highlight-only step blocks the page behind it.
  it('is a modal dialog named by the step title and described by its text and keys', () => {
    render(
      <>
        <Targets />
        <TutorialOverlay />
      </>,
    );
    startTour();

    const dialog = screen.getByRole('dialog', { name: TITLES[0] });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog).toHaveAccessibleDescription(
      expect.stringContaining(TUTORIAL_CAPABILITIES.steps[0]!.description),
    );
    // The keyboard shortcuts are visible and part of the description.
    const hint = screen.getByTestId('tutorial-key-hint');
    expect(hint).toBeVisible();
    expect(hint.textContent).toMatch(/Right arrow.*Left arrow.*Esc/);
    expect(dialog).toHaveAccessibleDescription(expect.stringContaining(hint.textContent ?? '---'));

    next();
    expect(screen.getByRole('dialog', { name: TITLES[1] })).toBeInTheDocument();
  });

  it('moves focus to Next when the tour starts and again on every step', () => {
    render(
      <>
        <Targets />
        <TutorialOverlay />
      </>,
    );
    startTour();
    expect(document.activeElement).toBe(nextButton());

    // The user clicks into the editor mid-tour; the next step takes focus back.
    screen.getByTestId('play-controls-play').focus();
    expect(document.activeElement).not.toBe(nextButton());
    next();
    expect(screen.getByText(TITLES[1] ?? '', { selector: 'h3' })).toBeInTheDocument();
    expect(document.activeElement).toBe(nextButton());
  });

  it('announces each new step in a polite status region', () => {
    render(
      <>
        <Targets />
        <TutorialOverlay />
      </>,
    );
    startTour();
    next();

    const live = screen.getByTestId('tutorial-live');
    expect(live.getAttribute('role')).toBe('status');
    expect(live.textContent).toBe(
      `Step 2 of ${TITLES.length}: ${TITLES[1]}. ${TUTORIAL_CAPABILITIES.steps[1]!.description}`,
    );
  });

  // The real launch path: HelpMenu's close() puts focus back on the Help button
  // and only then starts the tour. The tour must take focus from there, and
  // hand it back when it ends.
  it('takes focus from the Help menu and returns it to the Help button on Escape', () => {
    render(
      <>
        <HelpMenu onOpenShortcuts={() => {}} onOpenFeedback={() => {}} />
        <Targets />
        <TutorialOverlay />
      </>,
    );
    const help = screen.getByRole('button', { name: 'Help menu' });
    fireEvent.click(help);
    fireEvent.click(screen.getByRole('menuitem', { name: 'What can SpawnForge do?' }));

    expect(useOnboardingStore.getState().activeTutorial).toBe('capabilities');
    expect(document.activeElement).toBe(nextButton());

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(help);
  });
});
