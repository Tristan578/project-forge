/**
 * MCP resource and tool registration for the documentation system.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadDocs, getDocsDir } from './loader.js';
import { buildIndex, search } from './search.js';
import type { DocIndex } from './loader.js';
import type { TermIndex } from './search.js';

let docIndex: DocIndex | null = null;
let termIndex: TermIndex | null = null;

/**
 * Ensure docs are loaded and indexed. Lazy-loads on first access.
 */
function ensureLoaded(): { docIndex: DocIndex; termIndex: TermIndex } {
  if (!docIndex || !termIndex) {
    const docsDir = getDocsDir();
    docIndex = loadDocs(docsDir);
    termIndex = buildIndex(docIndex);
  }
  return { docIndex, termIndex };
}

/**
 * Register documentation resources and tools on the MCP server.
 */
export function registerDocs(server: McpServer): void {
  // ── Resource: Documentation Index ──
  server.resource(
    'docs-index',
    'forge://docs/index',
    async (uri) => {
      const { docIndex: idx } = ensureLoaded();

      const topics: Array<{ path: string; title: string; tags?: string[] }> = [];
      for (const [path, doc] of idx.docs) {
        const meta = idx.meta.get(path);
        topics.push({
          path,
          title: doc.title,
          tags: meta?.tags,
        });
      }

      // Sort by path for stable ordering
      topics.sort((a, b) => a.path.localeCompare(b.path));

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ topics }, null, 2),
          },
        ],
      };
    }
  );

  // ── Resource Template: Individual Documents ──
  server.resource(
    'doc-page',
    'forge://docs/{path}',
    async (uri, params) => {
      const { docIndex: idx } = ensureLoaded();

      // Extract path from URI: forge://docs/features/physics → features/physics
      const docPath = uri.href.replace('forge://docs/', '');
      const doc = idx.docs.get(docPath);

      if (!doc) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Document not found: ${docPath}\n\nAvailable paths:\n${[...idx.docs.keys()].sort().join('\n')}`,
            },
          ],
        };
      }

      const meta = idx.meta.get(docPath);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/markdown',
            text: doc.content,
          },
        ],
      };
    }
  );

  // ── Tool: search_docs ──
  server.tool(
    'search_docs',
    'Search Project Forge documentation by keyword. Returns ranked results with snippets.',
    {
      query: z.string().describe('Search query (keywords or natural language question)'),
      maxResults: z.number().optional().describe('Maximum results to return (default: 10)'),
    },
    async (args) => {
      const { docIndex: idx, termIndex: tIdx } = ensureLoaded();
      const maxResults = args.maxResults ?? 10;
      const results = search(args.query, idx, tIdx, maxResults);

      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No documentation found for "${args.query}". Try different keywords.`,
            },
          ],
        };
      }

      const formatted = results.map((r, i) => {
        let entry = `${i + 1}. **${r.title}** (\`${r.path}\`) — score: ${r.score}`;
        if (r.matchSection) {
          entry += `\n   Section: ${r.matchSection}`;
        }
        entry += `\n   ${r.snippet}`;
        return entry;
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: `Found ${results.length} results for "${args.query}":\n\n${formatted.join('\n\n')}`,
          },
        ],
      };
    }
  );

  // ── Tool: get_doc ──
  server.tool(
    'get_doc',
    'Retrieve a full documentation page by its path (e.g., "features/physics").',
    {
      path: z.string().describe('Document path relative to docs/ without .md extension (e.g., "features/physics", "guides/build-fps-game")'),
    },
    async (args) => {
      const { docIndex: idx } = ensureLoaded();
      const doc = idx.docs.get(args.path);

      if (!doc) {
        const available = [...idx.docs.keys()].sort().join('\n  ');
        return {
          content: [
            {
              type: 'text' as const,
              text: `Document not found: "${args.path}"\n\nAvailable documents:\n  ${available}`,
            },
          ],
          isError: true,
        };
      }

      const meta = idx.meta.get(args.path);
      let header = '';
      if (meta) {
        if (meta.related && meta.related.length > 0) {
          header += `Related: ${meta.related.join(', ')}\n`;
        }
        if (meta.commands && meta.commands.length > 0) {
          header += `Commands: ${meta.commands.join(', ')}\n`;
        }
        header += '\n---\n\n';
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: header + doc.content,
          },
        ],
      };
    }
  );

  // ── Tool: list_doc_topics ──
  server.tool(
    'list_doc_topics',
    'List all available documentation topics with descriptions and tags.',
    {},
    async () => {
      const { docIndex: idx } = ensureLoaded();

      const topics: Array<{ path: string; title: string; tags: string[] }> = [];
      for (const [path, doc] of idx.docs) {
        const meta = idx.meta.get(path);
        topics.push({
          path,
          title: doc.title,
          tags: meta?.tags ?? [],
        });
      }

      topics.sort((a, b) => a.path.localeCompare(b.path));

      const formatted = topics.map(
        t => `- **${t.title}** (\`${t.path}\`)${t.tags.length > 0 ? `\n  Tags: ${t.tags.join(', ')}` : ''}`
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `Available documentation (${topics.length} topics):\n\n${formatted.join('\n')}`,
          },
        ],
      };
    }
  );
}
