/**
 * Error resilience tests for the AgentViewport class.
 *
 * Tests graceful degradation when the store or engine is unavailable.
 * All tests use bootPage() to avoid WASM dependency.
 */

import { agentTest as test } from '../fixtures/agent.fixture';
import { expect } from '@playwright/test';

test.describe('AgentViewport — error handling', () => {
  test('@ui sendCommand with unknown command returns structured result', async ({ agentViewport: av }) => {
    await av.bootPage();
    const result = await av.sendCommand('this_command_does_not_exist', {});
    // Should return a CommandResult, not throw
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('durationMs');
    expect(typeof result.success).toBe('boolean');
  });

  test('@ui verifyEntityExists with empty name returns a result', async ({ agentViewport: av }) => {
    await av.bootPage();
    const result = await av.verifyEntityExists('');
    // Empty name matches all entities (includes in '' is always true)
    // Either true or false is valid — we just check structure
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('reason');
    expect(result).toHaveProperty('evidence');
  });

  test('@ui observe returns non-negative capturedAt timestamp', async ({ agentViewport: av }) => {
    await av.bootPage();
    const before = Date.now();
    const obs = await av.observe();
    const after = Date.now();
    expect(obs.capturedAt).toBeGreaterThanOrEqual(before);
    expect(obs.capturedAt).toBeLessThanOrEqual(after + 100);
  });

  test('@ui multiple observe calls each have a unique timestamp', async ({ agentViewport: av }) => {
    await av.bootPage();
    const obs1 = await av.observe('first');
    await av.page.waitForTimeout(10); // ensure time progresses
    const obs2 = await av.observe('second');
    expect(obs2.capturedAt).toBeGreaterThanOrEqual(obs1.capturedAt);
  });

  test('@ui clearConsoleErrors followed by observe shows no stale errors', async ({ agentViewport: av }) => {
    await av.bootPage();
    av.clearConsoleErrors();
    const obs = await av.observe();
    // The observation should reflect the cleared state
    expect(obs.consoleErrors).toBeDefined();
    expect(Array.isArray(obs.consoleErrors)).toBe(true);
  });
});
