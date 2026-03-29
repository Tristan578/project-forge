/**
 * Advanced scene transition tests (PF-157).
 * Covers async timing, config overrides, and all transition types.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useEditorStore, DEFAULT_TRANSITION } from './editorStore';

describe('sceneTransition - Advanced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useEditorStore.setState({
      sceneTransition: { active: false, config: null, targetScene: null, transitionId: null },
      defaultTransition: { ...DEFAULT_TRANSITION },
      scenes: [
        { id: 'scene-1', name: 'Level1', isStartScene: true },
        { id: 'scene-2', name: 'Level2', isStartScene: false },
        { id: 'scene-3', name: 'BossRoom', isStartScene: false },
      ],
      activeSceneId: 'scene-1',
      engineMode: 'edit',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Transition Types', () => {
    it('supports fade transition type', () => {
      useEditorStore.getState().setDefaultTransition({ type: 'fade' });
      expect(useEditorStore.getState().defaultTransition.type).toBe('fade');
    });

    it('supports wipe transition type with direction', () => {
      useEditorStore.getState().setDefaultTransition({
        type: 'wipe',
        direction: 'left',
      });
      const dt = useEditorStore.getState().defaultTransition;
      expect(dt.type).toBe('wipe');
      expect(dt.direction).toBe('left');
    });

    it('supports instant transition type', () => {
      useEditorStore.getState().setDefaultTransition({ type: 'instant' });
      expect(useEditorStore.getState().defaultTransition.type).toBe('instant');
    });
  });

  describe('Easing Types', () => {
    it('supports linear easing', () => {
      useEditorStore.getState().setDefaultTransition({ easing: 'linear' });
      expect(useEditorStore.getState().defaultTransition.easing).toBe('linear');
    });

    it('supports ease-in easing', () => {
      useEditorStore.getState().setDefaultTransition({ easing: 'ease-in' });
      expect(useEditorStore.getState().defaultTransition.easing).toBe('ease-in');
    });

    it('supports ease-out easing', () => {
      useEditorStore.getState().setDefaultTransition({ easing: 'ease-out' });
      expect(useEditorStore.getState().defaultTransition.easing).toBe('ease-out');
    });

    it('supports ease-in-out easing (default)', () => {
      expect(useEditorStore.getState().defaultTransition.easing).toBe('ease-in-out');
    });
  });

  describe('Wipe Directions', () => {
    it('supports left direction', () => {
      useEditorStore.getState().setDefaultTransition({ type: 'wipe', direction: 'left' });
      expect(useEditorStore.getState().defaultTransition.direction).toBe('left');
    });

    it('supports right direction', () => {
      useEditorStore.getState().setDefaultTransition({ type: 'wipe', direction: 'right' });
      expect(useEditorStore.getState().defaultTransition.direction).toBe('right');
    });

    it('supports up direction', () => {
      useEditorStore.getState().setDefaultTransition({ type: 'wipe', direction: 'up' });
      expect(useEditorStore.getState().defaultTransition.direction).toBe('up');
    });

    it('supports down direction', () => {
      useEditorStore.getState().setDefaultTransition({ type: 'wipe', direction: 'down' });
      expect(useEditorStore.getState().defaultTransition.direction).toBe('down');
    });
  });

  describe('Config Override Merging', () => {
    it('merges partial config over defaults', () => {
      useEditorStore.getState().setDefaultTransition({
        type: 'fade',
        duration: 500,
        color: '#000000',
        easing: 'ease-in-out',
      });

      // Override just duration
      useEditorStore.getState().setDefaultTransition({ duration: 1000 });
      const dt = useEditorStore.getState().defaultTransition;
      expect(dt.type).toBe('fade');
      expect(dt.duration).toBe(1000);
      expect(dt.color).toBe('#000000');
      expect(dt.easing).toBe('ease-in-out');
    });

    it('can override color alone', () => {
      useEditorStore.getState().setDefaultTransition({ color: '#ffffff' });
      const dt = useEditorStore.getState().defaultTransition;
      expect(dt.color).toBe('#ffffff');
      expect(dt.type).toBe('fade'); // unchanged
    });

    it('overwrites all fields with full config', () => {
      useEditorStore.getState().setDefaultTransition({
        type: 'wipe',
        duration: 1500,
        color: '#ff0000',
        direction: 'right',
        easing: 'linear',
      });
      const dt = useEditorStore.getState().defaultTransition;
      expect(dt.type).toBe('wipe');
      expect(dt.duration).toBe(1500);
      expect(dt.color).toBe('#ff0000');
      expect(dt.direction).toBe('right');
      expect(dt.easing).toBe('linear');
    });
  });

  describe('startSceneTransition', () => {
    it('activates transition for valid scene name', async () => {
      const promise = useEditorStore.getState().startSceneTransition('Level2');

      // Transition should be active immediately
      expect(useEditorStore.getState().sceneTransition.active).toBe(true);
      expect(useEditorStore.getState().sceneTransition.targetScene).toBe('Level2');

      // Advance past default duration
      vi.advanceTimersByTime(600);
      await promise;
    });

    it('rejects transition for non-existent scene', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await useEditorStore.getState().startSceneTransition('FakeScene');

      expect(useEditorStore.getState().sceneTransition.active).toBe(false);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('uses default transition config', async () => {
      const promise = useEditorStore.getState().startSceneTransition('Level2');

      const config = useEditorStore.getState().sceneTransition.config;
      expect(config).not.toBeNull();
      expect(config!.type).toBe('fade');
      expect(config!.duration).toBe(500);

      vi.advanceTimersByTime(600);
      await promise;
    });

    it('accepts config override', async () => {
      const promise = useEditorStore.getState().startSceneTransition('BossRoom', {
        type: 'wipe',
        duration: 1000,
        direction: 'left',
      });

      const config = useEditorStore.getState().sceneTransition.config;
      expect(config!.type).toBe('wipe');
      expect(config!.duration).toBe(1000);

      vi.advanceTimersByTime(1100);
      await promise;
    });

    it('deactivates transition after duration', async () => {
      const promise = useEditorStore.getState().startSceneTransition('Level2');

      expect(useEditorStore.getState().sceneTransition.active).toBe(true);

      vi.advanceTimersByTime(600);
      await promise;

      expect(useEditorStore.getState().sceneTransition.active).toBe(false);
    });
  });

  describe('Direct State Manipulation', () => {
    it('can manually set active transition state', () => {
      useEditorStore.setState({
        sceneTransition: {
          active: true,
          config: { type: 'wipe', duration: 300, color: '#ffffff', easing: 'linear', direction: 'right' },
          targetScene: 'Level2',
          transitionId: null,
        },
      });

      const st = useEditorStore.getState().sceneTransition;
      expect(st.active).toBe(true);
      expect(st.config!.type).toBe('wipe');
      expect(st.config!.direction).toBe('right');
      expect(st.targetScene).toBe('Level2');
    });

    it('can toggle transition active/inactive', () => {
      useEditorStore.setState({
        sceneTransition: {
          active: true,
          config: DEFAULT_TRANSITION,
          targetScene: 'BossRoom',
          transitionId: null,
        },
      });
      expect(useEditorStore.getState().sceneTransition.active).toBe(true);

      useEditorStore.setState({
        sceneTransition: { active: false, config: null, targetScene: null, transitionId: null },
      });
      expect(useEditorStore.getState().sceneTransition.active).toBe(false);
      expect(useEditorStore.getState().sceneTransition.config).toBeNull();
    });
  });

  describe('DEFAULT_TRANSITION constant', () => {
    it('is fade type', () => {
      expect(DEFAULT_TRANSITION.type).toBe('fade');
    });

    it('has 500ms duration', () => {
      expect(DEFAULT_TRANSITION.duration).toBe(500);
    });

    it('has black color', () => {
      expect(DEFAULT_TRANSITION.color).toBe('#000000');
    });

    it('has ease-in-out easing', () => {
      expect(DEFAULT_TRANSITION.easing).toBe('ease-in-out');
    });

    it('has no direction property', () => {
      expect(DEFAULT_TRANSITION.direction).toBeUndefined();
    });
  });
});
