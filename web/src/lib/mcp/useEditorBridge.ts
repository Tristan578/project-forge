/**
 * Editor side of the MCP bridge (#9293): attach this tab to the loopback relay
 * as `role=editor` and execute the commands the MCP server forwards.
 *
 * Opt-in, per tab, and default-off — that is the security property:
 *   - the tab must be opened with `?mcp=<token>` (the relay's MCP_RELAY_TOKEN);
 *   - outside production this is enough; a production build additionally needs
 *     `NEXT_PUBLIC_MCP_BRIDGE=true` at build time, same shape as the E2E hooks;
 *   - only commands the allowlist accepts are executed (bridgeAllowlist.ts).
 *
 * Relay protocol: see mcp-server/src/relay/server.ts. Every inbound `command`
 * frame is answered with exactly one `command_result` carrying its requestId.
 */
import { useEffect } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { executeToolCall } from '@/lib/chat/executor';
import { bridgeVerdict } from './bridgeAllowlist';

export const MCP_BRIDGE_DEFAULT_URL = 'ws://127.0.0.1:3001/api/mcp/ws';

export function mcpBridgeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.NEXT_PUBLIC_MCP_BRIDGE === 'true';
}

/** The token from `?mcp=<token>`, or null when the tab did not opt in. */
export function mcpBridgeToken(search: string): string | null {
  const token = new URLSearchParams(search).get('mcp');
  return token && token.length > 0 ? token : null;
}

export function mcpBridgeUrl(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const url = new URL(env.NEXT_PUBLIC_MCP_RELAY_URL ?? MCP_BRIDGE_DEFAULT_URL);
  url.searchParams.set('role', 'editor');
  url.searchParams.set('token', token);
  return url.toString();
}

interface CommandFrame {
  type: 'command';
  requestId: string;
  name: string;
  payload?: Record<string, unknown>;
}

function isCommandFrame(value: unknown): value is CommandFrame {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as CommandFrame).type === 'command' &&
    typeof (value as CommandFrame).requestId === 'string' &&
    typeof (value as CommandFrame).name === 'string'
  );
}

/**
 * Handle one inbound frame. Exported so the unit test drives it without a
 * socket; the hook wires it to a real WebSocket.
 */
export async function handleBridgeFrame(
  raw: string,
  send: (frame: Record<string, unknown>) => void,
): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return; // malformed: ignore, never throw out of the socket handler
  }
  if (!isCommandFrame(parsed)) return;
  const { requestId, name } = parsed;
  const verdict = bridgeVerdict(name);
  if (!verdict.allowed) {
    send({ type: 'command_result', requestId, error: verdict.reason });
    return;
  }
  const result = await executeToolCall(name, parsed.payload ?? {}, useEditorStore.getState());
  if (result.success) {
    send({ type: 'command_result', requestId, result });
  } else {
    send({ type: 'command_result', requestId, error: result.error ?? `'${name}' failed` });
  }
}

export function useEditorBridge(): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !mcpBridgeEnabled()) return;
    const token = mcpBridgeToken(window.location.search);
    if (!token) return;
    let stopped = false;
    let retryDelayMs = 500;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let activeSocket: WebSocket | null = null;

    const connect = () => {
      if (stopped) return;
      const ws = new WebSocket(mcpBridgeUrl(token));
      activeSocket = ws;
      const send = (frame: Record<string, unknown>) => {
        if (activeSocket === ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(frame));
        }
      };
      ws.onopen = () => {
        retryDelayMs = 500;
        send({ type: 'project_info', data: { attached: true } });
      };
      ws.onmessage = (event) => {
        if (activeSocket === ws) void handleBridgeFrame(String(event.data), send);
      };
      ws.onclose = () => {
        if (stopped || activeSocket !== ws) return;
        activeSocket = null;
        retryTimer = setTimeout(connect, retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, 10_000);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      activeSocket?.close();
      activeSocket = null;
    };
  }, []);
}
