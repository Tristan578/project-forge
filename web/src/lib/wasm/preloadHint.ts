/**
 * WASM engine preload hint.
 *
 * Injects a `<link rel="preload" as="script">` element for the WASM JS glue
 * file (`forge_engine.js`) so the browser begins fetching it during the
 * editor page load, before `useEngine` calls `import()`.
 *
 * WebGPU is probed first, so we speculatively preload the WebGPU variant
 * (the common path). The WebGL2 fallback is only triggered if WebGPU is
 * unavailable, at which point the browser will have already fetched the
 * WebGPU script — a small wasted request in the fallback case, but the
 * common case benefits significantly.
 *
 * Safe to call multiple times — only injects once per page load.
 */

const ENGINE_CDN_BASE = (
  process.env.NEXT_PUBLIC_ENGINE_CDN_URL ?? ''
).replace(/\/+$/, '');

const ENGINE_VERSION = (
  process.env.NEXT_PUBLIC_ENGINE_VERSION ?? ''
).trim();

const ENGINE_CDN_ROOT = ENGINE_CDN_BASE
  ? ENGINE_VERSION
    ? `${ENGINE_CDN_BASE}/${ENGINE_VERSION}`
    : `${ENGINE_CDN_BASE}/latest`
  : '';

let injected = false;

export function injectWasmPreloadHint(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;

  // Determine the preferred backend to preload.
  // Default to WebGPU (most common); respect stored user preference.
  const preferredBackend =
    typeof localStorage !== 'undefined'
      ? (localStorage.getItem('forge:preferred-backend') ?? 'webgpu')
      : 'webgpu';

  const backend = preferredBackend === 'webgl2' ? 'webgl2' : 'webgpu';
  const basePath = `${ENGINE_CDN_ROOT}/engine-pkg-${backend}/`;
  const jsUrl = `${basePath}forge_engine.js`;

  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'script';
  link.href = jsUrl;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
}
