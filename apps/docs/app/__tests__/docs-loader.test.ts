/**
 * @vitest-environment node
 *
 * Issue #9061 (PF-1039), AC4: "its title and description come from the MDX
 * frontmatter rather than a hardcoded fallback."
 *
 * The generated command pages (`content/mcp/*.mdx`) carry NO `title` frontmatter
 * — only `commandName` / `category` / `visibility` / `description`
 * (`scripts/generate-mcp-docs.ts`). The fumadocs source schema in
 * `source.config.ts` is the single place that turns that into the title a
 * command page shows in the sidebar and heading, by deriving `title` from
 * `commandName`. This asserts that derivation over a REAL generated page — the
 * same generator output the site ships — so a regression to a hardcoded label
 * (e.g. the layout's "SpawnForge Documentation" default) fails here.
 *
 * It exercises the schema directly rather than the fumadocs `loader()`: the
 * generated `.source` loader index imports every page through the fumadocs
 * webpack MDX loader (`../content/mcp/x.mdx?collection=docs`), which only exists
 * inside a Next build, not under vitest/node. The schema is the node-testable
 * contract that governs the title either way.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { generateMcpDocs } from '../../scripts/generate-mcp-docs';
import { docsSchema } from '../../source.config';

const here = join(fileURLToPath(import.meta.url), '..');
// The in-root manifest copy (kept identical to mcp-server/manifest/commands.json
// by the sync gate) — resolvable from apps/docs on Vercel and in CI.
const MANIFEST = join(here, '..', '..', 'data', 'commands.json');
// A known public command with parameter-free args; stable in the manifest.
const KNOWN_COMMAND = 'get_export_status';

describe('generated command page frontmatter → schema title (AC4)', () => {
  let outDir: string;
  let frontmatter: Record<string, unknown>;

  beforeAll(() => {
    outDir = mkdtempSync(join(tmpdir(), 'docs-loader-'));
    const result = generateMcpDocs(MANIFEST, outDir);
    expect(result.generatedCount).toBeGreaterThan(0);
    const raw = readFileSync(join(outDir, `${KNOWN_COMMAND}.mdx`), 'utf-8');
    frontmatter = matter(raw).data as Record<string, unknown>;
  });

  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it('the generator emits commandName and description but no title', () => {
    expect(frontmatter.commandName).toBe(KNOWN_COMMAND);
    expect(typeof frontmatter.description).toBe('string');
    expect((frontmatter.description as string).length).toBeGreaterThan(0);
    // The premise of AC4: there is no `title` to fall back on — it MUST be derived.
    expect(frontmatter.title).toBeUndefined();
  });

  it('derives the page title from commandName, not a hardcoded fallback', () => {
    const page = docsSchema.parse(frontmatter);
    expect(page.title).toBe(KNOWN_COMMAND);
    // Guard against a regression to the layout's hardcoded default title.
    expect(page.title).not.toBe('SpawnForge Documentation');
    // Description passes through from frontmatter untouched.
    expect(page.description).toBe(frontmatter.description);
  });

  it('preserves an explicit frontmatter title when one is present', () => {
    // The index/api pages carry a real `title` and must keep it — the derivation
    // prefers an explicit title over commandName.
    const page = docsSchema.parse({ title: 'API Reference' });
    expect(page.title).toBe('API Reference');
  });
});
