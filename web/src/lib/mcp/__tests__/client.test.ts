import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSpawnforgeMcpClient,
  getMcpClientConfig,
  isMcpClientConfigured,
  withMcpClient,
} from '@/lib/mcp/client';

// Mock the SDK factory so no real network connection is attempted.
const createMCPClientMock = vi.fn();
vi.mock('@ai-sdk/mcp', () => ({
  createMCPClient: (...args: unknown[]) => createMCPClientMock(...args),
}));

describe('mcp/client config resolution', () => {
  const ORIGINAL = { url: process.env.MCP_HTTP_URL, token: process.env.MCP_HTTP_TOKEN };

  beforeEach(() => {
    delete process.env.MCP_HTTP_URL;
    delete process.env.MCP_HTTP_TOKEN;
    createMCPClientMock.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL.url === undefined) delete process.env.MCP_HTTP_URL;
    else process.env.MCP_HTTP_URL = ORIGINAL.url;
    if (ORIGINAL.token === undefined) delete process.env.MCP_HTTP_TOKEN;
    else process.env.MCP_HTTP_TOKEN = ORIGINAL.token;
  });

  it('returns null when neither var is set', () => {
    expect(getMcpClientConfig()).toBeNull();
    expect(isMcpClientConfigured()).toBe(false);
  });

  it('returns null when only the URL is set (no half-configured client)', () => {
    process.env.MCP_HTTP_URL = 'https://mcp.example.com/mcp';
    expect(getMcpClientConfig()).toBeNull();
    expect(isMcpClientConfigured()).toBe(false);
  });

  it('returns null when only the token is set', () => {
    process.env.MCP_HTTP_TOKEN = 'secret';
    expect(getMcpClientConfig()).toBeNull();
    expect(isMcpClientConfigured()).toBe(false);
  });

  it('treats whitespace-only values as unset', () => {
    process.env.MCP_HTTP_URL = '   ';
    process.env.MCP_HTTP_TOKEN = '\t';
    expect(getMcpClientConfig()).toBeNull();
  });

  it('resolves config (trimmed) when both vars are set', () => {
    process.env.MCP_HTTP_URL = '  https://mcp.example.com/mcp  ';
    process.env.MCP_HTTP_TOKEN = '  secret-token  ';
    expect(getMcpClientConfig()).toEqual({
      url: 'https://mcp.example.com/mcp',
      token: 'secret-token',
    });
    expect(isMcpClientConfigured()).toBe(true);
  });
});

describe('createSpawnforgeMcpClient', () => {
  beforeEach(() => createMCPClientMock.mockReset());

  it('returns null (no-op) and never calls the SDK when not configured', async () => {
    const client = await createSpawnforgeMcpClient(null);
    expect(client).toBeNull();
    expect(createMCPClientMock).not.toHaveBeenCalled();
  });

  it('creates an http transport with a Bearer auth header from the config', async () => {
    const fakeClient = { tools: vi.fn(), close: vi.fn() };
    createMCPClientMock.mockResolvedValue(fakeClient);

    const client = await createSpawnforgeMcpClient({
      url: 'https://mcp.example.com/mcp',
      token: 'tok-123',
    });

    expect(client).toBe(fakeClient);
    expect(createMCPClientMock).toHaveBeenCalledWith({
      transport: {
        type: 'http',
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: 'Bearer tok-123' },
      },
    });
  });
});

describe('withMcpClient', () => {
  beforeEach(() => createMCPClientMock.mockReset());

  it('returns null and does not run fn when unconfigured', async () => {
    const fn = vi.fn();
    const result = await withMcpClient(fn, null);
    expect(result).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('runs fn with the client and always closes it', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const fakeClient = { tools: vi.fn(), close };
    createMCPClientMock.mockResolvedValue(fakeClient);

    const result = await withMcpClient(async (c) => {
      expect(c).toBe(fakeClient);
      return 'done';
    }, { url: 'https://mcp.example.com/mcp', token: 'tok' });

    expect(result).toBe('done');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the client even when fn throws', async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    createMCPClientMock.mockResolvedValue({ tools: vi.fn(), close });

    await expect(
      withMcpClient(async () => {
        throw new Error('boom');
      }, { url: 'https://mcp.example.com/mcp', token: 'tok' }),
    ).rejects.toThrow('boom');

    expect(close).toHaveBeenCalledTimes(1);
  });
});
