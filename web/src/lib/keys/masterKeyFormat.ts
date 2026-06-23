/**
 * Format constraint for the AES-256 BYOK master key, in a module with NO node
 * `crypto` dependency.
 *
 * This lives apart from `encryption.ts` (which imports node `crypto`) so that
 * edge-runtime code paths can validate the key format without dragging the
 * node-only crypto module into the edge bundle. `validateEnv.ts` is loaded by
 * `instrumentation.ts`'s `register()`, which Next.js invokes in BOTH the nodejs
 * and edge runtimes — importing `encryption.ts` there would break the edge build.
 */

/** A valid AES-256 master key: exactly 64 hexadecimal characters (32 bytes). */
export const MASTER_KEY_HEX = /^[0-9a-fA-F]{64}$/;
