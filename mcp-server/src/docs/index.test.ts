import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocIndex } from './loader.js';

/**
 * `registerDocs` had no test at all, so the shape of the `docs-index` resource
 * was pinned by nothing. The row shape matters under exactOptionalPropertyTypes
 * (#7592): a doc with no tags must produce a row with NO `tags` key, not
 * `tags: undefined`, because the resource is JSON-serialised and the two are
 * different documents to anything that inspects keys.
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
  const tools = new Map<string, unknown>();
  return {
    resources,
    tools,
    server: {
      resource: (name: string, _uri: string, handler: ResourceHandler) => {
        resources.set(name, handler);
      },
      tool: (name: string, ..._rest: unknown[]) => {
        tools.set(name, _rest);
      },
    },
  };
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

describe('registerDocs / docs-index resource', () => {
  beforeEach(() => {
    vi.resetModules();
    fixture.index = makeIndex();
  });

  it('includes tags only for docs that have them, and omits the key otherwise', async () => {
    const { registerDocs } = await import('./index.js');
    const fake = fakeServer();
    registerDocs(fake.server as never);

    const handler = fake.resources.get('docs-index');
    expect(handler).toBeDefined();

    const result = await handler!(new URL('forge://docs/index'));
    expect(result.contents).toHaveLength(1);
    expect(result.contents[0].mimeType).toBe('application/json');

    const { topics } = JSON.parse(result.contents[0].text) as { topics: unknown[] };
    // toStrictEqual: a `tags: undefined` key on the untagged row would fail here,
    // and so would a `tags: null` — only the absent key passes.
    expect(topics).toStrictEqual([
      { path: 'features/physics', title: 'Physics', tags: ['physics', 'engine'] },
      { path: 'guides/start', title: 'Getting Started' },
    ]);
    // The serialised text is what an MCP client receives; make sure the absent
    // key is absent there too, not just after a parse that would drop it.
    expect(result.contents[0].text).not.toContain('"tags": null');
    expect((result.contents[0].text.match(/"tags"/g) ?? []).length).toBe(1);
  });

  it('registers the three documentation tools', async () => {
    const { registerDocs } = await import('./index.js');
    const fake = fakeServer();
    registerDocs(fake.server as never);
    expect([...fake.tools.keys()].sort()).toEqual(
      ['get_doc', 'list_doc_topics', 'search_docs'].sort(),
    );
  });
});
