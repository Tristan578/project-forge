import { describe, it, expect } from 'vitest';
import {
  getDefaultTouchPreset,
  generateTouchCSS,
  generateTouchJS,
  generateTouchOverlayHTML,
  type MobileTouchConfig,
} from './touchControls';

describe('touchControls', () => {
  describe('getDefaultTouchPreset', () => {
    it('should return platformer preset by default', () => {
      const config = getDefaultTouchPreset('platformer');
      expect(config.preset).toBe('platformer');
      expect(config.enabled).toBe(true);
      expect(config.autoDetect).toBe(true);
      expect(config.joystick).not.toBeNull();
      expect(config.joystick!.mode).toBe('floating');
      expect(config.joystick!.size).toBe(120);
      expect(config.buttons).toHaveLength(1);
      expect(config.buttons[0].action).toBe('jump');
    });

    it('should return platformer for unknown presets', () => {
      const config = getDefaultTouchPreset('unknown_thing');
      expect(config.preset).toBe('platformer');
    });

    it('should return fps preset with dual joysticks', () => {
      const config = getDefaultTouchPreset('fps');
      expect(config.preset).toBe('fps');
      expect(config.joystick).not.toBeNull();
      expect(config.joystick!.position).toBe('bottom-left');
      expect(config.joystick!.mode).toBe('fixed');
      expect(config.lookJoystick).not.toBeNull();
      expect(config.lookJoystick!.position).toBe('bottom-right');
      expect(config.lookJoystick!.actions.horizontal).toBe('look_right');
      expect(config.buttons).toHaveLength(1);
      expect(config.buttons[0].action).toBe('shoot');
    });

    it('should return topdown preset with floating joystick', () => {
      const config = getDefaultTouchPreset('topdown');
      expect(config.preset).toBe('topdown');
      expect(config.joystick).not.toBeNull();
      expect(config.joystick!.mode).toBe('floating');
      expect(config.buttons).toHaveLength(1);
      expect(config.buttons[0].action).toBe('interact');
    });

    it('should return racing preset with horizontal-only joystick', () => {
      const config = getDefaultTouchPreset('racing');
      expect(config.preset).toBe('racing');
      expect(config.joystick).not.toBeNull();
      expect(config.joystick!.actions.vertical).toBeNull();
      expect(config.joystick!.actions.horizontal).toBe('steer');
      expect(config.buttons).toHaveLength(2);
      expect(config.buttons[0].action).toBe('gas');
      expect(config.buttons[1].action).toBe('brake');
    });

    it('should return puzzle preset with no joystick', () => {
      const config = getDefaultTouchPreset('puzzle');
      expect(config.preset).toBe('puzzle');
      expect(config.joystick).toBeNull();
      expect(config.buttons).toHaveLength(1);
      expect(config.buttons[0].action).toBe('interact');
    });

    it('should be case-insensitive', () => {
      const upper = getDefaultTouchPreset('FPS');
      const lower = getDefaultTouchPreset('fps');
      expect(upper.preset).toBe(lower.preset);
    });

    it('should include common base config for all presets', () => {
      const presets = ['platformer', 'fps', 'topdown', 'racing', 'puzzle'];
      for (const name of presets) {
        const config = getDefaultTouchPreset(name);
        expect(config.enabled).toBe(true);
        expect(config.autoDetect).toBe(true);
        expect(config.preferredOrientation).toBe('any');
        expect(config.autoReduceQuality).toBe(true);
      }
    });

    it('should set correct deadZone for all joysticks', () => {
      const presets = ['platformer', 'fps', 'topdown', 'racing'];
      for (const name of presets) {
        const config = getDefaultTouchPreset(name);
        if (config.joystick) {
          expect(config.joystick.deadZone).toBe(0.15);
        }
      }
    });

    it('should set button opacity to 0.6 for all buttons', () => {
      const presets = ['platformer', 'fps', 'topdown', 'racing', 'puzzle'];
      for (const name of presets) {
        const config = getDefaultTouchPreset(name);
        for (const btn of config.buttons) {
          expect(btn.opacity).toBe(0.6);
        }
      }
    });
  });

  describe('generateTouchCSS', () => {
    it('should return non-empty CSS string', () => {
      const css = generateTouchCSS();
      expect(css.length).toBeGreaterThan(0);
    });

    it('should include overlay class', () => {
      const css = generateTouchCSS();
      expect(css).toContain('.forge-touch-overlay');
      expect(css).toContain('pointer-events: none');
      expect(css).toContain('z-index: 1000');
    });

    it('should include joystick classes', () => {
      const css = generateTouchCSS();
      expect(css).toContain('.forge-joystick');
      expect(css).toContain('.forge-joystick-outer');
      expect(css).toContain('.forge-joystick-knob');
    });

    it('should include button classes', () => {
      const css = generateTouchCSS();
      expect(css).toContain('.forge-button');
      expect(css).toContain('.forge-button.pressed');
      expect(css).toContain('.forge-button-label');
    });

    it('should include touch-action: none for interactive elements', () => {
      const css = generateTouchCSS();
      expect(css).toContain('touch-action: none');
    });

    it('should include user-select: none', () => {
      const css = generateTouchCSS();
      expect(css).toContain('user-select: none');
      expect(css).toContain('-webkit-user-select: none');
    });
  });

  describe('generateTouchJS', () => {
    const platformerConfig = getDefaultTouchPreset('platformer');

    it('should return non-empty JS string', () => {
      const js = generateTouchJS(platformerConfig);
      expect(js.length).toBeGreaterThan(0);
    });

    it('should include mobile detection', () => {
      const js = generateTouchJS(platformerConfig);
      expect(js).toContain('Android');
      expect(js).toContain('iPhone');
      expect(js).toContain('ontouchstart');
      expect(js).toContain('maxTouchPoints');
    });

    it('should include config as JSON', () => {
      const js = generateTouchJS(platformerConfig);
      expect(js).toContain('platformer');
      expect(js).toContain('jump');
    });

    it('should initialize global touch input state', () => {
      const js = generateTouchJS(platformerConfig);
      expect(js).toContain('__forgeTouchInput');
      expect(js).toContain('pressed');
      expect(js).toContain('justPressed');
      expect(js).toContain('justReleased');
      expect(js).toContain('axes');
    });

    it('should include flush function', () => {
      const js = generateTouchJS(platformerConfig);
      expect(js).toContain('__forgeTouchFlush');
    });

    it('should include joystick creation logic', () => {
      const js = generateTouchJS(platformerConfig);
      expect(js).toContain('createJoystick');
      expect(js).toContain('forge-joystick-main');
    });

    it('should include dead zone calculation', () => {
      const js = generateTouchJS(platformerConfig);
      expect(js).toContain('deadZone');
      expect(js).toContain('magnitude');
    });

    it('should include joystick touch handlers', () => {
      const js = generateTouchJS(platformerConfig);
      expect(js).toContain('touchstart');
      expect(js).toContain('touchmove');
      expect(js).toContain('touchend');
      expect(js).toContain('touchcancel');
    });

    it('should include button creation for each config button', () => {
      const js = generateTouchJS(platformerConfig);
      expect(js).toContain('forge-btn-');
      expect(js).toContain('jump');
    });

    it('should include vibration on button press', () => {
      const js = generateTouchJS(platformerConfig);
      expect(js).toContain('navigator.vibrate');
    });

    it('should handle auto reduce quality flag', () => {
      const js = generateTouchJS(platformerConfig);
      expect(js).toContain('__forgeAutoReduceQuality');
    });

    it('should include IIFE wrapper', () => {
      const js = generateTouchJS(platformerConfig);
      expect(js).toContain('(function()');
      expect(js).toContain("'use strict'");
    });

    it('should handle fps config with look joystick', () => {
      const fpsConfig = getDefaultTouchPreset('fps');
      const js = generateTouchJS(fpsConfig);
      expect(js).toContain('forge-joystick-look');
      expect(js).toContain('look_right');
    });

    it('should handle config with orientation hint', () => {
      const config: MobileTouchConfig = {
        ...platformerConfig,
        preferredOrientation: 'landscape',
      };
      const js = generateTouchJS(config);
      expect(js).toContain('orientationchange');
      expect(js).toContain('landscape');
    });

    it('should handle disabled config early exit', () => {
      const disabled: MobileTouchConfig = {
        ...platformerConfig,
        enabled: false,
      };
      const js = generateTouchJS(disabled);
      expect(js).toContain('!config.enabled');
    });
  });

  describe('generateTouchOverlayHTML', () => {
    it('should return overlay div', () => {
      const html = generateTouchOverlayHTML(getDefaultTouchPreset('platformer'));
      expect(html).toContain('id="forge-touch-overlay"');
      expect(html).toContain('class="forge-touch-overlay"');
    });

    it('should return a closed div', () => {
      const html = generateTouchOverlayHTML(getDefaultTouchPreset('platformer'));
      expect(html).toContain('</div>');
    });
  });
});
