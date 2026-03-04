import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReaddir = vi.fn();
const mockReadFile = vi.fn();

vi.mock('fs/promises', () => ({
  readdir: mockReaddir,
  readFile: mockReadFile,
  default: { readdir: mockReaddir, readFile: mockReadFile },
}));

describe('GET /api/docs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('should return docs and meta when directory exists', async () => {
    mockReaddir.mockResolvedValue([
      { name: 'getting-started.md', isDirectory: () => false, isFile: () => true },
    ]);
    mockReadFile.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath);
      if (p.endsWith('getting-started.md')) {
        return '# Getting Started\n\n## Setup\nInstall dependencies\n\n## Usage\nRun the app';
      }
      if (p.endsWith('_meta.json')) {
        throw new Error('ENOENT');
      }
      return '';
    });

    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.docs).toBeDefined();
    expect(Array.isArray(body.docs)).toBe(true);
    expect(body.docs.length).toBeGreaterThan(0);
    expect(body.docs[0].title).toBe('Getting Started');
  });

  it('should handle missing docs directory gracefully', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT'));
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.docs).toEqual([]);
  });

  it('should return empty meta when _meta.json is missing', async () => {
    mockReaddir.mockResolvedValue([]);
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta).toEqual({});
  });
});
