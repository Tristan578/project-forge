/**
 * Render tests for OnboardingChecklist component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@/test/utils/componentTestUtils';
import { OnboardingChecklist } from '../OnboardingChecklist';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useEditorStore as _useEditorStore } from '@/stores/editorStore';
import { useChatStore } from '@/stores/chatStore';

vi.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: Object.assign(vi.fn(() => ({})), {
    getState: vi.fn(() => ({})),
    subscribe: vi.fn(() => vi.fn()), // returns unsubscribe function
  }),
}));

vi.mock('@/stores/chatStore', () => ({
  useChatStore: {
    getState: vi.fn(() => ({ messages: [] })),
  },
}));

vi.mock('lucide-react', () => ({
  CheckCircle2: (props: Record<string, unknown>) => <span data-testid="check-circle" {...props} />,
  Circle: (props: Record<string, unknown>) => <span data-testid="circle" {...props} />,
  ChevronDown: (props: Record<string, unknown>) => <span data-testid="chevron-down" {...props} />,
  ChevronUp: (props: Record<string, unknown>) => <span data-testid="chevron-up" {...props} />,
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Trophy: (props: Record<string, unknown>) => <span data-testid="trophy-icon" {...props} />,
}));

describe('OnboardingChecklist', () => {
  function setupStore(tutorialCompleted: Record<string, boolean> = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useOnboardingStore).mockImplementation((selector: any) => {
      const state = { tutorialCompleted };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // clearAllMocks keeps implementations, so restore the defaults a test may
    // have replaced.
    vi.mocked(useChatStore.getState).mockImplementation(() => ({ messages: [] }) as never);
    vi.mocked(_useEditorStore.getState).mockImplementation(() => ({}) as never);
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('returns null when dismissed (localStorage)', () => {
    localStorage.setItem('forge-checklist-dismissed', '1');
    setupStore();
    const { container } = render(<OnboardingChecklist />);
    expect(container.firstChild).toBeNull();
  });

  it('renders "Getting Started" heading when not dismissed', () => {
    setupStore();
    render(<OnboardingChecklist />);
    expect(screen.getByText('Getting Started')).toBeInTheDocument();
  });

  it('renders Progress label', () => {
    setupStore();
    render(<OnboardingChecklist />);
    expect(screen.getByText('Progress')).toBeInTheDocument();
  });

  it('renders Basics section', () => {
    setupStore();
    render(<OnboardingChecklist />);
    expect(screen.getByText('Basics')).toBeInTheDocument();
  });

  it('renders Advanced section', () => {
    setupStore();
    render(<OnboardingChecklist />);
    expect(screen.getByText('Advanced')).toBeInTheDocument();
  });

  it('shows "Locked" badge on Advanced when basics not complete', () => {
    setupStore();
    render(<OnboardingChecklist />);
    expect(screen.getByText('Locked')).toBeInTheDocument();
  });

  it('renders checklist task titles', () => {
    setupStore();
    render(<OnboardingChecklist />);
    expect(screen.getByText('Create Your First Entity')).toBeInTheDocument();
    expect(screen.getByText('Write a Script')).toBeInTheDocument();
  });

  it('dismisses checklist when X button is clicked', () => {
    setupStore();
    render(<OnboardingChecklist />);
    fireEvent.click(screen.getByTestId('x-icon').closest('button')!);
    expect(screen.queryByText('Getting Started')).toBeNull();
  });

  it('stores dismiss in localStorage', () => {
    setupStore();
    render(<OnboardingChecklist />);
    fireEvent.click(screen.getByTestId('x-icon').closest('button')!);
    expect(localStorage.getItem('forge-checklist-dismissed')).toBe('1');
  });

  it('collapses content when collapse button is clicked', () => {
    setupStore();
    render(<OnboardingChecklist />);
    fireEvent.click(screen.getByTitle('Collapse'));
    expect(screen.queryByText('Progress')).toBeNull();
  });

  it('expands content again after clicking collapse twice', () => {
    setupStore();
    render(<OnboardingChecklist />);
    fireEvent.click(screen.getByTitle('Collapse'));
    fireEvent.click(screen.getByTitle('Expand'));
    expect(screen.getByText('Progress')).toBeInTheDocument();
  });

  it('shows task count as 0/13 by default', () => {
    setupStore();
    render(<OnboardingChecklist />);
    expect(screen.getByText('0 / 13')).toBeInTheDocument();
  });

  // Every test above renders against a store whose `subscribe` captures the
  // listener and never calls it, so no `checkCompletion` predicate had ever
  // run. That is the half of this component that reads editor state — the half
  // where a rename of a store field turns a checklist item into a thrown
  // TypeError that unmounts the panel.
  describe('task completion', () => {
    /** Push a state snapshot through the subscription the component registers. */
    function emitState(over: Record<string, unknown> = {}) {
      const subscribe = vi.mocked(_useEditorStore.subscribe);
      const listener = subscribe.mock.calls.at(-1)?.[0] as (s: unknown) => void;
      expect(listener).toBeDefined();

      act(() => {
        listener({
          nodeCount: 1,
          primaryMaterial: null,
          physicsEnabled: false,
          allScripts: {},
          cloudSaveStatus: 'idle',
          particleEnabled: false,
          entityAudio: {},
          hudElements: [],
          primaryAnimationClip: null,
          projectId: null,
          orchestratorStatus: 'idle',
          ...over,
        });
      });
    }

    it('completes the audio task when any entity carries audio', () => {
      // The store holds a map of entity → AudioData now, not one component, so
      // the predicate has to count the map rather than read a single field.
      setupStore();
      render(<OnboardingChecklist />);

      emitState({ entityAudio: { 'ent-1': { assetId: 'asset-1' } } });

      expect(screen.getByText('1 / 13')).toBeInTheDocument();
    });

    it('leaves the audio task incomplete when no entity carries audio', () => {
      setupStore();
      render(<OnboardingChecklist />);

      emitState({ entityAudio: {} });

      expect(screen.getByText('0 / 13')).toBeInTheDocument();
    });

    it('survives a snapshot with no entityAudio at all', () => {
      // A checklist item must never be able to take down the panel that renders
      // it: `Object.keys(undefined)` throws, and this predicate runs against
      // whatever snapshot the subscription hands it.
      setupStore();
      render(<OnboardingChecklist />);

      expect(() => emitState({ entityAudio: undefined })).not.toThrow();
      expect(screen.getByText('0 / 13')).toBeInTheDocument();
    });

    it('counts several completed tasks together', () => {
      setupStore();
      render(<OnboardingChecklist />);

      emitState({
        nodeCount: 3,
        physicsEnabled: true,
        entityAudio: { 'ent-1': { assetId: 'asset-1' } },
      });

      expect(screen.getByText('3 / 13')).toBeInTheDocument();
    });

    // #10170: the first AI-built game. Completion is rebuilt from each snapshot,
    // so the status alone would untick the task when the next run starts; the
    // FIRST_AI_GENERATION record (written by useCelebrations) keeps it ticked.
    describe('"Build a Game with AI"', () => {
      const recordFirstAiGeneration = () =>
        localStorage.setItem(
          'spawnforge-celebrated-milestones',
          JSON.stringify(['FIRST_AI_GENERATION']),
        );

      it('ticks when a run completes', () => {
        setupStore();
        render(<OnboardingChecklist />);

        emitState({ orchestratorStatus: 'completed' });

        expect(screen.getByText('1 / 13')).toBeInTheDocument();
      });

      it.each([['failed'], ['cancelled'], ['executing']])(
        'stays unticked when the run is %s',
        (status) => {
          setupStore();
          render(<OnboardingChecklist />);

          emitState({ orchestratorStatus: status });

          expect(screen.getByText('0 / 13')).toBeInTheDocument();
        },
      );

      it('stays ticked when a new run starts once the milestone is recorded', () => {
        setupStore();
        render(<OnboardingChecklist />);
        emitState({ orchestratorStatus: 'completed' });
        recordFirstAiGeneration();

        emitState({ orchestratorStatus: 'decomposing' });

        expect(screen.getByText('1 / 13')).toBeInTheDocument();
      });

      it('would untick on the next run without the record: the status alone is not enough', () => {
        setupStore();
        render(<OnboardingChecklist />);
        emitState({ orchestratorStatus: 'completed' });

        emitState({ orchestratorStatus: 'decomposing' });

        expect(screen.getByText('0 / 13')).toBeInTheDocument();
      });
    });

    // #10170 review: "Build a Game with AI" joined Basics after users had
    // already unlocked Advanced with the six original tasks. Nothing about the
    // unlock is persisted — it is recomputed from live state — so counting the
    // new task in the gate would re-lock Advanced for every one of them.
    describe('Advanced unlock', () => {
      /**
       * Satisfy the six original basics, with no AI build ever completed. Two of
       * them read other stores rather than the snapshot: "Use AI Chat" reads the
       * chat history and "Export Your Game" reads `useEditorStore.getState()`.
       */
      function completeSixOriginalBasics(over: Record<string, unknown> = {}) {
        vi.mocked(useChatStore.getState).mockImplementation(
          () => ({ messages: [{ role: 'user', content: 'hi' }] }) as never,
        );
        vi.mocked(_useEditorStore.getState).mockImplementation(
          () => ({ cloudSaveStatus: 'saved' }) as never,
        );
        emitState({
          nodeCount: 3,
          primaryMaterial: { baseColor: [1, 0, 0, 1] },
          physicsEnabled: true,
          allScripts: { s1: { source: 'x'.repeat(60) } },
          cloudSaveStatus: 'saved',
          ...over,
        });
      }

      /** A section's "done/total" count: JSX splits it across text nodes. */
      const sectionCount = (text: string) =>
        screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === text);

      it('stays unlocked for a user with the six original basics and no AI build', () => {
        setupStore();
        render(<OnboardingChecklist />);

        completeSixOriginalBasics();

        // Basics reads 6 of 7 — the AI task is still offered, just not a gate.
        expect(sectionCount('6/7')).toBeInTheDocument();
        expect(screen.queryByText('Locked')).toBeNull();
        expect(sectionCount('0/6')).toBeInTheDocument();
      });

      it('stays locked when an AI build stands in for one of the original basics', () => {
        // A new user still has to do the original basics: the AI task is not a
        // substitute for any of them.
        setupStore();
        render(<OnboardingChecklist />);

        completeSixOriginalBasics({ physicsEnabled: false, orchestratorStatus: 'completed' });

        expect(sectionCount('6/7')).toBeInTheDocument();
        expect(screen.getByText('Locked')).toBeInTheDocument();
      });

      it('is locked for a brand-new user with nothing done', () => {
        setupStore();
        render(<OnboardingChecklist />);

        emitState();

        expect(sectionCount('0/7')).toBeInTheDocument();
        expect(screen.getByText('Locked')).toBeInTheDocument();
      });
    });

    it('drops a task back to incomplete when the state that satisfied it goes away', () => {
      // The listener rebuilds the whole set rather than adding to it, so an
      // undo has to be able to un-complete a task.
      setupStore();
      render(<OnboardingChecklist />);

      emitState({ entityAudio: { 'ent-1': { assetId: 'asset-1' } } });
      expect(screen.getByText('1 / 13')).toBeInTheDocument();

      emitState({ entityAudio: {} });
      expect(screen.getByText('0 / 13')).toBeInTheDocument();
    });
  });
});
