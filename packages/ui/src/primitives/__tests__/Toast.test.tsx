import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Toast } from '../Toast';
import { THEME_NAMES } from '../../tokens';

describe('Toast', () => {
  it('renders message', () => {
    render(<Toast message="Operation successful" onDismiss={vi.fn()} />);
    expect(screen.getByText('Operation successful')).not.toBeNull();
  });

  it('renders info variant by default', () => {
    const { container } = render(<Toast message="Info" onDismiss={vi.fn()} />);
    expect(container.firstChild).not.toBeNull();
  });

  it('renders success variant', () => {
    const { container } = render(<Toast message="Saved" variant="success" onDismiss={vi.fn()} />);
    const toast = container.firstChild as HTMLElement;
    expect(toast?.className).toContain('var(--sf-success)');
  });

  it('renders error variant', () => {
    const { container } = render(<Toast message="Error occurred" variant="error" onDismiss={vi.fn()} />);
    const toast = container.firstChild as HTMLElement;
    expect(toast?.className).toContain('var(--sf-destructive)');
  });

  it('calls onDismiss when close button is clicked', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Click to dismiss" onDismiss={onDismiss} />);
    const closeBtn = screen.getByRole('button');
    closeBtn.click();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('auto-dismisses after duration', () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(<Toast message="Auto dismiss" onDismiss={onDismiss} duration={1000} />);
    act(() => { vi.advanceTimersByTime(1100); });
    expect(onDismiss).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it.each(THEME_NAMES)('renders without error in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<Toast message="Test" onDismiss={vi.fn()} />);
    expect(container.firstChild).not.toBeNull();
    const allClasses = Array.from(container.querySelectorAll('[class]'))
      .flatMap((el) => el.className.split(' '));
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-/.test(c));
    expect(leaks, `Hardcoded primitives found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
