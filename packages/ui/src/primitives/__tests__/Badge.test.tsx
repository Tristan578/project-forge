import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../Badge';
import { THEME_NAMES } from '../../tokens';

describe('Badge', () => {
  it('renders children', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).not.toBeNull();
  });

  it('renders default variant', () => {
    const { container } = render(<Badge>Default</Badge>);
    expect(container.querySelector('span')).not.toBeNull();
  });

  it('renders success variant', () => {
    const { container } = render(<Badge variant="success">OK</Badge>);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('var(--sf-success)');
  });

  it('renders warning variant', () => {
    const { container } = render(<Badge variant="warning">Warn</Badge>);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('var(--sf-warning)');
  });

  it('renders destructive variant', () => {
    const { container } = render(<Badge variant="destructive">Error</Badge>);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('var(--sf-destructive)');
  });

  it('uses --sf-border-strong for border (not --sf-border)', () => {
    const { container } = render(<Badge>Test</Badge>);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('--sf-border-strong');
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<Badge>Test</Badge>);
    expect(container.querySelector('span')).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
