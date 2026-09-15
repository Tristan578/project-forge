import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InlineAlert } from '../InlineAlert';
import { THEME_NAMES } from '../../tokens';

describe('InlineAlert', () => {
  it('renders children', () => {
    render(<InlineAlert variant="warning">Heads up</InlineAlert>);
    expect(screen.getByText('Heads up')).toBeInTheDocument();
  });

  it('uses role="alert" for the error variant', () => {
    render(<InlineAlert variant="error">Boom</InlineAlert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    // Error is assertive, never polite.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('uses role="status" for the warning variant', () => {
    render(<InlineAlert variant="warning">Careful</InlineAlert>);
    expect(screen.getByRole('status')).toHaveTextContent('Careful');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('uses role="status" for the info variant', () => {
    render(<InlineAlert variant="info">FYI</InlineAlert>);
    expect(screen.getByRole('status')).toHaveTextContent('FYI');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('defaults to the warning variant', () => {
    render(<InlineAlert>Default</InlineAlert>);
    expect(screen.getByRole('status')).toHaveTextContent('Default');
  });

  it('applies an optional id', () => {
    render(
      <InlineAlert variant="info" id="my-alert">
        Tagged
      </InlineAlert>,
    );
    expect(screen.getByRole('status')).toHaveAttribute('id', 'my-alert');
  });

  it('derives the role from variant even when a role prop is passed', () => {
    // The severity contract is authoritative; a caller cannot downgrade an
    // error to a polite status by spreading a role.
    render(
      <InlineAlert variant="error" role="status">
        Enforced
      </InlineAlert>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Enforced');
  });

  it('merges an extra className', () => {
    const { container } = render(
      <InlineAlert variant="warning" className="mb-4">
        Spaced
      </InlineAlert>,
    );
    expect((container.firstChild as HTMLElement).className).toContain('mb-4');
  });

  it.each(['warning', 'error', 'info'] as const)(
    'uses only token-driven colours for the %s variant (no raw amber/yellow/red literals)',
    (variant) => {
      const { container } = render(
        <InlineAlert variant={variant}>Colour check</InlineAlert>,
      );
      const box = container.firstChild as HTMLElement;
      // Tailwind palette literals (amber-300, yellow-900/50, red-400, ...) must
      // never appear — colour comes from --sf-* variables only.
      expect(box.className).not.toMatch(/\b(amber|yellow|red|orange)-\d/);
      expect(box.className).toContain('var(--sf-');
    },
  );

  it.each(THEME_NAMES)('renders without hardcoded primitives in %s theme', (theme) => {
    document.documentElement.setAttribute('data-sf-theme', theme);
    const { container } = render(<InlineAlert variant="warning">Test</InlineAlert>);
    const allClasses = Array.from(container.querySelectorAll('[class]')).flatMap((el) =>
      el.className.split(' '),
    );
    const leaks = allClasses.filter((c) => /zinc-|stone-|slate-|amber-|yellow-|red-/.test(c));
    expect(leaks, `Hardcoded palette classes found: ${leaks.join(', ')}`).toHaveLength(0);
  });
});
