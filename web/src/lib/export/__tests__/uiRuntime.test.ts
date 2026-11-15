// @vitest-environment jsdom
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
    expect(generate()).not.toBe('');
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

describe('generateUIRuntimeCode: anchor + constraint position logic', () => {
  // Execute the generated runtime against a real jsdom DOM and read back the
  // inline styles it applies (ui.FR-1.OP-01). Asserting on rendered effect —
  // not source substrings — keeps these tests honest as the generator evolves,
  // and proves the exported runtime resolves the SAME layout as the editor
  // preview (widgetRenderer.ts).
  function runRuntime(widget: Record<string, unknown>): HTMLElement {
    document.body.innerHTML = '<div id="forge-ui-root"></div>';
    const uiData = JSON.stringify({
      screens: [
        {
          id: 's1',
          zIndex: 0,
          visible: true,
          showOnStart: true,
          backgroundColor: 'transparent',
          widgets: [{ id: 'w1', type: 'panel', config: {}, style: {}, ...widget }],
        },
      ],
    });
    // Indirect eval executes the self-invoking IIFE in the jsdom global scope.
    (0, eval)(generateUIRuntimeCode(uiData));
    const el = document.getElementById('ui-widget-s1-w1');
    if (!el) throw new Error('widget element was not created');
    return el as HTMLElement;
  }

  it('resolves top_left from the top-left origin', () => {
    const el = runRuntime({ anchor: 'top_left', x: 10, y: 20, width: 30, height: 40 });
    expect(el.style.left).toBe('10%');
    expect(el.style.top).toBe('20%');
    expect(el.style.width).toBe('30%');
    expect(el.style.right).toBe('');
    expect(el.style.bottom).toBe('');
  });

  it('resolves top_right from the right edge', () => {
    const el = runRuntime({ anchor: 'top_right', x: 100, y: 0, width: 20, height: 10 });
    expect(el.style.right).toBe('0%');
    expect(el.style.left).toBe('');
    expect(el.style.top).toBe('0%');
  });

  it('resolves center with both centering transforms', () => {
    const el = runRuntime({ anchor: 'center', x: 50, y: 50, width: 20, height: 20 });
    expect(el.style.left).toBe('50%');
    expect(el.style.top).toBe('50%');
    expect(el.style.transform).toContain('translateX(-50%)');
    expect(el.style.transform).toContain('translateY(-50%)');
  });

  it('resolves bottom_center anchored to the bottom edge, centered horizontally', () => {
    const el = runRuntime({ anchor: 'bottom_center', x: 50, y: 100, width: 40, height: 10 });
    expect(el.style.bottom).toBe('0%');
    expect(el.style.left).toBe('50%');
    expect(el.style.transform).toContain('translateX(-50%)');
    expect(el.style.transform).not.toContain('translateY');
  });

  it('resolves center_left (previously unsupported anchor) instead of dropping position', () => {
    const el = runRuntime({ anchor: 'center_left', x: 0, y: 50, width: 20, height: 10 });
    expect(el.style.left).toBe('0%');
    expect(el.style.top).toBe('50%');
    expect(el.style.transform).toContain('translateY(-50%)');
  });

  it('folds a pixel offset into calc() and emits min/max size bounds', () => {
    const el = runRuntime({
      anchor: 'top_left',
      x: 10,
      y: 20,
      width: 5,
      height: 5,
      constraints: { offsetX: 16, offsetY: -8, minWidth: 44, minHeight: 44, maxWidth: 320 },
    });
    expect(el.style.left).toBe('calc(10% + 16px)');
    expect(el.style.top).toBe('calc(20% - 8px)');
    expect(el.style.minWidth).toBe('44px');
    expect(el.style.minHeight).toBe('44px');
    expect(el.style.maxWidth).toBe('320px');
  });

  it('offsets a right-anchored widget with a subtracted calc()', () => {
    const el = runRuntime({
      anchor: 'top_right',
      x: 100,
      y: 0,
      width: 20,
      height: 10,
      constraints: { offsetX: -16, offsetY: 16 },
    });
    // right = (100 - x)% - offX  => calc(0% + 16px)
    expect(el.style.right).toBe('calc(0% + 16px)');
    expect(el.style.top).toBe('calc(0% + 16px)');
  });

  it('falls back to absolute positioning for a widget with no constraints (legacy scenes)', () => {
    const el = runRuntime({ anchor: 'top_left', x: 25, y: 25, width: 10, height: 10 });
    expect(el.style.left).toBe('25%');
    expect(el.style.minWidth).toBe('');
    expect(el.style.maxWidth).toBe('');
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

// ── script injection prevention (Fix 1) ───────────────────────────────────────

describe('generateUIRuntimeCode: script injection prevention', () => {
  it('escapes </script> in uiData to prevent early tag termination', () => {
    const malicious = '{"screens":[],"name":"</script><script>alert(1)//"}';
    const code = generateUIRuntimeCode(malicious);
    expect(code).not.toContain('</script>');
    expect(code).toContain('<\\/script>');
  });

  it('escapes <!-- in uiData to prevent HTML comment injection', () => {
    const malicious = '{"screens":[],"name":"<!--"}';
    const code = generateUIRuntimeCode(malicious);
    expect(code).not.toContain('<!--');
    expect(code).toContain('\\x3C!--');
  });

  it('does not alter safe JSON uiData', () => {
    const safe = '{"screens":[]}';
    const code = generateUIRuntimeCode(safe);
    expect(code).toContain(`const uiData = ${safe}`);
  });

  it('rejects non-JSON uiData with JS injection payload', () => {
    expect(() => generateUIRuntimeCode('}; alert(1) //')).toThrow('uiData must be valid JSON');
  });

  it('handles multiple </script> occurrences in uiData', () => {
    const malicious = JSON.stringify({ a: '</script>', b: '</script>' });
    const code = generateUIRuntimeCode(malicious);
    expect(code).not.toContain('</script>');
    const count = (code.match(/<\\\/script/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});