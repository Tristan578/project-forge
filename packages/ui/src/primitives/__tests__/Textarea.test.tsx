import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Textarea } from '../Textarea';
import { THEME_NAMES } from '../../tokens';

describe('Textarea', () => {
  it('renders a textarea element', () => {
    render(<Textarea placeholder="Enter text" />);
    expect(screen.getByPlaceholderText('Enter text')).not.toBeNull();
  });

  it('calls onChange when value changes', () => {
    const onChange = vi.fn();
    render(<Textarea onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('is disabled when disabled prop is true', () => {
    render(<Textarea disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('applies error styling when error is true', () => {
    const { container } = render(<Textarea error />);
    const ta = container.querySelector('textarea');
    expect(ta?.className).toContain('border-[var(--sf-destructive)]');
  });

  it('forwards ref', () => {
    const ref = vi.fn();
    render(<Textarea ref={ref} />);
    expect(ref).toHaveBeenCalledWith(expect.any(HTMLTextAreaElement));
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<Textarea placeholder="test" />);
    expect(container.querySelector('textarea')).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });

  it('uses --sf-border-strong for default border (not --sf-border)', () => {
    const { container } = render(<Textarea aria-label="Test" />);
    const textarea = container.querySelector('textarea');
    expect(textarea?.className).toContain('border-[var(--sf-border-strong)]');
    expect(textarea?.className).not.toMatch(/border-\[var\(--sf-border\)\]/);
  });
});
