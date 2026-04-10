import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Checkbox } from '../Checkbox';
import { THEME_NAMES } from '../../tokens';

describe('Checkbox', () => {
  it('renders a checkbox input', () => {
    render(<Checkbox label="Accept terms" />);
    expect(screen.getByRole('checkbox')).not.toBeNull();
  });

  it('calls onChange when checked', () => {
    const onChange = vi.fn();
    render(<Checkbox label="Check me" onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Checkbox label="Option" disabled />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('renders label text', () => {
    render(<Checkbox label="Remember me" />);
    expect(screen.getByText('Remember me')).not.toBeNull();
  });

  it('is checked when checked=true', () => {
    render(<Checkbox label="Checked" checked onChange={vi.fn()} />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('associates label with checkbox via id', () => {
    const { container } = render(<Checkbox label="Test" />);
    const checkbox = container.querySelector('input[type="checkbox"]');
    const label = container.querySelector('label');
    expect(checkbox?.id).toBeTruthy();
    expect(label?.htmlFor).toBe(checkbox?.id);
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<Checkbox label="Test" />);
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => (el.getAttribute('class') ?? '').split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });

  it('uses --sf-border-strong for default border (not --sf-border)', () => {
    // Visible checkbox is rendered as a sibling <label> (peer pattern) since the
    // real <input> is sr-only. Border classes live on that visible label.
    const { container } = render(<Checkbox label="Test" />);
    const visible = container.querySelector('label[aria-hidden="true"]');
    expect(visible?.className).toContain('border-[var(--sf-border-strong)]');
    expect(visible?.className).not.toMatch(/border-\[var\(--sf-border\)\]/);
  });
});
