/**
 * Structural pin for the CapabilitiesAuthSync mount (#9117 / #9725 p8).
 *
 * `CapabilitiesAuthSync` invalidates the module-level capabilities cache when
 * the signed-in user changes, so a previous user's BYOK-aware availability
 * body cannot outlive a sign-out or an account switch. Its own unit test
 * renders the component directly, which proves the component works and proves
 * nothing about whether anything mounts it: deleting `<CapabilitiesAuthSync />`
 * from `app/layout.tsx` reintroduced the reported bug with the entire suite
 * still green — the "module built, caller never wired" shape of
 * lessons-learned #23.
 *
 * The assertion is on the SOURCE because the fact being pinned is structural:
 * layout.tsx is a server component whose Clerk branch cannot be rendered in
 * jsdom, and the same technique is already used against this exact file by
 * `public-scroll.test.ts` and against the capabilities route by
 * `availability.test.ts`'s dynamic-import pin.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const LAYOUT = resolve(__dirname, '../layout.tsx');

describe('app/layout.tsx capabilities wiring', () => {
  const src = readFileSync(LAYOUT, 'utf8');

  it('imports CapabilitiesAuthSync', () => {
    expect(src).toMatch(/import\s*\{\s*CapabilitiesAuthSync\s*\}\s*from/);
  });

  it('mounts CapabilitiesAuthSync inside the ClerkProvider branch', () => {
    // Only that branch has a Clerk session to react to, and mounting it
    // outside would call Clerk hooks with no provider above them.
    const clerkOpen = src.indexOf('<ClerkProvider');
    const clerkClose = src.indexOf('</ClerkProvider>');
    expect(clerkOpen, 'layout must still render a ClerkProvider branch').toBeGreaterThan(-1);
    expect(clerkClose).toBeGreaterThan(clerkOpen);

    const mount = src.indexOf('<CapabilitiesAuthSync');
    expect(mount, 'layout must mount <CapabilitiesAuthSync />').toBeGreaterThan(-1);
    expect(mount).toBeGreaterThan(clerkOpen);
    expect(mount).toBeLessThan(clerkClose);
  });
});
