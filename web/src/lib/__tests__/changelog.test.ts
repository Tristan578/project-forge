/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseChangelog } from '../changelog';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
  };
});

import { existsSync, readFileSync } from 'node:fs';
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe('parseChangelog', () => {
  it('splits markdown into sections by ## headings', () => {
    const md = '## 1.0.0\n- Feature A\n\n## 0.9.0\n- Feature B\n';
    const sections = parseChangelog(md);

    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe('1.0.0');
    expect(sections[1].heading).toBe('0.9.0');
  });

  it('captures content lines under each section', () => {
    const md = '## 1.0.0\n### Added\n- Feature A\n- Feature B\n';
    const sections = parseChangelog(md);

    expect(sections[0].content).toContain('### Added');
    expect(sections[0].content).toContain('- Feature A');
    expect(sections[0].content).toContain('- Feature B');
  });

  it('skips lines before the first ## heading', () => {
    const md = '# Changelog\n\nSome intro text.\n\n## 1.0.0\n- Fix\n';
    const sections = parseChangelog(md);

    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('1.0.0');
  });

  it('returns empty array for markdown with no ## headings', () => {
    const md = '# Title\nJust text.';
    const sections = parseChangelog(md);

    expect(sections).toHaveLength(0);
  });

  it('handles empty content sections', () => {
    const md = '## [Unreleased]\n\n## 1.0.0\n- Fix\n';
    const sections = parseChangelog(md);

    expect(sections).toHaveLength(2);
    expect(sections[0].heading).toBe('[Unreleased]');
    expect(sections[0].content).toEqual(['']);
  });
});

describe('readChangelog', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExistsSync.mockReset().mockReturnValue(false);
    mockReadFileSync.mockReset().mockReturnValue('');
  });

  it('returns parsed sections when file exists', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('## 1.0.0\n### Added\n- Cool feature\n');

    const { readChangelog } = await import('../changelog');
    const sections = readChangelog();
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('1.0.0');
  });

  it('returns empty array when no changelog file found', async () => {
    mockExistsSync.mockReturnValue(false);

    const { readChangelog } = await import('../changelog');
    const sections = readChangelog();
    expect(sections).toHaveLength(0);
  });

  it('filters out sections with only whitespace content', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      '## [Unreleased]\n\n## 1.0.0\n- Real content\n'
    );

    const { readChangelog } = await import('../changelog');
    const sections = readChangelog();
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('1.0.0');
  });
});
