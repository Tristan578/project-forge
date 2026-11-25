// @vitest-environment jsdom
/**
 * PF-1148 over the MCP bridge: an agent that asks for a value the engine will
 * not hold gets told so in its `command_result`, not just "success".
 *
 * Deliberately NOT mocking `executeToolCall` (the neighbouring bridge suite
 * does): the claim under test is that the real handler's structured report
 * survives the real bridge path unchanged, and a mocked executor would only
 * prove the envelope passes through whatever the mock returned.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const addGameComponent = vi.fn();
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: { getState: () => ({ addGameComponent }) },
  // `executeToolCall` reads both; the store action is what dispatches here.
  getCommandDispatcher: () => null,
  getCommandBatchDispatcher: () => null,
}));

import { handleBridgeFrame } from '../bridgeFrame';

describe('MCP bridge reports adjusted game-component values', () => {
  const sent: Record<string, unknown>[] = [];
  const send = (frame: Record<string, unknown>) => {
    sent.push(frame);
  };

  beforeEach(() => {
    sent.length = 0;
    addGameComponent.mockReset();
  });

  it('carries the structured corrections in the command_result', async () => {
    await handleBridgeFrame(
      JSON.stringify({
        type: 'command',
        requestId: 'r1',
        name: 'add_game_component',
        payload: { entityId: 'ent-1', componentType: 'moving_platform', properties: { speed: 99999 } },
      }),
      send,
    );

    expect(addGameComponent).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([
      {
        type: 'command_result',
        requestId: 'r1',
        result: {
          success: true,
          result: {
            message: 'Added moving_platform. 1 value was adjusted to fit the engine’s limits: '
              + 'Moving Platform speed: you asked for 99999, it was capped at 1000.',
            corrections: [
              { component: 'movingPlatform', field: 'speed', requested: 99999, applied: 1000, reason: 'clamped' },
            ],
          },
        },
      },
    ]);
  });

  it('carries an empty list, and no adjustment sentence, when nothing was adjusted', async () => {
    await handleBridgeFrame(
      JSON.stringify({
        type: 'command',
        requestId: 'r2',
        name: 'add_game_component',
        payload: { entityId: 'ent-1', componentType: 'moving_platform', properties: { speed: 4 } },
      }),
      send,
    );
    expect(sent).toEqual([
      {
        type: 'command_result',
        requestId: 'r2',
        result: { success: true, result: { message: 'Added moving_platform', corrections: [] } },
      },
    ]);
  });
});
