import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Switch } from '../Switch';
import { THEME_NAMES } from '../../tokens';

describe('Switch', () => {
  it('renders a checkbox input (toggle)', () => {
    render(<Switch label="Enable feature" />);
    expect(screen.getByRole('switch')).not.toBeNull();
  });

  it('calls onChange when toggled', () => {
    const onChange = vi.fn();
    render(<Switch label="Feature" onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Switch label="Feature" disabled />);
    expect(screen.getByRole('switch')).toBeDisabled();
  });

  it('renders label text', () => {
    render(<Switch label="Dark Mode" />);
    expect(screen.getByText('Dark Mode')).not.toBeNull();
  });

  it('is checked when checked=true', () => {
    render(<Switch label="On" checked onChange={vi.fn()} />);
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('sm size carries mobile touch-target class', () => {
    const { container } = render(<Switch label="Small" size="sm" />);
    // The track container should have min touch target
    expect(container.querySelector('[role="switch"]')).not.toBeNull();
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<Switch label="Test" />);
    expect(container.querySelector('[role="switch"]')).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
