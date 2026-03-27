import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from '../Card';
import { THEME_NAMES } from '../../tokens';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).not.toBeNull();
  });

  it('renders with title', () => {
    render(<Card title="My Card">Content</Card>);
    expect(screen.getByText('My Card')).not.toBeNull();
  });

  it('renders with footer', () => {
    render(<Card footer={<span>Footer</span>}>Content</Card>);
    expect(screen.getByText('Footer')).not.toBeNull();
  });

  it('uses surface background token', () => {
    const { container } = render(<Card>Test</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card?.className).toContain('var(--sf-bg-surface)');
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<Card>Test</Card>);
    expect(container.firstChild).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
