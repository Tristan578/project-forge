/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('wasm/preloadHint', () => {
  beforeEach(() => {
    // Clean up any injected link elements
    document.head.querySelectorAll('link[rel="preload"]').forEach(el => el.remove());
    // Reset the module so `injected` flag resets
    vi.resetModules();
  });

  afterEach(() => {
    document.head.querySelectorAll('link[rel="preload"]').forEach(el => el.remove());
    localStorage.clear();
  });

  it('injects a preload link element into document.head', async () => {
    const { injectWasmPreloadHint } = await import('../preloadHint');
    injectWasmPreloadHint();

    const links = document.head.querySelectorAll('link[rel="preload"]');
    expect(links).toHaveLength(1);
    // jsdom may normalize 'as' differently; check the element property instead
    const link = links[0] as HTMLLinkElement;
    expect(link.rel).toBe('preload');
    expect(link.crossOrigin).toBe('anonymous');
  });

  it('only injects once per page load', async () => {
    const { injectWasmPreloadHint } = await import('../preloadHint');
    injectWasmPreloadHint();
    injectWasmPreloadHint();
    injectWasmPreloadHint();

    const links = document.head.querySelectorAll('link[rel="preload"]');
    expect(links).toHaveLength(1);
  });

  it('defaults to webgpu backend', async () => {
    const { injectWasmPreloadHint } = await import('../preloadHint');
    injectWasmPreloadHint();

    const link = document.head.querySelector('link[rel="preload"]');
    expect(link?.getAttribute('href')).toContain('webgpu');
  });

  it('uses webgl2 when preferred backend is set', async () => {
    localStorage.setItem('forge:preferred-backend', 'webgl2');
    const { injectWasmPreloadHint } = await import('../preloadHint');
    injectWasmPreloadHint();

    const link = document.head.querySelector('link[rel="preload"]');
    expect(link?.getAttribute('href')).toContain('webgl2');
  });

  it('href ends with forge_engine.js', async () => {
    const { injectWasmPreloadHint } = await import('../preloadHint');
    injectWasmPreloadHint();

    const link = document.head.querySelector('link[rel="preload"]');
    expect(link?.getAttribute('href')).toMatch(/forge_engine\.js$/);
  });
});
