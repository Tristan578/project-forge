import { glob } from 'tinyglobby';
import { describe, expect, it } from 'vitest';
import {
  JSDOM_TEST_EXCLUDE,
  JSDOM_TEST_INCLUDE,
  NODE_TEST_EXCLUDE,
  NODE_TEST_INCLUDE,
  ROOT_TEST_INCLUDE,
} from '../../vitest.test-selection';

const selectedFiles = async (include: readonly string[], exclude: readonly string[] = []) =>
  new Set(await glob([...include, ...exclude.map(pattern => `!${pattern}`)]));

describe('production Vitest project selection', () => {
  it('assigns every root-selected test to exactly one execution environment', async () => {
    const root = await selectedFiles(ROOT_TEST_INCLUDE);
    const node = await selectedFiles(NODE_TEST_INCLUDE, NODE_TEST_EXCLUDE);
    const jsdom = await selectedFiles(JSDOM_TEST_INCLUDE, JSDOM_TEST_EXCLUDE);
    const assignments = new Map<string, number>();

    for (const file of node) assignments.set(file, (assignments.get(file) ?? 0) + 1);
    for (const file of jsdom) assignments.set(file, (assignments.get(file) ?? 0) + 1);

    expect([...assignments.keys()].sort()).toEqual([...root].sort());
    expect([...assignments.values()].every(count => count === 1)).toBe(true);
  });

  it('keeps API tests in Node and browser-facing suites in jsdom', async () => {
    const node = await selectedFiles(NODE_TEST_INCLUDE, NODE_TEST_EXCLUDE);
    const jsdom = await selectedFiles(JSDOM_TEST_INCLUDE, JSDOM_TEST_EXCLUDE);

    expect([...node].some(file => file.startsWith('src/app/api/'))).toBe(true);
    expect([...jsdom].some(file => file.startsWith('src/components/'))).toBe(true);
    expect([...jsdom].some(file => file.startsWith('src/hooks/'))).toBe(true);
    expect([...jsdom].some(file => file.startsWith('src/app/') && !file.startsWith('src/app/api/'))).toBe(true);
    expect([...jsdom].some(file => file.startsWith('src/app/api/'))).toBe(false);
    expect(jsdom.has('src/lib/storage/__tests__/safeLocalStorage.test.ts')).toBe(true);
    expect(jsdom.has('src/stores/slices/__tests__/sceneSlice.test.ts')).toBe(true);
    expect(node.has('src/lib/storage/__tests__/safeLocalStorage.test.ts')).toBe(false);
    expect(node.has('src/stores/slices/__tests__/sceneSlice.test.ts')).toBe(false);
  });
});
