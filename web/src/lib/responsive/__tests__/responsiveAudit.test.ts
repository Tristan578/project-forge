import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLayoutConfig, detectKeyboard, KEYBOARD_THRESHOLD } from '@/hooks/useResponsiveLayout';
import type { LayoutConfig } from '@/hooks/useResponsiveLayout';

describe('getLayoutConfig', () => {
  it('returns compact mode for width < 1024', () => {
    const config = getLayoutConfig(768);
    expect(config.mode).toBe('compact');
    expect(config.showSidebar).toBe(false);
    expect(config.showHierarchy).toBe(false);
    expect(config.showRightPanel).toBe(false);
    expect(config.showBottomPanel).toBe(false);
    expect(config.hierarchyWidth).toBe(0);
    expect(config.bottomPanelHeight).toBe(0);
  });

  it('returns compact mode for very small mobile width (320px)', () => {
    const config = getLayoutConfig(320);
    expect(config.mode).toBe('compact');
    expect(config.showSidebar).toBe(false);
    expect(config.hierarchyWidth).toBe(0);
  });

  it('returns compact mode at tablet breakpoint (1023px)', () => {
    const config = getLayoutConfig(1023);
    expect(config.mode).toBe('compact');
  });

  it('returns condensed mode for width between 1024 and 1439', () => {
    const config = getLayoutConfig(1024);
    expect(config.mode).toBe('condensed');
    expect(config.showSidebar).toBe(true);
    expect(config.showHierarchy).toBe(true);
    expect(config.showRightPanel).toBe(true);
    expect(config.showBottomPanel).toBe(true);
    expect(config.hierarchyWidth).toBe(180);
    expect(config.bottomPanelHeight).toBe(120);
  });

  it('returns condensed mode at upper bound (1439px)', () => {
    const config = getLayoutConfig(1439);
    expect(config.mode).toBe('condensed');
    expect(config.hierarchyWidth).toBe(180);
  });

  it('returns full mode for width >= 1440', () => {
    const config = getLayoutConfig(1440);
    expect(config.mode).toBe('full');
    expect(config.showSidebar).toBe(true);
    expect(config.showHierarchy).toBe(true);
    expect(config.showRightPanel).toBe(true);
    expect(config.showBottomPanel).toBe(true);
    expect(config.hierarchyWidth).toBe(240);
    expect(config.bottomPanelHeight).toBe(160);
  });

  it('returns full mode for large desktop (1920px)', () => {
    const config = getLayoutConfig(1920);
    expect(config.mode).toBe('full');
    expect(config.hierarchyWidth).toBe(240);
    expect(config.bottomPanelHeight).toBe(160);
  });

  it('forces compact mode when keyboard is visible on mobile', () => {
    const config = getLayoutConfig(768, true);
    expect(config.mode).toBe('compact');
    expect(config.isKeyboardVisible).toBe(true);
    expect(config.showSidebar).toBe(false);
    expect(config.showBottomPanel).toBe(false);
  });

  it('does not force compact when keyboard visible on desktop', () => {
    // Width >= 1024, keyboard visibility is ignored for layout mode
    const config = getLayoutConfig(1440, true);
    expect(config.mode).toBe('full');
    expect(config.isKeyboardVisible).toBe(true);
  });

  it('passes keyboard visibility through to condensed mode', () => {
    const config = getLayoutConfig(1200, false);
    expect(config.mode).toBe('condensed');
    expect(config.isKeyboardVisible).toBe(false);
  });
});

describe('detectKeyboard', () => {
  beforeEach(() => {
    // Reset window and screen mocks
    vi.stubGlobal('window', {
      visualViewport: { height: 800 },
      innerHeight: 800,
    });
    vi.stubGlobal('screen', { height: 900 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false when viewport is not significantly reduced', () => {
    // 800/900 = 0.89, well above 0.6 threshold
    expect(detectKeyboard()).toBe(false);
  });

  it('returns true when viewport height is significantly reduced (keyboard open)', () => {
    vi.stubGlobal('window', {
      visualViewport: { height: 400 },
      innerHeight: 400,
    });
    vi.stubGlobal('screen', { height: 900 });
    // 400/900 = 0.44, below 0.6 threshold
    expect(detectKeyboard()).toBe(true);
  });

  it('returns false when screen height is 0 (avoids division by zero)', () => {
    vi.stubGlobal('screen', { height: 0 });
    expect(detectKeyboard()).toBe(false);
  });

  it('falls back to innerHeight when visualViewport is not available', () => {
    vi.stubGlobal('window', {
      visualViewport: null,
      innerHeight: 400,
    });
    vi.stubGlobal('screen', { height: 900 });
    // 400/900 < 0.6
    expect(detectKeyboard()).toBe(true);
  });

  it('uses KEYBOARD_THRESHOLD constant for detection', () => {
    expect(KEYBOARD_THRESHOLD).toBe(0.6);
  });
});

describe('LayoutConfig type structure', () => {
  it('has all required fields for compact mode', () => {
    const config: LayoutConfig = getLayoutConfig(375);
    const keys = Object.keys(config);
    expect(keys).toContain('mode');
    expect(keys).toContain('showSidebar');
    expect(keys).toContain('showHierarchy');
    expect(keys).toContain('showRightPanel');
    expect(keys).toContain('showBottomPanel');
    expect(keys).toContain('hierarchyWidth');
    expect(keys).toContain('bottomPanelHeight');
    expect(keys).toContain('isKeyboardVisible');
  });

  it('all panel flags are false in compact mode', () => {
    const config = getLayoutConfig(500);
    expect(config.showSidebar).toBe(false);
    expect(config.showHierarchy).toBe(false);
    expect(config.showRightPanel).toBe(false);
    expect(config.showBottomPanel).toBe(false);
  });

  it('all panel flags are true in full mode', () => {
    const config = getLayoutConfig(2560);
    expect(config.showSidebar).toBe(true);
    expect(config.showHierarchy).toBe(true);
    expect(config.showRightPanel).toBe(true);
    expect(config.showBottomPanel).toBe(true);
  });
});
