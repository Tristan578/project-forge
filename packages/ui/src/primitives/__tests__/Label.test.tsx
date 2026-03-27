import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Label } from '../Label';
import { THEME_NAMES } from '../../tokens';

describe('Label', () => {
  it('renders children', () => {
    render(<Label>Name</Label>);
    expect(screen.getByText('Name')).not.toBeNull();
  });

  it('renders as label element', () => {
    const { container } = render(<Label>Email</Label>);
    expect(container.querySelector('label')).not.toBeNull();
  });

  it('associates with input via htmlFor', () => {
    const { container } = render(
      <>
        <Label htmlFor="email">Email</Label>
        <input id="email" />
      </>
    );
    const label = container.querySelector('label');
    expect(label?.htmlFor).toBe('email');
  });

  it('applies required indicator when required', () => {
    render(<Label required>Name</Label>);
    expect(screen.getByText('*')).not.toBeNull();
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<Label>Test</Label>);
    expect(container.querySelector('label')).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
