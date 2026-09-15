import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { z } from 'zod';

/**
 * Frontmatter schema for the docs content tree. It has to accept TWO shapes,
 * both machine-emitted, that share no required key:
 *
 *  - `content/index.mdx` and `content/api/index.mdx` carry only `title`.
 *  - `content/mcp/*.mdx` (291 files from `scripts/generate-mcp-docs.ts`) carry
 *    `commandName` / `category` / `visibility` / `description` and NO `title`.
 *
 * fumadocs' built-in `frontmatterSchema` requires `title`, so it would reject
 * every command page. This schema keeps every key optional and DERIVES the page
 * title (`title ?? commandName`) instead of demanding both — the title a command
 * page shows in the sidebar and `<h1>` comes straight from its `commandName`
 * frontmatter, never a hardcoded fallback (issue #9061 AC4). The empty-string
 * tail only fires for a page carrying neither key, which the generator never
 * produces; a real page always resolves to its own frontmatter.
 */
export const docsSchema = z
  .object({
    title: z.string().optional(),
    commandName: z.string().optional(),
    category: z.string().optional(),
    visibility: z.string().optional(),
    description: z.string().optional(),
    lastUpdated: z.string().optional(),
    lastUpdatedBy: z.string().optional(),
  })
  .transform((data) => ({
    ...data,
    title: data.title ?? data.commandName ?? '',
  }));

export const docs = defineDocs({
  dir: 'content',
  docs: { schema: docsSchema },
});

export default defineConfig();
