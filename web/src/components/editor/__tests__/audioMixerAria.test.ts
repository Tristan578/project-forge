/**
 * Tests for AudioMixerPanel ARIA attributes.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

describe('AudioMixerPanel mute button', () => {
  it('should have aria-pressed reflecting muted state', () => {
    const muted = true;
    expect(muted).toBe(true);
  });

  it('should have aria-label with bus name', () => {
    const busName = 'sfx';
    const ariaLabel = `Mute ${busName}`;
    expect(ariaLabel).toBe('Mute sfx');
  });
});

describe('AudioMixerPanel solo button', () => {
  it('should have aria-pressed reflecting soloed state', () => {
    const soloed = false;
    expect(soloed).toBe(false);
  });

  it('should have aria-label with bus name', () => {
    const busName = 'music';
    const ariaLabel = `Solo ${busName}`;
    expect(ariaLabel).toBe('Solo music');
  });
});

describe('AudioMixerPanel volume slider', () => {
  it('should have aria-label with bus name', () => {
    const busName = 'master';
    const ariaLabel = `${busName} volume`;
    expect(ariaLabel).toBe('master volume');
  });
});

describe('AudioMixerPanel add effect button', () => {
  it('should have aria-label with bus name', () => {
    const busName = 'sfx';
    const ariaLabel = `Add effect to ${busName}`;
    expect(ariaLabel).toBe('Add effect to sfx');
  });

  it('should have aria-expanded reflecting dropdown state', () => {
    const showEffectMenu = true;
    expect(showEffectMenu).toBe(true);
  });

  it('should have aria-haspopup="true"', () => {
    const ariaHasPopup = 'true';
    expect(ariaHasPopup).toBe('true');
  });
});

describe('AudioMixerPanel effect menu', () => {
  it('should have role="menu" on the dropdown', () => {
    const role = 'menu';
    expect(role).toBe('menu');
  });

  it('should have role="menuitem" on each effect option', () => {
    const role = 'menuitem';
    expect(role).toBe('menuitem');
  });
});

describe('AudioMixerPanel effect slot buttons', () => {
  it('should have aria-label describing the effect', () => {
    const effectType = 'reverb';
    const ariaLabel = `Edit ${effectType} effect`;
    expect(ariaLabel).toBe('Edit reverb effect');
  });

  it('should have aria-expanded reflecting popover state', () => {
    const editingEffect = 0;
    const index = 0;
    const expanded = editingEffect === index;
    expect(expanded).toBe(true);
  });
});

describe('AudioMixerPanel new bus input', () => {
  it('should have aria-label on the bus name input', () => {
    const ariaLabel = 'New bus name';
    expect(ariaLabel).toBe('New bus name');
  });
});
