import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton } from '../Skeleton';
import { THEME_NAMES } from '../../tokens';

describe('Skeleton', () => {
  it('renders a skeleton element', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).not.toBeNull();
  });

  it('accepts width and height', () => {
    const { container } = render(<Skeleton width="120px" height="20px" />);
    const el = container.firstChild as HTMLElement;
    expect(el?.style.width).toBe('120px');
    expect(el?.style.height).toBe('20px');
  });

  it('uses elevated background token', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el?.className).toContain('var(--sf-bg-elevated)');
  });

  it('has motion-safe:animate-pulse class for shimmer', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el?.className).toContain('motion-safe:animate-pulse');
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<Skeleton />);
    expect(container.firstChild).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
