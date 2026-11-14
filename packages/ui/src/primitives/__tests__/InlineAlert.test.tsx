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
      expect(box.className).toContain('var(--sf-');
    },
  );

  // #9726 regression: the body text MUST be `--sf-text`, never the variant's
  // own semantic token. Painting `text-[var(--sf-warning|destructive|accent)]`
  // over a 12% tint of that same token fails WCAG AA 4.5:1 in most themes (as
  // low as ~2.9:1 for destructive in rust) — the exact pairing PF-1229 removed
  // from OrchestratorPanel. Contrast per theme is graded in
  // tokens/__tests__/themes.test.ts; this pins the class the primitive emits so
  // the semantic-token-as-text pattern can never come back.
  it.each([
    ['warning', '--sf-warning'],
    ['error', '--sf-destructive'],
    ['info', '--sf-accent'],
  ] as const)(
    'paints body text with --sf-text, never the semantic token, for the %s variant',
    (variant, semanticToken) => {
      const { container } = render(
        <InlineAlert variant={variant}>Readable</InlineAlert>,
      );
      const box = container.firstChild as HTMLElement;
      expect(box.className).toContain('text-[var(--sf-text)]');
      // The semantic token may still drive border/bg, but never the text color.
      expect(box.className).not.toContain(`text-[var(${semanticToken})]`);
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
