/**
 * The MCP bridge opt-in gate (#9293), kept in its own module for two reasons.
 *
 * 1. It is the ONLY part of the bridge the editor loads eagerly, so it must not
 *    reach the manifest (332 KB of JSON) or the chat executor's handler
 *    registry. Everything heavier hangs off a dynamic import behind this gate.
 * 2. Each flag is read as a fully-qualified `process.env.X` member expression.
 *    Next.js substitutes those literally at build time; a bare `process` in a
 *    client bundle resolves to the browser shim whose `env` is `{}`. The
 *    earlier version took an injectable `env` parameter defaulting to
 *    `process.env`, which read `{}` in the browser and made this gate always
 *    true in production — and its tests passed a synthetic object, so they
 *    pinned a contract the production call path never executed.
 */

import { useSyncExternalStore } from 'react';

export const MCP_BRIDGE_DEFAULT_URL = 'ws://127.0.0.1:3001/api/mcp/ws';

/**
 * Off in a production build unless `NEXT_PUBLIC_MCP_BRIDGE=true` was set when
 * that build was made. A token alone is never enough.
 */
export function mcpBridgeEnabled(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.NEXT_PUBLIC_MCP_BRIDGE === 'true';
}

/** The token from `?mcp=<token>`, or null when the tab did not opt in. */
export function mcpBridgeToken(search: string): string | null {
  const token = new URLSearchParams(search).get('mcp');
  return token && token.length > 0 ? token : null;
}

/** True when this tab is a candidate for the bridge at all. Cheap; no I/O. */
export function mcpBridgeRequested(): boolean {
  if (typeof window === 'undefined') return false;
  return mcpBridgeEnabled() && mcpBridgeToken(window.location.search) !== null;
}

/**
 * `?mcp=` cannot change without a navigation, so the snapshot is constant for
 * the life of the tab. Read during render via useSyncExternalStore rather than
 * assigned from a mount effect: a setState in an effect body costs a cascading
 * render on every editor load (react-hooks/set-state-in-effect), and the server
 * snapshot is `false` so SSR and the first client render agree.
 */
const subscribeToNothing = () => () => {};
const notRequestedOnServer = () => false;

export function useMcpBridgeRequested(): boolean {
  return useSyncExternalStore(subscribeToNothing, mcpBridgeRequested, notRequestedOnServer);
}

export function mcpBridgeUrl(token: string): string {
  const url = new URL(process.env.NEXT_PUBLIC_MCP_RELAY_URL ?? MCP_BRIDGE_DEFAULT_URL);
  url.searchParams.set('role', 'editor');
  url.searchParams.set('token', token);
  return url.toString();
}
