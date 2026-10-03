/**
 * The query parameter that carries the MCP relay token: `?mcp=<token>` on the
 * editor tab (#9293).
 *
 * One name, read in two places that must agree: `mcpBridgeToken` in
 * `bridgeOptIn.ts` reads the token from it, and `authRoutes.ts` strips it from
 * every sign-in return path (including the `returnBackUrl` that `proxy.ts`
 * hands Clerk). If the two spelled it separately, renaming the reader would
 * leave the stripper removing a parameter nobody sends, and the credential
 * would ride into the sign-in redirect with every test green.
 *
 * Kept in its own module with no imports so the proxy (edge runtime) and the
 * navigation helpers can depend on it without pulling in React or the bridge.
 */
export const MCP_TOKEN_PARAM = 'mcp';
