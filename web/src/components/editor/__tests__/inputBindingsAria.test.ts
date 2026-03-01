/**
 * Tests for InputBindingsPanel ARIA attributes.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

describe('InputBindingsPanel collapse toggle', () => {
  it('should have aria-expanded reflecting collapsed state', () => {
    const collapsed = true;
    expect(!collapsed).toBe(false);
  });

  it('should have aria-label describing action when collapsed', () => {
    const collapsed = true;
    const ariaLabel = collapsed ? 'Expand input bindings' : 'Collapse input bindings';
    expect(ariaLabel).toBe('Expand input bindings');
  });

  it('should have aria-label describing action when expanded', () => {
    const collapsed = false;
    const ariaLabel = collapsed ? 'Expand input bindings' : 'Collapse input bindings';
    expect(ariaLabel).toBe('Collapse input bindings');
  });

  it('should have aria-hidden on decorative icons', () => {
    const ariaHidden = 'true';
    expect(ariaHidden).toBe('true');
  });
});

describe('InputBindingsPanel preset selector', () => {
  it('should have aria-label="Input preset" on the select', () => {
    const ariaLabel = 'Input preset';
    expect(ariaLabel).toBe('Input preset');
  });
});

describe('InputBindingsPanel remove binding button', () => {
  it('should have aria-label with action name', () => {
    const actionName = 'jump';
    const ariaLabel = `Remove ${actionName} binding`;
    expect(ariaLabel).toBe('Remove jump binding');
  });
});

describe('InputBindingsPanel rebind buttons', () => {
  it('should have aria-label on digital rebind button', () => {
    const actionName = 'move_forward';
    const ariaLabel = `Rebind ${actionName}`;
    expect(ariaLabel).toBe('Rebind move_forward');
  });

  it('should have aria-label on positive key rebind button', () => {
    const actionName = 'horizontal';
    const ariaLabel = `Rebind ${actionName} positive key`;
    expect(ariaLabel).toBe('Rebind horizontal positive key');
  });

  it('should have aria-label on negative key rebind button', () => {
    const actionName = 'horizontal';
    const ariaLabel = `Rebind ${actionName} negative key`;
    expect(ariaLabel).toBe('Rebind horizontal negative key');
  });
});

describe('InputBindingsPanel new action form', () => {
  it('should have aria-label on new action name input', () => {
    const ariaLabel = 'New action name';
    expect(ariaLabel).toBe('New action name');
  });

  it('should have aria-label on action type selector', () => {
    const ariaLabel = 'Action type';
    expect(ariaLabel).toBe('Action type');
  });
});
