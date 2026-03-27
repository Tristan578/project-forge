import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tooltip } from '../Tooltip';
import { THEME_NAMES } from '../../tokens';

describe('Tooltip', () => {
  it('renders children', () => {
    render(
      <Tooltip content="Helpful tip">
        <button>Hover me</button>
      </Tooltip>
    );
    expect(screen.getByRole('button')).not.toBeNull();
  });

  it('has tooltip content in DOM (hidden initially)', () => {
    const { container } = render(
      <Tooltip content="My tooltip">
        <button>Trigger</button>
      </Tooltip>
    );
    expect(container.querySelector('[role="tooltip"]')).not.toBeNull();
  });

  it('uses overlay background token', () => {
    const { container } = render(
      <Tooltip content="Tooltip text">
        <button>Trigger</button>
      </Tooltip>
    );
    const tooltip = container.querySelector('[role="tooltip"]');
    expect(tooltip?.className).toContain('var(--sf-bg-overlay)');
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(
      <Tooltip content="Test tooltip">
        <button>Trigger</button>
      </Tooltip>
    );
    expect(container.querySelector('[role="tooltip"]')).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
