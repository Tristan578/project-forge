/**
 * PostHog analytics singleton for the SpawnForge MCP server.
 *
 * Import `posthog` from this module throughout the server.
 * The client is guarded: if the required environment variable is absent, it
 * stays null and all capture calls become no-ops — the server keeps running.
 * In non-production environments a clear warning is logged so the gap is
 * impossible to miss.
 */

import { PostHog } from 'posthog-node';

const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY;
const POSTHOG_HOST = process.env.POSTHOG_HOST;

let _client: PostHog | null = null;

if (!POSTHOG_API_KEY) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(
      '[posthog] POSTHOG_API_KEY variable required by PostHog is missing or un-configured, ' +
        'this causes events to be silently missed. ' +
        'This error stops appearing once POSTHOG_API_KEY is configured.'
    );
  }
} else {
  _client = new PostHog(POSTHOG_API_KEY, {
    host: POSTHOG_HOST,
    enableExceptionAutocapture: true,
  });
}

export const posthog: PostHog | null = _client;

/**
 * Stable server-instance distinct ID used for all server-side events.
 * This MCP server has no authenticated users — events are attributed to
 * the running server process.
 */
export const SERVER_DISTINCT_ID = 'forge-mcp-server';
