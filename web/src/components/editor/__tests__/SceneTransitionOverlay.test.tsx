/**
 * Render tests for SceneTransitionOverlay component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@/test/utils/componentTestUtils';
import { SceneTransitionOverlay } from '../SceneTransitionOverlay';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

describe('SceneTransitionOverlay', () => {
  function setupStore({
    active = false,
    config = null as null | {
      type: string;
      duration: number;
      color: string;
      direction?: string;
      easing: string;
    },
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        sceneTransition: { active, config },
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when transition is not active', () => {
    setupStore({ active: false, config: null });
    const { container } = render(<SceneTransitionOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when config is null even if active', () => {
    setupStore({ active: true, config: null });
    const { container } = render(<SceneTransitionOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('renders overlay div when active with config', () => {
    setupStore({
      active: true,
      config: { type: 'fade', duration: 300, color: '#000', easing: 'ease' },
    });
    const { container } = render(<SceneTransitionOverlay />);
    expect(container.firstChild).not.toBeNull();
  });

  it('applies fade class for fade transition type', () => {
    setupStore({
      active: true,
      config: { type: 'fade', duration: 300, color: '#000', easing: 'ease' },
    });
    const { container } = render(<SceneTransitionOverlay />);
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain('scene-transition-fade');
  });

  it('applies wipe class for wipe transition type', () => {
    setupStore({
      active: true,
      config: { type: 'wipe', duration: 300, color: '#000', direction: 'left', easing: 'ease' },
    });
    const { container } = render(<SceneTransitionOverlay />);
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain('scene-transition-wipe');
  });

  it('applies direction class for wipe transition', () => {
    setupStore({
      active: true,
      config: { type: 'wipe', duration: 400, color: '#fff', direction: 'right', easing: 'ease' },
    });
    const { container } = render(<SceneTransitionOverlay />);
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain('scene-transition-wipe-right');
  });

  it('defaults wipe direction to "left" when not specified', () => {
    setupStore({
      active: true,
      config: { type: 'wipe', duration: 300, color: '#000', easing: 'ease' },
    });
    const { container } = render(<SceneTransitionOverlay />);
    const div = container.firstChild as HTMLElement;
    expect(div.className).toContain('scene-transition-wipe-left');
  });

  it('has no transition type class for "instant" type', () => {
    setupStore({
      active: true,
      config: { type: 'instant', duration: 0, color: '#000', easing: 'ease' },
    });
    const { container } = render(<SceneTransitionOverlay />);
    const div = container.firstChild as HTMLElement;
    expect(div.className).not.toContain('scene-transition-fade');
    expect(div.className).not.toContain('scene-transition-wipe');
  });
});
