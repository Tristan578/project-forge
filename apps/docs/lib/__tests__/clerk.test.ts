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
import { hasValidClerkKey } from '../clerk';

const DOCS_ROOT = resolve(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(DOCS_ROOT, ...parts), 'utf-8');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('hasValidClerkKey', () => {
  it.each(['pk_test_Zm9vLWJhci5jbGVyay5hY2NvdW50cy5kZXYk', 'pk_live_c3Bhd25mb3JnZS5haSQ'])(
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
  ])('rejects %s', (_label, key) => {
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', key);
    expect(hasValidClerkKey()).toBe(false);
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
