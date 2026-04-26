import type { MetadataRoute } from 'next';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.spawnforge.ai';

export interface MdxEntry {
  path: string;
  mtime: Date;
}

export function collectMdxPaths(dir: string, base: string): MdxEntry[] {
  const entries: MdxEntry[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        entries.push(...collectMdxPaths(full, base));
      } else if (entry.endsWith('.mdx')) {
        const rel = relative(base, full)
          .replace(/\.mdx$/, '')
          .replace(/\/index$/, '');
        entries.push({
          path: rel === 'index' ? '' : `/${rel}`,
          mtime: stat.mtime,
        });
      }
    }
  } catch {
    // Content directory may not exist in CI
  }
  return entries;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const contentDir = join(process.cwd(), 'content');
  const mdxEntries = collectMdxPaths(contentDir, contentDir);

  return [
    {
      url: DOCS_URL,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    ...mdxEntries
      .filter((e) => e.path !== '')
      .map((entry) => ({
        url: `${DOCS_URL}${entry.path}`,
        lastModified: entry.mtime,
        changeFrequency: 'weekly' as const,
        priority: entry.path.startsWith('/mcp/') ? 0.7 : 0.6,
      })),
  ];
}
