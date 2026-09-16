import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InlineAlert } from '../InlineAlert';
import { THEME_NAMES, THEME_DEFINITIONS } from '../../tokens';

function rgb(hex: string): number[] {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function luminance(channels: number[]): number {
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

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
    expect(screen.getByRole('status')).toHaveClass('bg-[color-mix(in_srgb,var(--sf-warning)_12%,var(--sf-bg-surface))]');
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
    // error to a polite status by spreading a role. `role` is intentionally
    // not part of InlineAlertProps (#9726 review), so a caller can only get
    // one in here by widening the type — exercise that runtime guarantee via
    // an untyped spread rather than a direct prop, matching how a JS caller
    // (or one with an `any`-typed value) would actually hit this path.
    const overrides = { role: 'status' } as Record<string, string>;
    render(
      <InlineAlert variant="error" {...overrides}>
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
      const token = { warning: '--sf-warning', error: '--sf-destructive', info: '--sf-accent' }[variant];
      expect(box).toHaveClass(
        `border-[color-mix(in_srgb,var(${token})_40%,transparent)]`,
        `bg-[color-mix(in_srgb,var(${token})_12%,var(--sf-bg-surface))]`,
        'text-[var(--sf-text)]',
      );
    },
  );

  it.each(THEME_NAMES)('keeps notice text above AA contrast in %s', (theme) => {
    const tokens = THEME_DEFINITIONS[theme];
    const foreground = luminance(rgb(tokens['--sf-text']));
    const surface = rgb(tokens['--sf-bg-surface']);
    for (const severity of ['--sf-warning', '--sf-destructive', '--sf-accent'] as const) {
      const tint = rgb(tokens[severity]);
      const background = luminance(surface.map((channel, index) => channel * 0.88 + tint[index] * 0.12));
      const ratio = (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      expect(ratio, `${theme} ${severity} text contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });

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
