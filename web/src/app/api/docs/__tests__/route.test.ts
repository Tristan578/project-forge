import { NextRequest } from 'next/server';
/**
 * Tests for /api/docs route — extractTitle, extractSections, GET handler.
 *
 * @vitest-environment node
 */

vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs/promises before importing the route
vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
}));

import { GET } from '../route';
import { readdir, readFile } from 'fs/promises';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDirent(name: string, isDir: boolean): any {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    parentPath: '',
    path: '',
  };
}

describe('/api/docs GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns docs array and meta on success', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      makeDirent('guide.md', false),
    ] as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    vi.mocked(readFile)
      .mockResolvedValueOnce('# Getting Started\n## Setup\nInstall deps.')
      .mockRejectedValueOnce(new Error('no _meta.json'));

    const response = await GET(new NextRequest('http://localhost/test'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.docs).toHaveLength(1);
    expect(body.docs[0].title).toBe('Getting Started');
    expect(body.docs[0].path).toBe('guide');
    expect(body.docs[0].category).toBe('root');
    expect(body.docs[0].sections).toHaveLength(1);
    expect(body.docs[0].sections[0].heading).toBe('Setup');
  });

  it('returns empty docs when directory is empty', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([] as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(readFile).mockRejectedValueOnce(new Error('no _meta.json'));

    const response = await GET(new NextRequest('http://localhost/test'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.docs).toHaveLength(0);
  });

  it('recurses into subdirectories', async () => {
    // Root readdir returns a directory
    vi.mocked(readdir)
      .mockResolvedValueOnce([makeDirent('features', true)] as any) // eslint-disable-line @typescript-eslint/no-explicit-any
      .mockResolvedValueOnce([makeDirent('physics.md', false)] as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    vi.mocked(readFile)
      .mockResolvedValueOnce('# Physics Engine\n## Collisions\nHit detection.')
      .mockRejectedValueOnce(new Error('no _meta.json'));

    const response = await GET(new NextRequest('http://localhost/test'));
    const body = await response.json();

    expect(body.docs).toHaveLength(1);
    expect(body.docs[0].path).toBe('features/physics');
    expect(body.docs[0].category).toBe('features');
  });

  it('skips hidden and underscore directories', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      makeDirent('.hidden', true),
      makeDirent('_private', true),
      makeDirent('readme.md', false),
    ] as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    vi.mocked(readFile)
      .mockResolvedValueOnce('# README\nContent here.')
      .mockRejectedValueOnce(new Error('no _meta.json'));

    const response = await GET(new NextRequest('http://localhost/test'));
    const body = await response.json();

    expect(body.docs).toHaveLength(1);
    expect(body.docs[0].title).toBe('README');
  });

  it('extracts title as Untitled when no heading', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      makeDirent('noheading.md', false),
    ] as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    vi.mocked(readFile)
      .mockResolvedValueOnce('Just some text without a heading.')
      .mockRejectedValueOnce(new Error('no _meta.json'));

    const response = await GET(new NextRequest('http://localhost/test'));
    const body = await response.json();

    expect(body.docs[0].title).toBe('Untitled');
  });

  it('extracts multiple sections from markdown', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([
      makeDirent('multi.md', false),
    ] as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    vi.mocked(readFile)
      .mockResolvedValueOnce('# Title\n## Section A\nContent A.\n## Section B\nContent B.\n### Sub C\nContent C.')
      .mockRejectedValueOnce(new Error('no _meta.json'));

    const response = await GET(new NextRequest('http://localhost/test'));
    const body = await response.json();

    expect(body.docs[0].sections).toHaveLength(3);
    expect(body.docs[0].sections[0].heading).toBe('Section A');
    expect(body.docs[0].sections[1].heading).toBe('Section B');
    expect(body.docs[0].sections[2].heading).toBe('Sub C');
  });

  it('includes meta when _meta.json exists', async () => {
    vi.mocked(readdir).mockResolvedValueOnce([] as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    vi.mocked(readFile).mockResolvedValueOnce('{"order": ["intro", "guide"]}');

    const response = await GET(new NextRequest('http://localhost/test'));
    const body = await response.json();

    expect(body.meta).toEqual({ order: ['intro', 'guide'] });
  });

  it('returns empty docs gracefully when readdir fails', async () => {
    vi.mocked(readdir).mockRejectedValueOnce(new Error('disk failure'));
    vi.mocked(readFile).mockRejectedValueOnce(new Error('no _meta.json'));

    const response = await GET(new NextRequest('http://localhost/test'));
    const body = await response.json();

    // loadDocsRecursive catches readdir errors internally
    expect(response.status).toBe(200);
    expect(body.docs).toHaveLength(0);
  });
});
