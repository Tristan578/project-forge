import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { docsSchema } from './lib/docs-schema';

// fumadocs-mdx treats EVERY export of this file as a collection and throws on
// anything else ("Unknown export ..."), so the frontmatter schema lives in
// lib/docs-schema.ts, where the node test can import it too.
export const docs = defineDocs({
  dir: 'content',
  docs: { schema: docsSchema },
});

export default defineConfig();
