/** Package all four verified engine variants into the application's CDN fallback. */
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyEngineWasm } from './verify-engine-wasm.mjs';

/**
 * Validate the complete artifact before replacing any existing fallback files.
 * @param {string} engineRoot Directory containing the four exact pkg-* artifacts.
 * @param {string} publicRoot Destination directory for public browser assets.
 * @returns {string[]} The four destination engine-pkg-* directory names.
 * @throws {Error} Validation or filesystem failures; validation precedes replacement,
 * but copy failures can leave some destinations replaced and are not atomic.
 */
export function populateEngineFallback(engineRoot, publicRoot) {
  const variants = verifyEngineWasm(engineRoot);
  mkdirSync(publicRoot, { recursive: true });
  for (const variant of variants) {
    const destination = resolve(publicRoot, 'engine-' + variant);
    rmSync(destination, { recursive: true, force: true });
    cpSync(resolve(engineRoot, variant), destination, { recursive: true });
  }
  return variants.map((variant) => 'engine-' + variant);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const variants = populateEngineFallback(process.argv[2] ?? 'engine', process.argv[3] ?? 'web/public');
    console.log('Packaged same-origin fallback: ' + variants.join(', '));
  } catch (error) {
    console.error('::error::' + (error instanceof Error ? error.message : 'Engine fallback packaging failed'));
    process.exitCode = 1;
  }
}
