/**
 * The size of the MCP command surface, as quoted in public marketing copy.
 *
 * These are declared rather than imported from `@/data/commands.json` on
 * purpose: the consumers are marketing pages and metadata, and pulling the
 * whole 351-entry manifest into each of those route bundles to count its
 * length is a poor trade. `__tests__/manifestStats.test.ts` asserts both
 * numbers against the manifest, so a command added without updating them
 * fails a test rather than silently ageing the copy — which is exactly how
 * every public page came to advertise 350.
 */

/** Total commands in `mcp-server/manifest/commands.json`. */
export const MCP_COMMAND_COUNT = 351;

/** Distinct categories those commands are grouped into. */
export const MCP_CATEGORY_COUNT = 41;
