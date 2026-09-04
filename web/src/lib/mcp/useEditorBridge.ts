/**
 * Editor side of the MCP bridge (#9293): attach this tab to the loopback relay
 * as `role=editor` and execute the commands the MCP server forwards.
 *
 * Opt-in, per tab, default-off, and now CONSENTED — four gates, in order:
 *   - the build must allow it at all (`bridgeOptIn.ts`);
 *   - the tab must be opened with `?mcp=<token>` (the relay's MCP_RELAY_TOKEN);
 *   - the person at the keyboard must approve the attach in the editor, once
 *     per tab. A URL is shareable and a token can be pasted by someone else,
 *     so a URL parameter alone is not consent to hand a remote process the
 *     controls; and without an on-screen indicator an attached tab was
 *     indistinguishable from an ordinary one;
 *   - only commands the allowlist accepts are executed (bridgeAllowlist.ts).
 *
 * Relay protocol: see mcp-server/src/relay/server.ts. Every inbound `command`
 * frame is answered with exactly one `command_result` carrying its requestId.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { mcpBridgeToken, mcpBridgeUrl, useMcpBridgeRequested } from './bridgeOptIn';

export type BridgeStatus =
  | 'off'
  | 'awaiting-consent'
  | 'connecting'
  | 'attached'
  | 'reconnecting'
  | 'refused'
  | 'detached';

export const MCP_BRIDGE_MAX_RECONNECTS = 5;
export const MCP_BRIDGE_RECONNECT_BASE_MS = 150;
export const MCP_BRIDGE_RECONNECT_MAX_MS = 800;
/**
 * Relay close codes a retry can never fix: a wrong token (4401) and a bad role
 * (4400). Everything else is retried a bounded number of times — notably 4409
 * ("an editor is already attached"), which React StrictMode produces on its own
 * by mounting the editor twice: the second mount races the first mount's socket
 * teardown and loses, and without a retry the tab stayed silently unattached.
 */
export const MCP_BRIDGE_FATAL_CLOSE_CODES: ReadonlySet<number> = new Set([4400, 4401]);

export interface EditorBridgeControls {
  status: BridgeStatus;
  /** Human-readable detail for the indicator; null when there is nothing to say. */
  detail: string | null;
  /** Approve the attach. No socket is opened before this is called. */
  approve: () => void;
  /** Detach and stay detached until the tab is reloaded. */
  detach: () => void;
}

export function useEditorBridge(): EditorBridgeControls {
  const requested = useMcpBridgeRequested();
  const [consented, setConsented] = useState(false);
  const [detached, setDetached] = useState(false);
  /**
   * Set synchronously by `detach`. `detached` is state, so the effect cleanup
   * that closes the socket does not run until React commits the re-render — a
   * frame arriving in that window would otherwise still reach the store after
   * the person at the keyboard had explicitly detached (#9293).
   */
  const detachedRef = useRef(false);
  const [socketStatus, setSocketStatus] = useState<BridgeStatus>('connecting');
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    if (!requested || !consented) return;
    const token = mcpBridgeToken(window.location.search);
    if (!token) return;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      // attempts === 0 is the synchronous first call from this effect; its
      // status is already the initial one, and setting it here would cost a
      // cascading render on every attach.
      if (attempts > 0) setSocketStatus('reconnecting');
      const ws = new WebSocket(mcpBridgeUrl(token));
      socket = ws;
      // Every callback below re-checks `socket === ws`: a socket that has been
      // replaced by a reconnect is no longer this tab's editor connection, and
      // must neither send frames nor tear down the live one's state (#9293).
      const send = (frame: Record<string, unknown>) => {
        if (socket === ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
      };
      ws.onopen = () => {
        attempts = 0;
        setSocketStatus('attached');
        setDetail(null);
        send({ type: 'project_info', data: { attached: true } });
      };
      ws.onmessage = (event) => {
        if (socket !== ws || detachedRef.current) return;
        const raw = String(event.data);
        // Dynamic: this is what keeps the command manifest and the chat
        // executor out of the editor chunk for every tab that never attaches.
        void import('./bridgeFrame')
          .then((m) => m.handleBridgeFrame(raw, send))
          .catch((err) => {
            // A chunk that fails to load must not swallow the frame. This
            // file's stated contract is that every `command` is answered
            // exactly once; an unanswered one leaves the agent waiting on its
            // own timeout with nothing said anywhere, and the relay holding a
            // `pending` entry until one of the two sockets closes. The
            // requestId is re-derived here rather than read through the module
            // that just failed to load.
            console.error('[mcp-bridge] could not load the frame handler', err);
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch {
              return; // malformed: there was no command to answer
            }
            if (
              typeof parsed === 'object' &&
              parsed !== null &&
              (parsed as { type?: unknown }).type === 'command' &&
              typeof (parsed as { requestId?: unknown }).requestId === 'string'
            ) {
              send({
                type: 'command_result',
                requestId: (parsed as { requestId: string }).requestId,
                error: 'The editor could not load its bridge handler',
              });
            }
          });
      };
      ws.onerror = () => {
        // A browser error event carries no detail; the close code that follows
        // does. Saying nothing at all is what made this silent before.
        console.error('[mcp-bridge] relay socket error; is `npm run relay` running in mcp-server?');
        setDetail('Could not reach the MCP relay. Is `npm run relay` running?');
      };
      ws.onclose = (event) => {
        if (socket !== ws) return;
        socket = null;
        if (disposed) return;
        if (MCP_BRIDGE_FATAL_CLOSE_CODES.has(event.code)) {
          console.error(
            `[mcp-bridge] the relay refused this tab (${event.code}: ${event.reason || 'no reason given'}); not retrying`,
          );
          setSocketStatus('refused');
          setDetail(
            event.code === 4401
              ? 'The relay rejected this token. Open the tab with the same ?mcp=<token> the relay was started with.'
              : `The relay refused this tab (close code ${event.code}).`,
          );
          return;
        }
        if (attempts >= MCP_BRIDGE_MAX_RECONNECTS) {
          console.error(
            `[mcp-bridge] gave up after ${MCP_BRIDGE_MAX_RECONNECTS} attempts (last close code ${event.code})`,
          );
          setSocketStatus('detached');
          setDetail(`Gave up reconnecting after ${MCP_BRIDGE_MAX_RECONNECTS} attempts.`);
          return;
        }
        const delay = Math.min(MCP_BRIDGE_RECONNECT_BASE_MS * 2 ** attempts, MCP_BRIDGE_RECONNECT_MAX_MS);
        attempts += 1;
        setSocketStatus('reconnecting');
        retryTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close(1000, 'editor unmounted');
    };
  }, [requested, consented]);

  const approve = useCallback(() => {
    setSocketStatus('connecting');
    setDetail(null);
    setConsented(true);
  }, []);
  const detach = useCallback(() => {
    detachedRef.current = true;
    setDetached(true);
    setConsented(false);
  }, []);

  const status: BridgeStatus = !requested
    ? 'off'
    : detached
      ? 'detached'
      : !consented
        ? 'awaiting-consent'
        : socketStatus;

  return {
    status,
    detail: detached ? 'Detached. Reload this tab to attach again.' : detail,
    approve,
    detach,
  };
}
