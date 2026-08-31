/**
 * Guards the Clerk key gate for the docs app.
 *
 * Two failures are in scope, both from #9378 / #9384:
 *
 *  1. `<ClerkProvider>` used to be unconditional here. @clerk/nextjs 7.8.0 added
 *     `throwMissingPublishableKeyError()` to the keyless branch, so `npm run dev`
 *     without Clerk keys throws on every route.
 *  2. Guarding the layout alone is not enough. `/sign-in` is public and renders
 *     `<SignIn />`, which needs the provider context the layout now skips — so
 *     the fix for (1) moved the crash to one route instead of removing it.
 *
 * The predicate gets behavioural tests; the two call sites get a source scan,
 * because "this file forgot to call the guard" is the absence of a rule and
 * cannot be asserted by rendering.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import {
  assertClerkPublishableKeyShape,
  clerkPublishableKeyProblem,
  hasValidClerkKey,
} from '../clerk';

/** The exact value that was live on the docs Vercel project (#9044). */
const PASTED_ASSIGNMENT =
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_c3Bhd25mb3JnZS5haSQ';

/** `pk_(test|live)_` + base64 of `<host>$` — the real key shape. */
const keyFor = (host: string, prefix = 'pk_test_') =>
  `${prefix}${Buffer.from(`${host}$`, 'utf8').toString('base64')}`;

const VALID_TEST = keyFor('sunny-cat-42.clerk.accounts.dev');
const VALID_LIVE = keyFor('clerk.spawnforge.ai', 'pk_live_');

const DOCS_ROOT = resolve(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(DOCS_ROOT, ...parts), 'utf-8');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('hasValidClerkKey', () => {
  it.each([VALID_TEST, VALID_LIVE])(
    'accepts a well-formed key (%s)',
    (key) => {
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', key);
      expect(hasValidClerkKey()).toBe(true);
    }
  );

  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['a placeholder', 'your-key-here'],
    ['a secret key pasted by mistake', 'sk_test_deadbeef'],
    ['whitespace-prefixed', ' pk_test_deadbeef'],
    ['the whole KEY=value assignment pasted as the value', PASTED_ASSIGNMENT],
  ])('rejects %s', (_label, key) => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', key);
    expect(hasValidClerkKey()).toBe(false);
  });
});

describe('clerkPublishableKeyProblem', () => {
  // MISSING and MALFORMED are different states and the build treats them
  // differently, so the predicate that separates them is tested directly rather
  // than only through hasValidClerkKey()'s single boolean (#9044).
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['a valid test key', VALID_TEST],
    ['a valid live key', VALID_LIVE],
  ])('reports no problem for %s', (_label, key) => {
    expect(clerkPublishableKeyProblem(key)).toBeNull();
  });

  it('names the paste-the-whole-assignment mistake specifically', () => {
    const problem = clerkPublishableKeyProblem(PASTED_ASSIGNMENT);
    expect(problem).not.toBeNull();
    // The whole point is that the message says what to fix. A generic
    // "invalid key" would have been just as useless as the silence it replaces.
    expect(problem).toContain('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...');
    expect(problem).toContain('pasted in as the VALUE');
  });

  it('names a secret key without echoing it', () => {
    const problem = clerkPublishableKeyProblem('sk_live_realsecretvalue');
    expect(problem).toContain('SECRET key');
    expect(problem).not.toContain('realsecretvalue');
  });

  it('distinguishes whitespace from a genuinely wrong value', () => {
    expect(clerkPublishableKeyProblem(` ${VALID_TEST} `)).toContain('whitespace');
    expect(clerkPublishableKeyProblem('your-key-here')).toContain('which is not');
  });

  // The prefix alone is NOT the contract, and this site is the proof. Clerk
  // base64-encodes `<host>$` in the payload and derives its script host from
  // it, so a right-prefix key with a junk payload resolves to an EMPTY host —
  // which is exactly how clerk-js came to be fetched from `https:///npm/...`.
  it.each([
    ['an empty payload', 'pk_test_'],
    ['a payload that is not valid base64', 'pk_live_!!!not-base64!!!'],
    [
      "a payload missing Clerk's $ terminator",
      `pk_test_${Buffer.from('clerk.example.com', 'utf8').toString('base64')}`,
    ],
    [
      'a payload decoding to something that is not a hostname',
      `pk_test_${Buffer.from('not a host$', 'utf8').toString('base64')}`,
    ],
    ['a truncated payload', VALID_LIVE.slice(0, VALID_LIVE.length - 6)],
    ['the .env.example placeholder', 'pk_test_xxx'],
  ])('rejects %s despite the valid prefix', (_label, key) => {
    const problem = clerkPublishableKeyProblem(key);
    expect(problem, `expected ${key} to be rejected`).not.toBeNull();
    expect(problem).toContain('does not decode to a Clerk Frontend API host');
  });
});

describe('assertClerkPublishableKeyShape', () => {
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['a valid live key', VALID_LIVE],
  ])('does not throw for %s', (_label, key) => {
    expect(() => assertClerkPublishableKeyShape(key)).not.toThrow();
  });

  it('throws on the production paste error, naming the variable', () => {
    expect(() => assertClerkPublishableKeyShape(PASTED_ASSIGNMENT)).toThrow(
      /NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is set but unusable/
    );
  });

  it('reads process.env when called with no argument', () => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', PASTED_ASSIGNMENT);
    expect(() => assertClerkPublishableKeyShape()).toThrow(/set but unusable/);
  });

  it('is wired into the docs build, not just exported', () => {
    // A guard nobody calls is not a guard. next.config.ts is evaluated by
    // `next build`, so this is what makes a bad value a red deploy rather than
    // a silently broken auth surface.
    const config = read('next.config.ts');
    expect(config).toMatch(/from '\.\/lib\/clerk'/);
    expect(
      config,
      'next.config.ts imports assertClerkPublishableKeyShape but never calls it — ' +
        'a malformed key would build clean and ship dead auth again (#9044).'
    ).toMatch(/^assertClerkPublishableKeyShape\(\);$/m);
  });
});

describe('Clerk entry points', () => {
  it('layout.tsx gates <ClerkProvider> on the shared predicate', () => {
    const layout = read('app', 'layout.tsx');

    expect(layout).toMatch(/from '\.\.\/lib\/clerk'/);
    expect(
      layout,
      'layout.tsx renders <ClerkProvider> without calling hasValidClerkKey() — ' +
        'every route throws in a checkout with no Clerk keys (#9378).'
    ).toMatch(/hasValidClerkKey\(\)\s*\?\s*<ClerkProvider>/);
  });

  it('renders <ClerkProvider> inside <body>, never around <html>', () => {
    const layout = read('app', 'layout.tsx');
    const body = layout.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

    expect(
      body,
      'Clerk Core 3 (@clerk/nextjs v7) requires the provider inside <body>. ' +
        'Wrapping <html> is a hydration hazard under Next.js 16 cache components.'
    ).not.toMatch(/<ClerkProvider[^>]*>\s*<html/);
  });

  it('the sign-in page gates <SignIn /> on the same predicate', () => {
    const page = read('app', 'sign-in', '[[...sign-in]]', 'page.tsx');

    expect(page).toMatch(/hasValidClerkKey/);
    expect(
      page,
      '/sign-in is public and <SignIn /> needs ClerkProvider context. Without ' +
        'its own guard the layout fix just relocates the crash to this route.'
    ).toMatch(/if\s*\(\s*!hasValidClerkKey\(\)\s*\)/);
  });

  it('keeps <SignIn /> out of the server component', () => {
    const page = read('app', 'sign-in', '[[...sign-in]]', 'page.tsx');
    const client = read('app', 'sign-in', '[[...sign-in]]', 'SignInClient.tsx');

    // Strip comments — the guard's own comment names <SignIn /> in prose.
    const pageCode = page.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

    expect(pageCode).not.toMatch(/<SignIn\s/);
    expect(client).toMatch(/^'use client';/);
    expect(client).toMatch(/<SignIn\s*\/>/);
  });
});
