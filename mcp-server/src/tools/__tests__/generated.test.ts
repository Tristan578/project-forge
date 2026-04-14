import { describe, it, expect, vi, beforeEach } from 'vitest';
import manifest from '../../../manifest/commands.json';

// Mock the MCP SDK
const mockRegisterTool = vi.fn();
const mockServer = {
  registerTool: mockRegisterTool,
} as unknown;

// Mock EditorBridge
const mockBridge = {
  executeCommand: vi.fn(),
} as unknown;

// Mock setImmediate for batching tests
vi.stubGlobal('setImmediate', (fn: () => void) => {
  Promise.resolve().then(fn);
});

describe('registerTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers all manifest commands as MCP tools', async () => {
    const { registerTools } = await import('../generated.js');
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { EditorBridge } = await import('../../transport/websocket.js');

    await registerTools(
      mockServer as InstanceType<typeof McpServer>,
      mockBridge as InstanceType<typeof EditorBridge>,
    );

    expect(mockRegisterTool).toHaveBeenCalledTimes(manifest.commands.length);
  });

  it('registers each command with correct name and description', async () => {
    const { registerTools } = await import('../generated.js');
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { EditorBridge } = await import('../../transport/websocket.js');

    await registerTools(
      mockServer as InstanceType<typeof McpServer>,
      mockBridge as InstanceType<typeof EditorBridge>,
    );

    const firstCmd = manifest.commands[0];
    const firstCall = mockRegisterTool.mock.calls[0];
    expect(firstCall[0]).toBe(firstCmd.name);
    expect(firstCall[1].description).toBe(firstCmd.description);
  });

  it('tool handler calls bridge.executeCommand', async () => {
    const { registerTools } = await import('../generated.js');
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { EditorBridge } = await import('../../transport/websocket.js');

    await registerTools(
      mockServer as InstanceType<typeof McpServer>,
      mockBridge as InstanceType<typeof EditorBridge>,
    );

    // Get the handler from the first registered tool
    const firstCall = mockRegisterTool.mock.calls[0];
    const handler = firstCall[2]; // callback is 3rd arg
    const firstCmd = manifest.commands[0];

    (mockBridge as { executeCommand: ReturnType<typeof vi.fn> }).executeCommand.mockResolvedValueOnce({ ok: true });

    const result = await handler({ foo: 'bar' });
    expect((mockBridge as { executeCommand: ReturnType<typeof vi.fn> }).executeCommand).toHaveBeenCalledWith(
      firstCmd.name,
      { foo: 'bar' },
    );
    expect(result.content[0].type).toBe('text');
  });

  it('tool handler returns error on bridge failure', async () => {
    const { registerTools } = await import('../generated.js');
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { EditorBridge } = await import('../../transport/websocket.js');

    await registerTools(
      mockServer as InstanceType<typeof McpServer>,
      mockBridge as InstanceType<typeof EditorBridge>,
    );

    const firstCall = mockRegisterTool.mock.calls[0];
    const handler = firstCall[2];

    (mockBridge as { executeCommand: ReturnType<typeof vi.fn> }).executeCommand.mockRejectedValueOnce(
      new Error('Connection lost'),
    );

    const result = await handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Connection lost');
  });

  it('registers tools with inputSchema config', async () => {
    const { registerTools } = await import('../generated.js');
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { EditorBridge } = await import('../../transport/websocket.js');

    await registerTools(
      mockServer as InstanceType<typeof McpServer>,
      mockBridge as InstanceType<typeof EditorBridge>,
    );

    const firstCall = mockRegisterTool.mock.calls[0];
    const config = firstCall[1];
    expect(config).toHaveProperty('inputSchema');
    expect(config).toHaveProperty('description');
  });
});
