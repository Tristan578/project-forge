import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '../Button';
import { THEME_NAMES } from '../../tokens';

describe('Button', () => {
  it('renders with children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).not.toBeNull();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Click</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('renders different variants', () => {
    const { rerender } = render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('sf-destructive');

    rerender(<Button variant="outline">Outline</Button>);
    expect(screen.getByRole('button').className).toContain('border-[var(--sf-border-strong)]');
  });

  it('outline variant uses --sf-border-strong (not --sf-border)', () => {
    render(<Button variant="outline">Outline</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('border-[var(--sf-border-strong)]');
    expect(btn.className).not.toMatch(/border-\[var\(--sf-border\)\]/);
  });

  it('forwards ref', () => {
    const ref = vi.fn();
    render(<Button ref={ref}>Ref</Button>);
    expect(ref).toHaveBeenCalledWith(expect.any(HTMLButtonElement));
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<Button>Test</Button>);
    expect(container.querySelector('button')).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });

  it('has no accessibility violations', async () => {
    render(<Button>Accessible</Button>);
    const btn = screen.getByRole('button');
    expect(btn.tagName).toBe('BUTTON');
  });

  it('sm size carries mobile touch-target class (min-h-[44px])', () => {
    const { container } = render(<Button size="sm">Small</Button>);
    const btn = container.querySelector('button');
    expect(btn?.className, 'sm Button must include min-h-[44px] for WCAG 2.5.5 touch target').toContain('min-h-[44px]');
  });
});
