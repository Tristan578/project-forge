/**
 * Mock engine — maps command type → response from fixture files.
 *
 * Used to simulate how the Rust/WASM engine would respond to commands when the
 * real WASM binary is not available (unit + integration tests, CI).
 *
 * Fixture files live at src/__integration__/fixtures/<command_name>.json.
 * If no fixture exists for a command, a default success response is returned.
 */

import spawnEntityFixture from './fixtures/spawn_entity.json';
import updateTransformFixture from './fixtures/update_transform.json';
import setMaterialFixture from './fixtures/set_material.json';
import deleteEntityFixture from './fixtures/delete_entity.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EngineResponse {
  success: boolean;
  result?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Fixture registry
// ---------------------------------------------------------------------------

/**
 * Map from command name to the canned fixture response.
 * Expand this as more command integration tests are added.
 */
const fixtures: Record<string, EngineResponse> = {
  spawn_entity: spawnEntityFixture as EngineResponse,
  update_transform: updateTransformFixture as EngineResponse,
  set_material: setMaterialFixture as EngineResponse,
  delete_entities: deleteEntityFixture as EngineResponse,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The default response returned when no fixture is registered for a command.
 * This matches the engine's typical success shape for commands that have no
 * meaningful return value.
 */
export const DEFAULT_SUCCESS_RESPONSE: EngineResponse = {
  success: true,
  result: null,
};

/**
 * Returns the canned fixture response for `commandName`, or the default
 * success response if no fixture is registered.
 */
export function getFixtureResponse(commandName: string): EngineResponse {
  return fixtures[commandName] ?? DEFAULT_SUCCESS_RESPONSE;
}

/**
 * Creates a vi.fn() that behaves like the WASM `handle_command` function:
 * it accepts (commandName, payload) and synchronously returns the fixture
 * response for that command.
 *
 * Use this as the mock dispatch in integration tests that need to inspect the
 * response, not just the call.
 */
export function createMockEngine(): {
  handleCommand: (commandName: string, payload: unknown) => EngineResponse;
  calls: Array<{ command: string; payload: unknown; response: EngineResponse }>;
} {
  const calls: Array<{ command: string; payload: unknown; response: EngineResponse }> = [];

  const handleCommand = (commandName: string, payload: unknown): EngineResponse => {
    const response = getFixtureResponse(commandName);
    calls.push({ command: commandName, payload, response });
    return response;
  };

  return { handleCommand, calls };
}
