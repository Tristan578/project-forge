import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Progress } from '../Progress';
import { THEME_NAMES } from '../../tokens';

describe('Progress', () => {
  it('renders a progress bar', () => {
    const { container } = render(<Progress value={50} />);
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
  });

  it('has correct aria-valuenow', () => {
    const { container } = render(<Progress value={75} />);
    const progress = container.querySelector('[role="progressbar"]');
    expect(progress?.getAttribute('aria-valuenow')).toBe('75');
  });

  it('has aria-valuemin and aria-valuemax', () => {
    const { container } = render(<Progress value={50} />);
    const progress = container.querySelector('[role="progressbar"]');
    expect(progress?.getAttribute('aria-valuemin')).toBe('0');
    expect(progress?.getAttribute('aria-valuemax')).toBe('100');
  });

  it('clamps value to 0-100', () => {
    const { container: c1 } = render(<Progress value={-10} />);
    const p1 = c1.querySelector('[role="progressbar"]');
    expect(p1?.getAttribute('aria-valuenow')).toBe('0');

    const { container: c2 } = render(<Progress value={150} />);
    const p2 = c2.querySelector('[role="progressbar"]');
    expect(p2?.getAttribute('aria-valuenow')).toBe('100');
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<Progress value={50} />);
    expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
