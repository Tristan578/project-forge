/**
 * Tests for TutorialOverlay — rendering, step navigation, skip, complete,
 * action-required disabling, bubble positioning.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { TutorialOverlay } from '../TutorialOverlay';
import { useOnboardingStore } from '@/stores/onboardingStore';

vi.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: Object.assign(vi.fn(() => ({})), { subscribe: vi.fn(() => vi.fn()) }),
}));

vi.mock('@/data/tutorials', () => ({
  TUTORIALS: [
    {
      id: 'basics',
      name: 'Getting Started',
      steps: [
        { title: 'Welcome', description: 'Welcome to SpawnForge!', target: null, targetPosition: null, actionRequired: null, autoAdvance: false },
        { title: 'Select Entity', description: 'Click an entity in the viewport.', target: '[data-testid="viewport"]', targetPosition: 'bottom', actionRequired: { type: 'select-entity', value: null }, autoAdvance: true },
        { title: 'Done', description: 'You completed the tutorial!', target: null, targetPosition: null, actionRequired: null, autoAdvance: false },
      ],
    },
    {
      // One step per targetPosition, all pointing at the same stubbed element.
      id: 'placement',
      name: 'Placement',
      steps: ['top', 'bottom', 'left', 'right'].map((pos) => ({
        title: `Placed ${pos}`,
        description: 'Where does the bubble go?',
        target: '[data-testid="placement-target"]',
        targetPosition: pos,
        actionRequired: null,
        autoAdvance: false,
      })),
    },
  ],
}));

const mockAdvanceTutorial = vi.fn();
const mockRetreatTutorial = vi.fn();
const mockSkipTutorial = vi.fn();
const mockCompleteTutorial = vi.fn();

function setupStore(overrides: {
  activeTutorial?: string | null;
  tutorialStep?: number;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useOnboardingStore).mockImplementation((selector: any) => {
    const state = {
      activeTutorial: 'activeTutorial' in overrides ? overrides.activeTutorial : 'basics',
      tutorialStep: overrides.tutorialStep ?? 0,
      advanceTutorial: mockAdvanceTutorial,
      retreatTutorial: mockRetreatTutorial,
      skipTutorial: mockSkipTutorial,
      completeTutorial: mockCompleteTutorial,
    };
    return selector(state);
  });
}

describe('TutorialOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── No active tutorial ────────────────────────────────────────────────

  it('renders nothing when no active tutorial', () => {
    setupStore({ activeTutorial: null });
    const { container } = render(<TutorialOverlay />);
    expect(container.innerHTML).toBe('');
  });

  // ── Basic rendering ───────────────────────────────────────────────────

  it('renders step title and description', () => {
    setupStore();
    render(<TutorialOverlay />);
    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(screen.getByText('Welcome to SpawnForge!')).toBeInTheDocument();
  });

  it('renders step counter', () => {
    setupStore();
    render(<TutorialOverlay />);
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
  });

  it('renders step number badge', () => {
    setupStore();
    render(<TutorialOverlay />);
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders Next button on non-last step', () => {
    setupStore();
    render(<TutorialOverlay />);
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  it('renders Skip Tutorial button', () => {
    setupStore();
    render(<TutorialOverlay />);
    expect(screen.getByText('Skip Tutorial')).toBeInTheDocument();
  });

  // ── Navigation ────────────────────────────────────────────────────────

  it('advances tutorial on Next click', () => {
    setupStore();
    render(<TutorialOverlay />);
    fireEvent.click(screen.getByText('Next'));
    expect(mockAdvanceTutorial).toHaveBeenCalledOnce();
  });

  it('skips tutorial on Skip click', () => {
    setupStore();
    render(<TutorialOverlay />);
    fireEvent.click(screen.getByText('Skip Tutorial'));
    expect(mockSkipTutorial).toHaveBeenCalledOnce();
  });

  // The header X is a 44px target with its own accessible name, not a 24px
  // icon named only by a hover title.
  it('skips tutorial on the X button, which is a named 44px target', () => {
    setupStore();
    render(<TutorialOverlay />);
    const x = screen.getByRole('button', { name: 'Skip tutorial' });
    expect(x.getAttribute('aria-label')).toBe('Skip tutorial');
    expect(x.className.split(/\s+/)).toEqual(expect.arrayContaining(['min-h-11', 'min-w-11']));
    fireEvent.click(x);
    expect(mockSkipTutorial).toHaveBeenCalledOnce();
  });

  // ── Last step ─────────────────────────────────────────────────────────

  it('renders Complete button on last step', () => {
    setupStore({ tutorialStep: 2 });
    render(<TutorialOverlay />);
    expect(screen.getByText('Complete')).toBeInTheDocument();
  });

  it('completes tutorial on Complete click', () => {
    setupStore({ tutorialStep: 2 });
    render(<TutorialOverlay />);
    fireEvent.click(screen.getByText('Complete'));
    expect(mockCompleteTutorial).toHaveBeenCalledOnce();
  });

  it('renders last step title', () => {
    setupStore({ tutorialStep: 2 });
    render(<TutorialOverlay />);
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
  });

  // ── Action-required step ──────────────────────────────────────────────

  it('disables Next when action is required and not completed', () => {
    setupStore({ tutorialStep: 1 });
    render(<TutorialOverlay />);
    const nextBtn = screen.getByText('Next').closest('button');
    expect(nextBtn?.hasAttribute('disabled')).toBe(true);
  });

  it('renders action step content', () => {
    setupStore({ tutorialStep: 1 });
    render(<TutorialOverlay />);
    expect(screen.getByText('Select Entity')).toBeInTheDocument();
    expect(screen.getByText('Click an entity in the viewport.')).toBeInTheDocument();
  });

  // ── Backdrop ──────────────────────────────────────────────────────────

  it('renders backdrop overlay', () => {
    setupStore();
    render(<TutorialOverlay />);
    const backdrop = document.querySelector('.fixed.inset-0');
    expect(backdrop).not.toBeNull();
  });

  // ── Keyboard navigation ───────────────────────────────────────────────

  it('closes tutorial on Escape key', () => {
    setupStore();
    render(<TutorialOverlay />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockSkipTutorial).toHaveBeenCalledOnce();
  });

  it('advances tutorial on ArrowRight key (no action required)', () => {
    setupStore(); // step 0 has no actionRequired
    render(<TutorialOverlay />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(mockAdvanceTutorial).toHaveBeenCalledOnce();
  });

  it('does not advance on ArrowRight when action is required', () => {
    setupStore({ tutorialStep: 1 }); // step 1 has actionRequired
    render(<TutorialOverlay />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(mockAdvanceTutorial).not.toHaveBeenCalled();
  });

  it('completes tutorial on ArrowRight at last step', () => {
    setupStore({ tutorialStep: 2 }); // last step, no actionRequired
    render(<TutorialOverlay />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(mockCompleteTutorial).toHaveBeenCalledOnce();
  });

  it('retreats tutorial on ArrowLeft key when not on first step', () => {
    setupStore({ tutorialStep: 2 });
    render(<TutorialOverlay />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(mockRetreatTutorial).toHaveBeenCalledOnce();
  });

  it('does not retreat on ArrowLeft when on first step', () => {
    setupStore({ tutorialStep: 0 });
    render(<TutorialOverlay />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(mockRetreatTutorial).not.toHaveBeenCalled();
  });

  it('does not respond to keyboard when no tutorial active', () => {
    setupStore({ activeTutorial: null });
    render(<TutorialOverlay />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mockSkipTutorial).not.toHaveBeenCalled();
  });
});

// ── Bubble placement ────────────────────────────────────────────────────
//
// Every targeted step anchors the bubble to the side facing its target: `top`
// when the bubble is below (or beside) it, `bottom` when it is above, and caps
// it with max-height at the room on that side. So the no-overlap and
// stays-on-screen properties hold whatever height the bubble really renders at.

type Position = 'top' | 'bottom' | 'left' | 'right';
const STEP_OF: Record<Position, number> = { top: 0, bottom: 1, left: 2, right: 3 };
const EDGE = 16;
const GAP = 16;

describe('TutorialOverlay bubble placement', () => {
  const originalW = window.innerWidth;
  const originalH = window.innerHeight;

  afterEach(() => {
    cleanup();
    document.querySelectorAll('[data-testid="placement-target"]').forEach((el) => el.remove());
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalW });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalH });
  });

  function place(
    position: Position,
    r: { left: number; top: number; width: number; height: number },
    viewport: { w: number; h: number },
  ) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewport.w });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport.h });
    setupStore({ activeTutorial: 'placement', tutorialStep: STEP_OF[position] });
    const target = document.createElement('div');
    target.setAttribute('data-testid', 'placement-target');
    const right = r.left + r.width;
    const bottom = r.top + r.height;
    target.getBoundingClientRect = () =>
      ({ ...r, x: r.left, y: r.top, right, bottom, toJSON: () => r }) as DOMRect;
    document.body.appendChild(target);
    render(<TutorialOverlay />);
    const bubble = screen.getByTestId('tutorial-bubble');
    return {
      bubble,
      right,
      bottom,
      left: parseFloat(bubble.style.left),
      width: parseFloat(bubble.style.width),
      top: parseFloat(bubble.style.top),
      maxHeight: parseFloat(bubble.style.maxHeight),
    };
  }

  // clampLeft doing real work: centred on this target the bubble would start at
  // 164px and end at 452px on a 320px screen.
  it('keeps a bottom step inside a 320px screen when its target is at the right edge', () => {
    const b = place('bottom', { left: 300, top: 40, width: 16, height: 16 }, { w: 320, h: 640 });
    expect(b.width).toBe(320 - 2 * EDGE);
    expect(b.left).toBeGreaterThanOrEqual(EDGE);
    expect(b.left + b.width).toBeLessThanOrEqual(320 - EDGE);
    expect(b.top).toBe(b.bottom + GAP);
  });

  // 118px above, 178px below: neither side has the full budget, so the bubble
  // takes the roomier side and is capped to it, scrolling if it has to.
  it('caps a bottom step to the room below when the viewport is too short for either side', () => {
    const b = place('bottom', { left: 400, top: 150, width: 40, height: 40 }, { w: 1024, h: 400 });
    expect(b.bubble.style.bottom).toBe('');
    expect(b.top).toBe(b.bottom + GAP);
    expect(b.maxHeight).toBe(400 - b.bottom - GAP - EDGE);
    expect(b.top).toBeGreaterThanOrEqual(EDGE);
    expect(b.top + b.maxHeight).toBeLessThanOrEqual(400 - EDGE);
  });

  it('falls back to a centred card, capped to the viewport, when neither side has usable room', () => {
    const b = place('bottom', { left: 400, top: 100, width: 40, height: 40 }, { w: 1024, h: 240 });
    expect(b.bubble.style.top).toBe('50%');
    expect(b.bubble.style.transform).toBe('translateY(-50%)');
    expect(b.maxHeight).toBe(240 - 2 * EDGE);
  });

  it('puts a top step below a target near the top of the viewport', () => {
    const b = place('top', { left: 400, top: 30, width: 40, height: 30 }, { w: 1024, h: 768 });
    expect(b.bubble.style.bottom).toBe('');
    expect(b.top).toBe(b.bottom + GAP);
  });

  // Both sides have the full budget (368px above, 538px below), so the step's
  // own preference decides.
  it('puts a top step above its target when both sides have room, anchored by its bottom edge', () => {
    const b = place('top', { left: 400, top: 400, width: 40, height: 30 }, { w: 1024, h: 1000 });
    expect(b.bubble.style.top).toBe('');
    expect(b.bubble.style.bottom).toBe(`${1000 - 400 + GAP}px`);
    expect(b.maxHeight).toBe(400 - GAP - EDGE);
  });

  it('puts a bottom step below its target when both sides have room', () => {
    const b = place('bottom', { left: 400, top: 400, width: 40, height: 30 }, { w: 1024, h: 1000 });
    expect(b.bubble.style.bottom).toBe('');
    expect(b.top).toBe(b.bottom + GAP);
    expect(b.maxHeight).toBe(1000 - b.bottom - GAP - EDGE);
  });

  it('puts a right step beside its target when it fits', () => {
    const b = place('right', { left: 100, top: 300, width: 40, height: 40 }, { w: 1024, h: 768 });
    expect(b.left).toBe(b.right + GAP);
    expect(b.top).toBeGreaterThanOrEqual(EDGE);
    expect(b.top + b.maxHeight).toBeLessThanOrEqual(768 - EDGE);
  });

  it('puts a left step beside its target when it fits', () => {
    const b = place('left', { left: 600, top: 300, width: 40, height: 40 }, { w: 1024, h: 768 });
    expect(b.left + b.width).toBe(600 - GAP);
  });

  // No room beside the target on a phone: clamping alone would slide the
  // bubble back over it, so it goes below instead.
  it.each<[Position, number]>([
    ['left', 100],
    ['right', 200],
  ])('moves a %s step below its target on a 320px screen', (position, targetLeft) => {
    const b = place(position, { left: targetLeft, top: 300, width: 40, height: 40 }, { w: 320, h: 640 });
    expect(b.bubble.style.bottom).toBe('');
    expect(b.top).toBe(b.bottom + GAP);
    expect(b.left).toBeGreaterThanOrEqual(EDGE);
    expect(b.left + b.width).toBeLessThanOrEqual(320 - EDGE);
    expect(b.top + b.maxHeight).toBeLessThanOrEqual(640 - EDGE);
  });
});
