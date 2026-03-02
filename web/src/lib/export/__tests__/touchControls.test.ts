import { describe, it, expect } from 'vitest';
import {
  getDefaultTouchPreset,
  generateTouchCSS,
  generateTouchJS,
  generateTouchOverlayHTML,
  type MobileTouchConfig,
} from '../touchControls';

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
    const config = getDefaultTouchPreset('unknown_preset');
    expect(config.preset).toBe('platformer');
  });

  it('should return fps preset with two joysticks', () => {
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
    expect(config.joystick!.mode).toBe('floating');
    expect(config.buttons[0].action).toBe('interact');
  });

  it('should return racing preset with horizontal-only joystick', () => {
    const config = getDefaultTouchPreset('racing');
    expect(config.preset).toBe('racing');
    expect(config.joystick!.actions.horizontal).toBe('steer');
    expect(config.joystick!.actions.vertical).toBeNull();
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
    const config = getDefaultTouchPreset('FPS');
    expect(config.preset).toBe('fps');
  });

  it('should always include base config fields', () => {
    for (const preset of ['platformer', 'fps', 'topdown', 'racing', 'puzzle']) {
      const config = getDefaultTouchPreset(preset);
      expect(config.enabled).toBe(true);
      expect(config.autoDetect).toBe(true);
      expect(config.autoReduceQuality).toBe(true);
      expect(config.preferredOrientation).toBe('any');
    }
  });
});

describe('generateTouchCSS', () => {
  it('should return non-empty CSS string', () => {
    const css = generateTouchCSS();
    expect(css.length).toBeGreaterThan(100);
  });

  it('should contain overlay class', () => {
    const css = generateTouchCSS();
    expect(css).toContain('.forge-touch-overlay');
    expect(css).toContain('position: fixed');
    expect(css).toContain('pointer-events: none');
  });

  it('should contain joystick classes', () => {
    const css = generateTouchCSS();
    expect(css).toContain('.forge-joystick');
    expect(css).toContain('.forge-joystick-outer');
    expect(css).toContain('.forge-joystick-knob');
    expect(css).toContain('border-radius: 50%');
  });

  it('should contain button classes', () => {
    const css = generateTouchCSS();
    expect(css).toContain('.forge-button');
    expect(css).toContain('.forge-button.pressed');
    expect(css).toContain('.forge-button-label');
  });

  it('should include touch-action: none for touch areas', () => {
    const css = generateTouchCSS();
    expect(css).toContain('touch-action: none');
  });
});

describe('generateTouchJS', () => {
  const config: MobileTouchConfig = {
    enabled: true,
    autoDetect: true,
    preset: 'platformer',
    joystick: {
      position: 'bottom-left',
      size: 120,
      deadZone: 0.15,
      opacity: 0.6,
      mode: 'floating',
      actions: { horizontal: 'move_right', vertical: 'move_forward' },
    },
    buttons: [
      { id: 'jump', action: 'jump', position: { x: 85, y: 75 }, size: 80, icon: '↑', opacity: 0.6 },
    ],
    preferredOrientation: 'any',
    autoReduceQuality: true,
  };

  it('should return non-empty JS string', () => {
    const js = generateTouchJS(config);
    expect(js.length).toBeGreaterThan(200);
  });

  it('should be a self-invoking function', () => {
    const js = generateTouchJS(config);
    expect(js).toContain('(function()');
    expect(js).toContain('})()');
  });

  it('should embed config as JSON', () => {
    const js = generateTouchJS(config);
    expect(js).toContain(JSON.stringify(config));
  });

  it('should include mobile detection', () => {
    const js = generateTouchJS(config);
    expect(js).toContain('Android');
    expect(js).toContain('ontouchstart');
    expect(js).toContain('maxTouchPoints');
  });

  it('should initialize touch input state', () => {
    const js = generateTouchJS(config);
    expect(js).toContain('__forgeTouchInput');
    expect(js).toContain('__forgeTouchFlush');
    expect(js).toContain('pressed');
    expect(js).toContain('justPressed');
    expect(js).toContain('justReleased');
  });

  it('should handle joystick dead zone', () => {
    const js = generateTouchJS(config);
    expect(js).toContain('deadZone');
    expect(js).toContain('magnitude');
  });

  it('should handle button touch events', () => {
    const js = generateTouchJS(config);
    expect(js).toContain('touchstart');
    expect(js).toContain('touchend');
    expect(js).toContain('touchcancel');
  });

  it('should include vibration feedback', () => {
    const js = generateTouchJS(config);
    expect(js).toContain('vibrate');
  });
});

describe('generateTouchOverlayHTML', () => {
  const config: MobileTouchConfig = {
    enabled: true,
    autoDetect: true,
    preset: 'platformer',
    joystick: null,
    buttons: [],
    preferredOrientation: 'any',
    autoReduceQuality: false,
  };

  it('should return a forge-touch-overlay div', () => {
    const html = generateTouchOverlayHTML(config);
    expect(html).toContain('<div id="forge-touch-overlay"');
    expect(html).toContain('class="forge-touch-overlay"');
    expect(html).toContain('</div>');
  });
});
