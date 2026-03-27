import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar } from '../Avatar';
import { THEME_NAMES } from '../../tokens';

describe('Avatar', () => {
  it('renders initials when no src', () => {
    render(<Avatar name="John Doe" />);
    expect(screen.getByText('JD')).not.toBeNull();
  });

  it('renders single initial for single name', () => {
    render(<Avatar name="Alice" />);
    expect(screen.getByText('A')).not.toBeNull();
  });

  it('renders image when src provided', () => {
    const { container } = render(<Avatar src="avatar.png" alt="User avatar" />);
    const img = container.querySelector('img');
    expect(img?.src).toContain('avatar.png');
  });

  it('applies size variants', () => {
    const { container, rerender } = render(<Avatar name="JD" size="sm" />);
    const sm = container.firstChild as HTMLElement;
    expect(sm?.className).toContain('h-6');

    rerender(<Avatar name="JD" size="lg" />);
    const lg = container.firstChild as HTMLElement;
    expect(lg?.className).toContain('h-12');
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<Avatar name="Test User" />);
    expect(container.firstChild).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
