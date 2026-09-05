import type { MetadataRoute } from 'next';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { DOCS_URL } from '../lib/site';

export interface MdxEntry {
  path: string;
  mtime: Date;
}

/**
 * Turn a content-relative `.mdx` file path into the URL path it is served at.
 *
 * `path.relative()` answers in the HOST separator, and everything downstream —
 * the emitted `url`, the `/index` strip, the `/mcp/` priority rule — is talking
 * about URLs. On Windows that difference is not cosmetic: the sitemap advertised
 * `/mcp\overview`, `/index` was never stripped (the `\/index$` rule cannot see a
 * backslash), and every page silently fell to the 0.6 priority bucket because
 * `startsWith('/mcp/')` matched nothing. Normalising once, here, keeps the rest
 * of the module handling URL paths only.
 *
 * `separator` is injectable so the Windows shape can be asserted from any host;
 * production always uses the platform's own `path.sep`.
 */
export function toUrlPath(rel: string, separator: string = sep): string {
  const normalized = rel
    .split(separator)
    .join('/')
    .replace(/\.mdx$/, '')
    .replace(/\/index$/, '');
  return normalized === 'index' ? '' : `/${normalized}`;
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
        entries.push({
          path: toUrlPath(relative(base, full)),
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
    // Rendered from data/capability-matrix.md by app/capability-matrix/page.tsx,
    // not from content/, so the MDX walk below cannot discover it.
    {
      url: `${DOCS_URL}/capability-matrix`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.8,
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
