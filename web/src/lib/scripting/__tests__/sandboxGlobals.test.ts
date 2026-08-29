import { describe, it, expect } from 'vitest';
import { SHADOWED_GLOBALS } from '../sandboxGlobals';

describe('scripting/sandboxGlobals', () => {
  it('is a non-empty array', () => {
    expect(SHADOWED_GLOBALS.length).toBeGreaterThan(0);
  });

  it('shadows network exfiltration APIs', () => {
    const names = [...SHADOWED_GLOBALS];
    expect(names).toContain('fetch');
    expect(names).toContain('XMLHttpRequest');
    expect(names).toContain('WebSocket');
    expect(names).toContain('importScripts');
    expect(names).toContain('EventSource');
    expect(names).toContain('BroadcastChannel');
  });

  it('shadows persistent storage APIs', () => {
    const names = [...SHADOWED_GLOBALS];
    expect(names).toContain('indexedDB');
    expect(names).toContain('caches');
  });

  it('shadows fingerprinting/URL leak APIs', () => {
    const names = [...SHADOWED_GLOBALS];
    expect(names).toContain('navigator');
    expect(names).toContain('location');
  });

  it('shadows nested worker constructors', () => {
    // Worker and SharedWorker were the only two shipped names with no
    // membership pin: dropping either was caught solely by the count pins in
    // scriptSandbox.test.ts / scriptSecurity.test.ts, and swapping one for a
    // new name kept the count and so was caught by nothing. An escaped script
    // that can name Worker spawns a fresh, network-capable global.
    const names = [...SHADOWED_GLOBALS];
    expect(names).toContain('Worker');
    expect(names).toContain('SharedWorker');
  });

  it('shadows global scope access', () => {
    const names = [...SHADOWED_GLOBALS];
    expect(names).toContain('self');
    expect(names).toContain('globalThis');
    expect(names).toContain('window');
  });

  it('shadows prototype-chain escape APIs', () => {
    const names = [...SHADOWED_GLOBALS];
    expect(names).toContain('Function');
    expect(names).toContain('eval');
  });

  it('shadows meta-programming APIs', () => {
    const names = [...SHADOWED_GLOBALS];
    expect(names).toContain('Reflect');
    expect(names).toContain('Proxy');
  });

  it('shadows timing side-channel APIs', () => {
    const names = [...SHADOWED_GLOBALS];
    expect(names).toContain('SharedArrayBuffer');
    expect(names).toContain('Atomics');
  });

  it('has no duplicate entries', () => {
    const set = new Set(SHADOWED_GLOBALS);
    expect(set.size).toBe(SHADOWED_GLOBALS.length);
  });
});
