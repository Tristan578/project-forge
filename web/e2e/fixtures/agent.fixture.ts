import { test as base } from '@playwright/test';
import { AgentViewport } from '../lib/agentViewport';

/**
 * Extended test fixture that provides an `AgentViewport` instance.
 *
 * Separated from editor.fixture.ts to avoid a circular dependency:
 * editor.fixture.ts exports EditorPage, agentViewport.ts imports EditorPage,
 * so editor.fixture.ts cannot also import AgentViewport.
 */
export const agentTest = base.extend<{ agentViewport: AgentViewport }>({
  agentViewport: async ({ page }, use) => {
    const av = new AgentViewport(page);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(av);
  },
});
