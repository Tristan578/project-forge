/**
 * Tests for proxy.ts — public route configuration.
 *
 * Verifies that unauthenticated routes (health, status, webhooks, etc.)
 * are included in the public routes list so Clerk auth doesn't block them.
 *
 * proxy.ts uses dynamic require() for Clerk at module scope, making it
 * difficult to mock. We validate the route configuration by reading the
 * source file and checking for the expected route patterns.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const proxySource = fs.readFileSync(
  path.resolve(__dirname, '../proxy.ts'),
  'utf-8',
);

describe('proxy public route configuration', () => {
  it('includes /api/health in public routes', () => {
    expect(proxySource).toContain('/api/health');
  });

  it('includes /api/status in public routes', () => {
    expect(proxySource).toContain('/api/status');
  });

  it('includes webhook routes in public routes', () => {
    expect(proxySource).toContain('/api/auth/webhook');
    expect(proxySource).toContain('/api/stripe/webhook');
  });

  it('includes sign-in and sign-up in public routes', () => {
    expect(proxySource).toContain('/sign-in');
    expect(proxySource).toContain('/sign-up');
  });

  it('includes community routes in public routes', () => {
    expect(proxySource).toContain('/api/community');
  });

  it('does not expose /api/generate as a public route', () => {
    // Generate endpoints require authentication — they should NOT be in publicRoutes
    expect(proxySource).not.toMatch(/['"]\/api\/generate/);
  });

  it('redirects unauthenticated browser nav instead of rewriting to /404 (#8529)', () => {
    // Clerk's `auth.protect()` default rewrites to /404 for browser navigations.
    // That gives users no recovery path. We must call redirectToSignIn() so
    // unauthenticated visitors land on /sign-in with a return URL.
    expect(proxySource).toContain('redirectToSignIn');
    expect(proxySource).toContain('returnBackUrl');
    // And the proxy should NOT call auth.protect() any more, which would
    // re-introduce the 404 regression. Strip comments before matching so the
    // explanatory comment that mentions auth.protect() doesn't trigger this.
    const codeWithoutComments = proxySource.replace(/\/\/.*$/gm, '');
    expect(codeWithoutComments).not.toMatch(/auth\.protect\(\)/);
  });

  it('returns 401 (not 307) for unauthenticated /api/* requests', () => {
    // Browser nav -> 307 to sign-in. API requests -> 401 JSON so client code
    // can distinguish "unauthenticated" from "not found" without parsing HTML.
    expect(proxySource).toMatch(/pathname\.startsWith\(['"]\/api\//);
    expect(proxySource).toMatch(/status:\s*401/);
  });
});
