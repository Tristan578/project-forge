/** Validate the exact four browser WASM packages before cache saves or uploads. */
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VARIANTS = ['pkg-webgl2', 'pkg-webgpu', 'pkg-webgl2-runtime', 'pkg-webgpu-runtime'];

/**
 * Require each browser dependency and validate complete WASM module bytes.
 * @param {string} engineRoot Directory containing the four generated packages.
 * @returns {string[]} Verified package names, suitable for the job log.
 * @throws {Error} Names the package and dependency that is absent or invalid.
 */
export function verifyEngineWasm(engineRoot) {
  for (const variant of VARIANTS) {
    const directory = resolve(engineRoot, variant);
    for (const name of ['forge_engine_bg.wasm', 'forge_engine.js']) {
      const file = resolve(directory, name);
      let bytes;
      try {
        if (!statSync(file).isFile()) throw new Error('not a regular file');
        bytes = readFileSync(file);
      } catch {
        throw new Error(variant + ': missing or unreadable ' + name);
      }
      if (bytes.length === 0) throw new Error(variant + ': empty ' + name);
      if (name.endsWith('.wasm') && !WebAssembly.validate(bytes)) {
        throw new Error(variant + ': invalid or truncated ' + name);
      }
      if (name.endsWith('.js')) {
        // Parse generated ESM through stdin; never execute its imports or code.
        const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: bytes });
        if (checked.error || checked.status !== 0) throw new Error(variant + ': invalid or truncated ' + name);
      }
    }
  }
  return [...VARIANTS];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    for (const variant of verifyEngineWasm(process.argv[2] ?? 'engine')) console.log('ok: ' + variant);
    console.log('All 4 WASM variants verified (exact browser module + glue).');
  } catch (error) {
    console.error('::error::' + (error instanceof Error ? error.message : 'WASM package validation failed'));
    process.exitCode = 1;
  }
}
