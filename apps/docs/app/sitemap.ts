import type { MetadataRoute } from 'next';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DOCS_URL = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.spawnforge.ai';

function collectMdxPaths(dir: string, base: string): string[] {
  const paths: string[] = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        paths.push(...collectMdxPaths(full, base));
      } else if (entry.endsWith('.mdx')) {
        const rel = relative(base, full)
          .replace(/\.mdx$/, '')
          .replace(/\/index$/, '');
        paths.push(rel === 'index' ? '' : `/${rel}`);
      }
    }
  } catch {
    // Content directory may not exist in CI
  }
  return paths;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const contentDir = join(process.cwd(), 'content');
  const mdxPaths = collectMdxPaths(contentDir, contentDir);

  return [
    {
      url: DOCS_URL,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    ...mdxPaths
      .filter((p) => p !== '')
      .map((path) => ({
        url: `${DOCS_URL}${path}`,
        lastModified: now,
        changeFrequency: 'weekly' as const,
        priority: path.startsWith('/mcp/') ? 0.7 : 0.6,
      })),
  ];
}
