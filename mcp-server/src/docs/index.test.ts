import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DocIndex } from './loader.js';

/**
 * `registerDocs` had no test at all, so the shape of the `docs-index` resource
 * was pinned by nothing. The row shape matters under exactOptionalPropertyTypes
 * (#7592): a doc with no tags must produce a row with NO `tags` key, not
 * `tags: undefined`. JSON.stringify drops undefined-valued keys, so the
 * serialised resource cannot tell the two apart — the rows are therefore
 * asserted BEFORE serialisation through the exported `docsIndexTopics` helper,
 * and the serialised text is checked separately for the client-facing contract.
 */
const fixture = vi.hoisted(() => ({ index: null as DocIndex | null }));

vi.mock('./loader.js', () => ({
  getDocsDir: () => '/fixture/docs',
  loadDocs: () => {
    if (!fixture.index) throw new Error('fixture index not set');
    return fixture.index;
  },
}));

type ResourceHandler = (uri: URL, params?: unknown) => Promise<{
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}>;

/** A stand-in McpServer that records what registerDocs registers. */
function fakeServer() {
  const resources = new Map<string, ResourceHandler>();
  const tools = new Map<string, unknown[]>();
  const recorder = {
    resource: (name: string, _uri: string, handler: ResourceHandler) => {
      resources.set(name, handler);
    },
    tool: (name: string, ...rest: unknown[]) => {
      tools.set(name, rest);
    },
  };
  // Partial fake of an SDK class: it implements the two overloads registerDocs
  // uses and nothing else, so it cannot satisfy McpServer structurally. Same
  // idiom as relay/__tests__/server.test.ts for its SDK-typed fakes.
  const server = recorder as unknown as McpServer;
  return { resources, tools, server };
}

function makeIndex(): DocIndex {
  const docs = new Map();
  docs.set('features/physics', {
    path: 'features/physics', title: 'Physics', content: '# Physics', sections: [],
  });
  docs.set('guides/start', {
    path: 'guides/start', title: 'Getting Started', content: '# Getting Started', sections: [],
  });
  const meta = new Map();
  // Only one of the two docs carries tags.
  meta.set('features/physics', { title: 'Physics', tags: ['physics', 'engine'] });
  return { docs, meta };
}

describe('docsIndexTopics', () => {
  it('includes the tags key only for docs that have tags', async () => {
    const { docsIndexTopics } = await import('./index.js');
    const rows = docsIndexTopics(makeIndex());
    // toStrictEqual on the rows themselves: `tags: undefined` on the untagged
    // row fails here, which JSON.stringify would have hidden.
    expect(rows).toStrictEqual([
      { path: 'features/physics', title: 'Physics', tags: ['physics', 'engine'] },
      { path: 'guides/start', title: 'Getting Started' },
    ]);
    expect(Object.keys(rows[1])).toEqual(['path', 'title']);
  });

  it('sorts rows by path for stable output', async () => {
    const { docsIndexTopics } = await import('./index.js');
    const idx = makeIndex();
    // Insert order is reversed relative to path order.
    const reversed: DocIndex = { docs: new Map([...idx.docs.entries()].reverse()), meta: idx.meta };
    expect(docsIndexTopics(reversed).map((r) => r.path)).toEqual(['features/physics', 'guides/start']);
  });
});

describe('registerDocs / docs-index resource', () => {
  beforeEach(() => {
    vi.resetModules();
    fixture.index = makeIndex();
  });

  it('serves the topic rows as application/json with no null or undefined tags', async () => {
    const { registerDocs } = await import('./index.js');
    const fake = fakeServer();
    registerDocs(fake.server);

    const handler = fake.resources.get('docs-index');
    expect(handler).toBeDefined();

    const result = await handler!(new URL('forge://docs/index'));
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('application/json');

    const { topics } = JSON.parse(result.contents[0].text) as { topics: unknown[] };
    expect(topics).toStrictEqual([
      { path: 'features/physics', title: 'Physics', tags: ['physics', 'engine'] },
      { path: 'guides/start', title: 'Getting Started' },
    ]);
    // The serialised text is what an MCP client receives.
    expect(result.contents[0].text).not.toContain('"tags": null');
    expect((result.contents[0].text.match(/"tags"/g) ?? []).length).toBe(1);
  });

  it('registers the three documentation tools', async () => {
    const { registerDocs } = await import('./index.js');
    const fake = fakeServer();
    registerDocs(fake.server);
    expect([...fake.tools.keys()].sort()).toEqual(
      ['get_doc', 'list_doc_topics', 'search_docs'].sort(),
    );
  });
});
