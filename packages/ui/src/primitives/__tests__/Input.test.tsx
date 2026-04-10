import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from '../Input';
import { THEME_NAMES } from '../../tokens';

describe('Input', () => {
  it('renders an input element', () => {
    render(<Input placeholder="Enter text" />);
    expect(screen.getByPlaceholderText('Enter text')).not.toBeNull();
  });

  it('calls onChange when value changes', () => {
    const onChange = vi.fn();
    render(<Input onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Input disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('applies error styling when error is true', () => {
    const { container } = render(<Input error />);
    const input = container.querySelector('input');
    expect(input?.className).toContain('border-[var(--sf-destructive)]');
  });

  it('forwards ref', () => {
    const ref = vi.fn();
    render(<Input ref={ref} />);
    expect(ref).toHaveBeenCalledWith(expect.any(HTMLInputElement));
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<Input placeholder="test" />);
    expect(container.querySelector('input')).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });

  it('has correct role', () => {
    render(<Input />);
    expect(screen.getByRole('textbox').tagName).toBe('INPUT');
  });

  it('uses --sf-border-strong for default border (not --sf-border)', () => {
    const { container } = render(<Input />);
    const input = container.querySelector('input');
    expect(input?.className).toContain('border-[var(--sf-border-strong)]');
    expect(input?.className).not.toMatch(/border-\[var\(--sf-border\)\]/);
  });
});
