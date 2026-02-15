/**
 * Unit tests for scene transition state and actions in editorStore.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useEditorStore } from './editorStore';
import { DEFAULT_TRANSITION } from './editorStore';

describe('sceneTransition', () => {
  beforeEach(() => {
    useEditorStore.setState({
      sceneTransition: { active: false, config: null, targetScene: null },
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

  describe('defaultTransition', () => {
    it('initializes with default config', () => {
      const state = useEditorStore.getState();
      expect(state.defaultTransition).toEqual({
        type: 'fade',
        duration: 500,
        color: '#000000',
        easing: 'ease-in-out',
      });
    });

    it('setDefaultTransition merges partial config', () => {
      useEditorStore.getState().setDefaultTransition({
        type: 'wipe',
        duration: 1000,
        direction: 'right',
      });
      const state = useEditorStore.getState();
      expect(state.defaultTransition.type).toBe('wipe');
      expect(state.defaultTransition.duration).toBe(1000);
      expect(state.defaultTransition.direction).toBe('right');
      // Unchanged fields preserved
      expect(state.defaultTransition.color).toBe('#000000');
      expect(state.defaultTransition.easing).toBe('ease-in-out');
    });

    it('setDefaultTransition updates only specified fields', () => {
      useEditorStore.getState().setDefaultTransition({ color: '#ff0000' });
      const state = useEditorStore.getState();
      expect(state.defaultTransition.color).toBe('#ff0000');
      expect(state.defaultTransition.type).toBe('fade');
      expect(state.defaultTransition.duration).toBe(500);
    });
  });

  describe('sceneTransition state', () => {
    it('starts inactive', () => {
      const state = useEditorStore.getState();
      expect(state.sceneTransition.active).toBe(false);
      expect(state.sceneTransition.config).toBeNull();
      expect(state.sceneTransition.targetScene).toBeNull();
    });

    it('can be set active with config', () => {
      useEditorStore.setState({
        sceneTransition: {
          active: true,
          config: { type: 'fade', duration: 500, color: '#000000', easing: 'ease-in-out' },
          targetScene: 'Level2',
        },
      });
      const state = useEditorStore.getState();
      expect(state.sceneTransition.active).toBe(true);
      expect(state.sceneTransition.config?.type).toBe('fade');
      expect(state.sceneTransition.targetScene).toBe('Level2');
    });

    it('can be deactivated', () => {
      useEditorStore.setState({
        sceneTransition: {
          active: true,
          config: { type: 'wipe', duration: 300, color: '#ffffff', easing: 'linear', direction: 'left' },
          targetScene: 'BossRoom',
        },
      });
      useEditorStore.setState({
        sceneTransition: { active: false, config: null, targetScene: null },
      });
      const state = useEditorStore.getState();
      expect(state.sceneTransition.active).toBe(false);
    });
  });

  describe('startSceneTransition validation', () => {
    it('rejects non-existent scene name', async () => {
      const consoleSpy = { error: '' };
      const origError = console.error;
      console.error = (msg: string) => { consoleSpy.error = msg; };

      await useEditorStore.getState().startSceneTransition('NonExistent');

      console.error = origError;
      expect(consoleSpy.error).toContain('not found');
      // Transition should not activate
      expect(useEditorStore.getState().sceneTransition.active).toBe(false);
    });
  });

  describe('DEFAULT_TRANSITION export', () => {
    it('has expected shape', () => {
      expect(DEFAULT_TRANSITION).toEqual({
        type: 'fade',
        duration: 500,
        color: '#000000',
        easing: 'ease-in-out',
      });
    });
  });
});
