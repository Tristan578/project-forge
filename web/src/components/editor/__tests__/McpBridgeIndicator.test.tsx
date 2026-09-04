// @vitest-environment jsdom
/**
 * The visible half of the MCP bridge (#9293, review UX finding 1): an attached
 * tab must not look like an ordinary one, and the person at the keyboard must
 * be able to see what the agent did and stop it in one click.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { McpBridgeIndicator } from '../McpBridgeIndicator';
import { announceBridgeActivity, resetBridgeActivity } from '@/lib/mcp/bridgeActivity';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  closedWith: { code?: number } | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;
  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith = { code };
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}

async function attach() {
  render(<McpBridgeIndicator />);
  await userEvent.click(screen.getByRole('button', { name: 'Allow this tab' }));
  act(() => FakeWebSocket.instances[0].open());
}

describe('McpBridgeIndicator', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    resetBridgeActivity();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubEnv('NODE_ENV', 'development');
    window.history.replaceState({}, '', '/editor?mcp=abc123');
  });
  afterEach(() => {
    // globals are off in this workspace, so RTL's automatic cleanup never
    // registers: without this every render leaks into the next test.
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('renders nothing at all in a tab that did not ask for the bridge', () => {
    window.history.replaceState({}, '', '/editor');
    const { container } = render(<McpBridgeIndicator />);
    expect(container).toBeEmptyDOMElement();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('asks before attaching, and names what the agent can and cannot do', async () => {
    render(<McpBridgeIndicator />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/create, modify and delete objects/i);
    expect(dialog).toHaveTextContent(/cannot spend generation tokens, publish or export/i);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it('shows a persistent attached indicator once approved', async () => {
    await attach();
    expect(screen.getByRole('status')).toHaveTextContent('MCP bridge attached');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // An indicator that says "attached" but not "just deleted your player" is
  // the finding only half-answered.
  it('names each command the agent ran, and each one that was refused', async () => {
    await attach();
    act(() => announceBridgeActivity('spawn_entity', 'ran'));
    expect(screen.getByTestId('mcp-bridge-activity')).toHaveTextContent('ran spawn_entity');
    act(() => announceBridgeActivity('create_script', 'refused'));
    expect(screen.getByTestId('mcp-bridge-activity')).toHaveTextContent('refused create_script');
  });

  it('detaches in one click, and closes the socket', async () => {
    await attach();
    await userEvent.click(screen.getByRole('button', { name: 'Detach' }));
    expect(screen.getByRole('status')).toHaveTextContent('MCP bridge detached');
    expect(FakeWebSocket.instances[0].closedWith?.code).toBe(1000);
  });

  it('cancelling the request never opens a socket', async () => {
    render(<McpBridgeIndicator />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('MCP bridge detached');
  });
});
