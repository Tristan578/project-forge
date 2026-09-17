/** Verify actual production configuration against the complete historical test scope. */
import { glob } from 'tinyglobby';
import { describe, expect, it } from 'vitest';
import rootConfig from '../../vitest.config';
import nodeConfig from '../../vitest.config.node';
import jsdomConfig from '../../vitest.config.jsdom';
import { ROOT_TEST_INCLUDE } from '../../vitest.test-selection';

// Independent baseline: shrinking production partition constants cannot redefine completeness.
const HISTORICAL_ROOT_TEST_INCLUDE = [
  'src/**/*.test.ts', 'src/**/*.test.tsx',
  'e2e/lib/__tests__/**/*.test.ts', 'scripts/__tests__/**/*.test.ts',
];

/** Resolve the selectors that the actual Vitest projects execute. */
const selectedFiles = async (include: readonly string[], exclude: readonly string[] = []) =>
  new Set(await glob([...include, ...exclude.map(pattern => '!' + pattern)]));

describe('production Vitest project selection', () => {
  it('wires both actual environment projects into the root production gate', () => {
    expect(rootConfig.test?.projects).toEqual(['./vitest.config.node.ts', './vitest.config.jsdom.ts']);
    expect(ROOT_TEST_INCLUDE).toEqual(HISTORICAL_ROOT_TEST_INCLUDE);
    expect(nodeConfig.test?.environment).toBe('node');
    expect(jsdomConfig.test?.environment).toBe('jsdom');
  });

  it('assigns every historical root-selected test to exactly one actual project', async () => {
    const root = await selectedFiles(HISTORICAL_ROOT_TEST_INCLUDE);
    const node = await selectedFiles(nodeConfig.test?.include ?? [], nodeConfig.test?.exclude ?? []);
    const jsdom = await selectedFiles(jsdomConfig.test?.include ?? [], jsdomConfig.test?.exclude ?? []);
    const assignments = new Map<string, number>();
    expect(root.size).toBeGreaterThan(0);
    for (const file of node) assignments.set(file, (assignments.get(file) ?? 0) + 1);
    for (const file of jsdom) assignments.set(file, (assignments.get(file) ?? 0) + 1);
    expect([...assignments.keys()].sort()).toEqual([...root].sort());
    expect([...assignments.values()].every(count => count === 1)).toBe(true);
  });

  it('retains server and browser dependencies in their actual configured environments', async () => {
    const node = await selectedFiles(nodeConfig.test?.include ?? [], nodeConfig.test?.exclude ?? []);
    const jsdom = await selectedFiles(jsdomConfig.test?.include ?? [], jsdomConfig.test?.exclude ?? []);
    expect([...node].some(file => file.startsWith('src/app/api/'))).toBe(true);
    expect([...jsdom].some(file => file.startsWith('src/components/'))).toBe(true);
    expect([...jsdom].some(file => file.startsWith('src/hooks/'))).toBe(true);
    expect([...jsdom].some(file => file.startsWith('src/app/') && !file.startsWith('src/app/api/'))).toBe(true);
    expect([...jsdom].some(file => file.startsWith('src/app/api/'))).toBe(false);
    const serverApp = await selectedFiles(['src/app/__tests__/**/*.test.ts', 'src/app/__tests__/**/*.test.tsx']);
    expect(serverApp.size).toBeGreaterThan(0);
    for (const file of serverApp) {
      expect(node.has(file)).toBe(true);
      expect(jsdom.has(file)).toBe(false);
    }
    for (const file of ['src/lib/storage/__tests__/safeLocalStorage.test.ts', 'src/stores/slices/__tests__/sceneSlice.test.ts']) {
      expect(node.has(file)).toBe(false);
      expect(jsdom.has(file)).toBe(true);
    }
  });
});
