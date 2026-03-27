import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Separator } from '../Separator';
import { THEME_NAMES } from '../../tokens';

describe('Separator', () => {
  it('renders horizontal separator by default', () => {
    const { container } = render(<Separator />);
    const sep = container.querySelector('[role="separator"]');
    expect(sep).not.toBeNull();
    expect(sep?.getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('renders vertical separator when orientation=vertical', () => {
    const { container } = render(<Separator orientation="vertical" />);
    const sep = container.querySelector('[role="separator"]');
    expect(sep?.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('uses border token for color', () => {
    const { container } = render(<Separator />);
    const sep = container.firstChild as HTMLElement;
    expect(sep?.className).toContain('var(--sf-border)');
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<Separator />);
    expect(container.firstChild).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
