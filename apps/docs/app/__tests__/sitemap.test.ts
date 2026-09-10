/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectMdxPaths, toUrlPath } from '../sitemap';

describe('collectMdxPaths', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'docs-sitemap-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds .mdx files in nested directories', () => {
    writeFileSync(join(tmpDir, 'getting-started.mdx'), '# Getting Started');
    mkdirSync(join(tmpDir, 'mcp'));
    writeFileSync(join(tmpDir, 'mcp', 'overview.mdx'), '# MCP Overview');

    const entries = collectMdxPaths(tmpDir, tmpDir);
    const paths = entries.map((e) => e.path);

    expect(paths).toContain('/getting-started');
    expect(paths).toContain('/mcp/overview');
  });

  it('strips /index suffix from index.mdx files', () => {
    mkdirSync(join(tmpDir, 'guides'));
    writeFileSync(join(tmpDir, 'guides', 'index.mdx'), '# Guides');

    const entries = collectMdxPaths(tmpDir, tmpDir);
    const paths = entries.map((e) => e.path);

    expect(paths).toContain('/guides');
    expect(paths).not.toContain('/guides/index');
  });

  it('maps root index.mdx to empty string', () => {
    writeFileSync(join(tmpDir, 'index.mdx'), '# Home');

    const entries = collectMdxPaths(tmpDir, tmpDir);
    const paths = entries.map((e) => e.path);

    expect(paths).toContain('');
  });

  it('ignores non-.mdx files', () => {
    writeFileSync(join(tmpDir, 'notes.txt'), 'not mdx');
    writeFileSync(join(tmpDir, 'page.mdx'), '# Page');

    const entries = collectMdxPaths(tmpDir, tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe('/page');
  });

  it('returns mtime from file stat', () => {
    writeFileSync(join(tmpDir, 'doc.mdx'), '# Doc');

    const entries = collectMdxPaths(tmpDir, tmpDir);
    expect(entries[0].mtime).toBeInstanceOf(Date);
    expect(entries[0].mtime.getTime()).toBeGreaterThan(0);
  });

  it('returns empty array for non-existent directory', () => {
    const entries = collectMdxPaths(join(tmpDir, 'nonexistent'), tmpDir);
    expect(entries).toHaveLength(0);
  });
});

describe('toUrlPath', () => {
  // These run the Windows separator explicitly rather than relying on the host,
  // because on a POSIX runner `sep` is already '/' and the normalisation is a
  // no-op there — deleting it would still leave every other case in this file
  // green. Pinning the backslash shape from any host is what makes the fix
  // regression-proof: a Windows contributor's sitemap advertised `/mcp\overview`
  // and, because `startsWith('/mcp/')` then matched nothing, silently demoted
  // every MCP page to the 0.6 priority bucket.
  it('renders a Windows-separated path as a URL path', () => {
    expect(toUrlPath('mcp\\overview.mdx', '\\')).toBe('/mcp/overview');
  });

  it('strips /index through a Windows separator', () => {
    expect(toUrlPath('guides\\index.mdx', '\\')).toBe('/guides');
  });

  it('maps a Windows-separated root index to the empty string', () => {
    expect(toUrlPath('index.mdx', '\\')).toBe('');
  });

  it('leaves an already-POSIX path unchanged', () => {
    expect(toUrlPath('mcp/overview.mdx', '/')).toBe('/mcp/overview');
    expect(toUrlPath('guides/index.mdx', '/')).toBe('/guides');
    expect(toUrlPath('index.mdx', '/')).toBe('');
  });
});

describe('sitemap', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('assigns higher priority to /mcp/ paths', async () => {
    // Mock fs to return controlled entries
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return {
        ...actual,
        readdirSync: vi.fn((dir: string) => {
          if (String(dir).endsWith('content')) return ['api.mdx', 'mcp'];
          if (String(dir).endsWith('mcp')) return ['commands.mdx'];
          return [];
        }),
        statSync: vi.fn((path: string) => ({
          isDirectory: () => String(path).endsWith('mcp'),
          mtime: new Date('2026-04-01'),
        })),
      };
    });

    const { default: sitemap } = await import('../sitemap');
    const result = sitemap();

    const apiEntry = result.find((e) => e.url.includes('/api'));
    const mcpEntry = result.find((e) => e.url.includes('/mcp/'));

    expect(apiEntry?.priority).toBe(0.6);
    expect(mcpEntry?.priority).toBe(0.7);
  });

  it('advertises /capability-matrix, which the MDX walk cannot discover', async () => {
    // The page renders from data/capability-matrix.json, not content/, so it
    // is a hand-listed entry. Same fs mock as above with NO mdx files: the
    // entry must be present regardless of what content/ holds.
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      return { ...actual, readdirSync: vi.fn(() => []), statSync: vi.fn() };
    });

    const { default: sitemap } = await import('../sitemap');
    const { DOCS_URL } = await import('../../lib/site');
    const result = sitemap();

    const matrixEntry = result.find((e) => e.url === `${DOCS_URL}/capability-matrix`);
    expect(matrixEntry).toBeDefined();
    expect(matrixEntry?.priority).toBe(0.8);
    expect(matrixEntry?.changeFrequency).toBe('weekly');
  });
});
