/**
 * Tests for CollapsibleSection localStorage persistence logic.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';

const STORAGE_KEY = 'forge-inspector-collapsed';

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr: unknown = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr.filter((s): s is string => typeof s === 'string'));
  } catch {
    // Ignore
  }
  return new Set();
}

function writeCollapsed(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

describe('CollapsibleSection persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should return empty set when nothing stored', () => {
    const result = readCollapsed();
    expect(result.size).toBe(0);
  });

  it('should persist collapsed section IDs', () => {
    const collapsed = new Set(['transform', 'material']);
    writeCollapsed(collapsed);

    const loaded = readCollapsed();
    expect(loaded.has('transform')).toBe(true);
    expect(loaded.has('material')).toBe(true);
    expect(loaded.has('physics')).toBe(false);
  });

  it('should add a section to collapsed set', () => {
    const collapsed = readCollapsed();
    collapsed.add('audio');
    writeCollapsed(collapsed);

    const loaded = readCollapsed();
    expect(loaded.has('audio')).toBe(true);
  });

  it('should remove a section from collapsed set', () => {
    writeCollapsed(new Set(['physics', 'audio']));

    const collapsed = readCollapsed();
    collapsed.delete('physics');
    writeCollapsed(collapsed);

    const loaded = readCollapsed();
    expect(loaded.has('physics')).toBe(false);
    expect(loaded.has('audio')).toBe(true);
  });

  it('should handle corrupted localStorage gracefully', () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json{');
    const result = readCollapsed();
    expect(result.size).toBe(0);
  });

  it('should filter out non-string values', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['transform', 123, null, 'material']));
    const result = readCollapsed();
    expect(result.size).toBe(2);
    expect(result.has('transform')).toBe(true);
    expect(result.has('material')).toBe(true);
  });

  it('should roundtrip multiple sections', () => {
    const sections = ['transform', 'material', 'physics', 'audio', 'particles'];
    writeCollapsed(new Set(sections));

    const loaded = readCollapsed();
    expect(loaded.size).toBe(5);
    for (const s of sections) {
      expect(loaded.has(s)).toBe(true);
    }
  });

  it('should toggle correctly simulating expand/collapse', () => {
    // Start: all expanded (none collapsed)
    expect(readCollapsed().has('transform')).toBe(false);

    // Collapse transform
    const c1 = readCollapsed();
    c1.add('transform');
    writeCollapsed(c1);
    expect(readCollapsed().has('transform')).toBe(true);

    // Expand transform
    const c2 = readCollapsed();
    c2.delete('transform');
    writeCollapsed(c2);
    expect(readCollapsed().has('transform')).toBe(false);
  });
});
