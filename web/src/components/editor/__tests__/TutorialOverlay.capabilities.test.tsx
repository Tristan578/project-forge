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

/** The three controls the tour points at, as the editor renders them. */
function Targets() {
  return (
    <>
      <button type="button" data-testid="quick-start-trigger">
        Make me a game
      </button>
      <button type="button" aria-label="Play" />
      <button type="button" aria-label="Export game" />
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

  it('highlights each control it points at while it is on screen', () => {
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
    for (let i = 1; i < TITLES.length; i += 1) {
      expect(screen.getByTestId('tutorial-highlight')).toBeInTheDocument();
      next();
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
