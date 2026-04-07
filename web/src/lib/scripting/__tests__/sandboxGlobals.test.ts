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
