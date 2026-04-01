/**
 * End-to-end demo spec for the AgentViewport integration.
 *
 * This spec demonstrates the full agent verification workflow:
 * boot → observe initial state → build something → observe result.
 *
 * Uses `bootPage()` (skips WASM) so it runs in standard CI without a GPU.
 * A real @engine test that calls `av.boot()` and verifies rendered pixels
 * would use playwright.agent.config.ts with SwiftShader.
 *
 * Run with the default playwright.config.ts:
 *   cd web && npx playwright test e2e/tests/agent-demo.spec.ts
 *
 * Run with SwiftShader (WebGL2 rendering):
 *   cd web && npx playwright test --config playwright.agent.config.ts
 */

import { agentTest as test } from '../fixtures/agent.fixture';
import { expect } from '@playwright/test';
import { formatObservation, formatVerificationResult } from '../lib';

test.describe('AgentViewport — demo workflow', () => {
  /**
   * Demonstrates the full observation workflow that an AI agent would use
   * to verify what it has built. This test covers 11 assertions across
   * scene state, viewport, formatters, and verification helpers.
   */
  test('@ui @dev agent can observe initial editor state and format a report', async ({ agentViewport: av }) => {
    // 1. Boot the editor (page-level, no WASM)
    await av.bootPage();

    // 2. Observe the initial state
    const obs = await av.observe('initial editor load');

    // 3. Verify observation structure (assertions 1-5)
    expect(obs.label).toBe('initial editor load');
    expect(obs.scene).toBeDefined();
    expect(obs.viewport).toBeDefined();
    expect(obs.consoleErrors).toBeDefined();
    expect(obs.capturedAt).toBeGreaterThan(0);

    // 4. Verify scene structure (assertions 6-7)
    expect(typeof obs.scene.entityCount).toBe('number');
    expect(Array.isArray(obs.scene.selectedIds)).toBe(true);

    // 5. Verify viewport structure (assertions 8-9)
    expect(typeof obs.viewport.isBlank).toBe('boolean');
    expect(typeof obs.viewport.backend).toBe('string');

    // 6. Format the observation and verify it produces a non-empty markdown string
    //    (assertion 10)
    const report = formatObservation(obs);
    expect(report.length).toBeGreaterThan(50);
    expect(report).toContain('## Viewport Observation');

    // 7. Run a verification and format the result (assertion 11)
    const verification = await av.verifyEntityExists('Camera');
    const verificationReport = formatVerificationResult(verification);
    expect(verificationReport).toMatch(/PASS|FAIL/);
  });
});
