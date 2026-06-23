/**
 * Regression guard for the sign-in route (#8820 — Clerk MFA + passkeys +
 * bot-protection hardening).
 *
 * MFA (TOTP), passkeys, and bot protection (Smart CAPTCHA) are enabled entirely
 * via Clerk Dashboard toggles — Clerk's <SignIn> renders whatever first/second
 * factors and bot-protection challenge the Dashboard has configured, with no
 * code change in this repo. @clerk/nextjs 7.5.x already supports all three, so
 * the ONLY code-side requirement is that the sign-in surface stays able to host
 * those factors: it must keep its 'use client' boundary and render <SignIn>
 * without throwing.
 *
 * Why this matters: per the CLAUDE.md gotcha, Clerk's <SignIn>/<SignUp> MUST
 * live in a 'use client' file — a Server Component that imports them triggers
 * an SSR 500 (SPAWNFORGE-AI-2). When the Dashboard later turns on a second
 * factor or passkey, that extra UI rides on the SAME render path; if a refactor
 * silently drops 'use client' or breaks the render, every hardened login 500s.
 * This test pins both invariants so that regression fails CI instead of prod.
 *
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { SignInClient } from '../SignInClient';

// Stub Clerk's <SignIn> with a marker that echoes its props. The real component
// pulls in browser-only Clerk internals; the contract under test is "the client
// boundary renders <SignIn> without crashing", not Clerk's own widget.
vi.mock('@clerk/nextjs', () => ({
  SignIn: (props: Record<string, unknown>) => (
    <div
      data-testid="clerk-sign-in"
      data-fallback-redirect-url={String(props.fallbackRedirectUrl ?? '')}
    />
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SignInClient (Clerk hardening surface — #8820)', () => {
  it('renders the Clerk <SignIn> widget without throwing (SSR-500 guard)', () => {
    expect(() => render(<SignInClient />)).not.toThrow();
    expect(screen.getByTestId('clerk-sign-in')).toBeInTheDocument();
  });

  it('forwards fallbackRedirectUrl so post-MFA/passkey login lands home', () => {
    render(<SignInClient />);
    expect(screen.getByTestId('clerk-sign-in')).toHaveAttribute(
      'data-fallback-redirect-url',
      '/'
    );
  });

  // The Dashboard-driven factors (TOTP, passkeys, bot protection) only render
  // when <SignIn> runs client-side. A Server Component hosting it 500s in SSR,
  // so the 'use client' directive is a hard requirement on BOTH auth route
  // clients — assert it at the source-file level so a refactor can't drop it.
  it.each([
    ['sign-in/[[...sign-in]]/SignInClient.tsx'],
    ['sign-up/[[...sign-up]]/SignUpClient.tsx'],
  ])('keeps the "use client" directive in %s', (relPath) => {
    const source = readFileSync(
      join(process.cwd(), 'src/app', relPath),
      'utf8'
    );
    // The directive must be the first statement (string literal) in the module.
    const firstStatement = source
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith('/*') && !line.startsWith('*') && !line.startsWith('//'));
    expect(firstStatement).toMatch(/^['"]use client['"];?$/);
  });
});
