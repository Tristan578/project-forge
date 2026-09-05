#!/usr/bin/env node
/**
 * Compatibility entrypoint for the MCP command coverage audit.
 *
 * Usage: node scripts/audit-command-coverage.ts
 *
 * Run the same maintained manifest/handler check as CI. Keeping a separate
 * parser here previously let this entrypoint drift from the manifest schema.
 * This checks handler registration, not runtime execution or human/AI parity.
 */
import '../web/scripts/check-command-parity.js';
