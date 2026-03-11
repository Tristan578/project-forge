/**
 * Unit tests for the UI runtime code generator (uiRuntime.ts).
 *
 * The module exports a single pure function `generateUIRuntimeCode(uiData: string): string`
 * that wraps a JSON data string inside a self-executing IIFE that hydrates the in-game UI.
 *
 * Tests verify:
 *  - The generated string is non-empty and syntactically coherent
 *  - The uiData value is embedded verbatim at the correct position
 *  - Critical runtime functions are present in the output
 *  - Screen/widget creation, show/hide/toggle logic is included
 *  - forge.ui API extension (showScreen, hideScreen, toggleScreen, hideAllScreens)
 *  - Binding update loop (requestAnimationFrame, data-value-binding)
 *  - Widget type branches (text, button, progress_bar)
 *  - The output does NOT contain stray import/export statements
 */

import { describe, it, expect } from 'vitest';
import { generateUIRuntimeCode } from '@/lib/export/uiRuntime';

// ── helpers ────────────────────────────────────────────────────────────────────

function generate(data: string = 'null'): string {
  return generateUIRuntimeCode(data);
}

// ── basic shape ───────────────────────────────────────────────────────────────

describe('generateUIRuntimeCode: basic output shape', () => {
  it('returns a non-empty string', () => {
    expect(generate()).toBeTruthy();
    expect(typeof generate()).toBe('string');
  });

  it('starts with an IIFE opening', () => {
    const code = generate();
    expect(code.trimStart()).toMatch(/^\(function\(\)/);
  });

  it('ends with the IIFE closing', () => {
    const code = generate();
    expect(code.trimEnd()).toMatch(/\}\)\(\);$/);
  });

  it('contains no ES module import or export statements', () => {
    const code = generate();
    // Should be vanilla JS only
    expect(code).not.toMatch(/^import\s/m);
    expect(code).not.toMatch(/^export\s/m);
  });
});

// ── data embedding ────────────────────────────────────────────────────────────

describe('generateUIRuntimeCode: data embedding', () => {
  it('embeds the provided data string verbatim', () => {
    const data = '{"screens":[]}';
    const code = generateUIRuntimeCode(data);
    expect(code).toContain(`const uiData = ${data}`);
  });

  it('handles complex nested JSON data', () => {
    const data = JSON.stringify({
      screens: [
        { id: 'hud', zIndex: 10, visible: true, widgets: [] },
      ],
    });
    const code = generateUIRuntimeCode(data);
    expect(code).toContain(data);
  });

  it('handles null as data without throwing', () => {
    expect(() => generateUIRuntimeCode('null')).not.toThrow();
  });
});

// ── core DOM functions ─────────────────────────────────────────────────────────

describe('generateUIRuntimeCode: core DOM function presence', () => {
  it('defines createScreen function', () => {
    expect(generate()).toContain('function createScreen(');
  });

  it('defines createWidget function', () => {
    expect(generate()).toContain('function createWidget(');
  });

  it('defines applyPosition function', () => {
    expect(generate()).toContain('function applyPosition(');
  });

  it('defines applyStyle function', () => {
    expect(generate()).toContain('function applyStyle(');
  });

  it('defines handleButtonAction function', () => {
    expect(generate()).toContain('function handleButtonAction(');
  });
});

// ── screen visibility API ─────────────────────────────────────────────────────

describe('generateUIRuntimeCode: screen visibility functions', () => {
  it('defines showScreen function', () => {
    expect(generate()).toContain('function showScreen(');
  });

  it('defines hideScreen function', () => {
    expect(generate()).toContain('function hideScreen(');
  });

  it('defines toggleScreen function', () => {
    expect(generate()).toContain('function toggleScreen(');
  });

  it('uses screenElements Map for show/hide operations', () => {
    const code = generate();
    expect(code).toContain('screenElements.get(');
  });

  it('updates screenVisibility Map in showScreen', () => {
    const code = generate();
    expect(code).toContain('screenVisibility.set(');
  });
});

// ── widget type handling ──────────────────────────────────────────────────────

describe('generateUIRuntimeCode: widget type branches', () => {
  it('handles text widget type', () => {
    const code = generate();
    expect(code).toContain("widget.type === 'text'");
  });

  it('handles button widget type with onclick', () => {
    const code = generate();
    expect(code).toContain("widget.type === 'button'");
    expect(code).toContain('el.onclick');
  });

  it('handles progress_bar widget type', () => {
    const code = generate();
    expect(code).toContain("widget.type === 'progress_bar'");
  });

  it('creates a track + fill structure for progress bars', () => {
    const code = generate();
    expect(code).toContain('data-value-binding');
  });
});

// ── button action types ────────────────────────────────────────────────────────

describe('generateUIRuntimeCode: button action types', () => {
  it('handles show_screen action', () => {
    expect(generate()).toContain("action.type === 'show_screen'");
  });

  it('handles hide_screen action', () => {
    expect(generate()).toContain("action.type === 'hide_screen'");
  });

  it('handles toggle_screen action', () => {
    expect(generate()).toContain("action.type === 'toggle_screen'");
  });

  it('handles set_state action via window.forge', () => {
    expect(generate()).toContain("action.type === 'set_state'");
  });

  it('handles call_function action via window.forge', () => {
    expect(generate()).toContain("action.type === 'call_function'");
  });

  it('handles scene_reset action via window.forge', () => {
    expect(generate()).toContain("action.type === 'scene_reset'");
  });
});

// ── forge.ui API extension ─────────────────────────────────────────────────────

describe('generateUIRuntimeCode: forge.ui API patching', () => {
  it('extends window.forge.ui.showScreen', () => {
    expect(generate()).toContain('window.forge.ui.showScreen');
  });

  it('extends window.forge.ui.hideScreen', () => {
    expect(generate()).toContain('window.forge.ui.hideScreen');
  });

  it('extends window.forge.ui.toggleScreen', () => {
    expect(generate()).toContain('window.forge.ui.toggleScreen');
  });

  it('exposes window.forge.ui.hideAllScreens', () => {
    expect(generate()).toContain('window.forge.ui.hideAllScreens');
  });
});

// ── binding update loop ────────────────────────────────────────────────────────

describe('generateUIRuntimeCode: binding update loop', () => {
  it('schedules updateBindings via requestAnimationFrame', () => {
    const code = generate();
    expect(code).toContain('requestAnimationFrame(updateBindings)');
  });

  it('defines updateBindings function', () => {
    expect(generate()).toContain('function updateBindings(');
  });

  it('reads values from window.forge.state in updateBindings', () => {
    expect(generate()).toContain('window.forge.state');
  });
});

// ── anchor positions ───────────────────────────────────────────────────────────

describe('generateUIRuntimeCode: anchor position logic', () => {
  it('handles top_left anchor', () => {
    expect(generate()).toContain("anchor === 'top_left'");
  });

  it('handles center anchor with transform', () => {
    const code = generate();
    expect(code).toContain("anchor === 'center'");
    expect(code).toContain('translate(-50%, -50%)');
  });

  it('handles top_right anchor', () => {
    expect(generate()).toContain("anchor === 'top_right'");
  });
});

// ── initialization ─────────────────────────────────────────────────────────────

describe('generateUIRuntimeCode: initialization', () => {
  it('iterates over uiData.screens to initialize', () => {
    expect(generate()).toContain('for (const screen of uiData.screens)');
  });

  it('calls requestAnimationFrame to start the update loop', () => {
    const code = generate();
    const rafCount = (code.match(/requestAnimationFrame/g) ?? []).length;
    // At least 2: start + recursive call inside updateBindings
    expect(rafCount).toBeGreaterThanOrEqual(2);
  });

  it('guards against missing uiData.screens', () => {
    expect(generate()).toContain('if (!uiData || !uiData.screens) return');
  });

  it('guards against missing forge-ui-root element', () => {
    expect(generate()).toContain("getElementById('forge-ui-root')");
  });
});
