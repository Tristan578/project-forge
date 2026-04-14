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
});
