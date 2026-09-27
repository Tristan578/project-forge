/**
 * Not part of the build (`tsconfig.json`'s `include` is `src/**\/*`, which
 * does not reach this directory). Compiled standalone, on demand, by
 * `src/transport/__tests__/transportGap.test.ts` — see that file for why.
 *
 * This is the *un-cast* version of the two `sharedServer.connect(transport as
 * Transport)` / `mcpServer.connect(transport as Transport)` calls in
 * `src/transport/http.ts`. If the SDK's `Transport.onclose`/`onerror`/
 * `onmessage` optional-property declarations ever agree with
 * `StreamableHTTPServerTransport`'s own accessors under
 * `exactOptionalPropertyTypes`, this file compiles clean and the casts in
 * `http.ts` can be dropped (#10278).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

declare const server: McpServer;
declare const transport: StreamableHTTPServerTransport;

// No `as Transport` here — this is the assignment the compiler must accept
// on its own once the SDK's own types agree with themselves.
void server.connect(transport);

declare const takesTransport: (t: Transport) => void;
takesTransport(transport);
