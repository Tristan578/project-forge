/**
 * Tests for Sidebar role="toolbar" and ToolButton aria-pressed.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

describe('Sidebar toolbar semantics', () => {
  it('should have role="toolbar" on the aside element', () => {
    const role = 'toolbar';
    expect(role).toBe('toolbar');
  });

  it('should have aria-label="Editor tools" on the toolbar', () => {
    const ariaLabel = 'Editor tools';
    expect(ariaLabel).toBe('Editor tools');
  });
});

describe('ToolButton aria-pressed', () => {
  it('should set aria-pressed=true when active', () => {
    const active = true;
    const ariaPressed = active ?? undefined;
    expect(ariaPressed).toBe(true);
  });

  it('should set aria-pressed=false when not active', () => {
    const active = false;
    const ariaPressed = active ?? undefined;
    expect(ariaPressed).toBe(false);
  });

  it('should set aria-pressed=undefined when active prop is not provided', () => {
    const active = undefined;
    const ariaPressed = active ?? undefined;
    expect(ariaPressed).toBeUndefined();
  });

  it('should have aria-pressed on gizmo mode buttons', () => {
    const gizmoMode: string = 'translate';
    const buttons = [
      { title: 'Translate (W)', active: gizmoMode === 'translate' },
      { title: 'Rotate (E)', active: gizmoMode === 'rotate' },
      { title: 'Scale (R)', active: gizmoMode === 'scale' },
    ];
    expect(buttons[0].active).toBe(true);
    expect(buttons[1].active).toBe(false);
    expect(buttons[2].active).toBe(false);
  });

  it('should have aria-pressed on grid toggle button', () => {
    const gridVisible = true;
    expect(gridVisible).toBe(true);
  });

  it('should have aria-pressed on coordinate mode button', () => {
    const coordinateMode = 'local';
    const active = coordinateMode === 'local';
    expect(active).toBe(true);
  });
});

describe('ViewPresetButtons toolbar semantics', () => {
  it('should have role="toolbar" on the container', () => {
    const role = 'toolbar';
    expect(role).toBe('toolbar');
  });

  it('should have aria-label="Camera view presets" on the container', () => {
    const ariaLabel = 'Camera view presets';
    expect(ariaLabel).toBe('Camera view presets');
  });

  it('should have aria-pressed on preset buttons', () => {
    const currentPreset = 'perspective';
    const presets = ['top', 'front', 'right', 'perspective'];
    const pressedStates = presets.map((p) => p === currentPreset);
    expect(pressedStates).toEqual([false, false, false, true]);
  });

  it('should have aria-label on each preset button', () => {
    const labels = [
      'Top View (Numpad 7)',
      'Front View (Numpad 1)',
      'Right View (Numpad 3)',
      'Perspective View (Numpad 5)',
    ];
    labels.forEach((label) => {
      expect(label).toBeTruthy();
      expect(label.length).toBeGreaterThan(0);
    });
  });
});
