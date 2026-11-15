/** Proxy/loader/Drizzle integration with seeded Neon HTTP responses, without a live database. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { neonConfig } from '@neondatabase/serverless';

vi.mock('server-only', () => ({}));

interface RecordedQuery { query: string; params: string[] }
let queries: RecordedQuery[] = [];
let authorPresent = false;
let gamePresent = false;
let lookupFails = false;
const originalFetch = neonConfig.fetchFunction;

/** Return Neon full-result rows for the actual SQL emitted by Drizzle. */
const transport = vi.fn(async (_input: unknown, init?: RequestInit) => {
  const query = JSON.parse(String(init?.body)) as RecordedQuery;
  queries.push(query);
  if (lookupFails) {
    return new Response(JSON.stringify({ message: 'secret database endpoint', code: '42601' }), { status: 400 });
  }
  const isAuthor = query.query.includes('from "users"');
  const fields = isAuthor
    ? [{ name: 'id', dataTypeID: 25 }, { name: 'display_name', dataTypeID: 25 }]
    : [{ name: 'title', dataTypeID: 25 }, { name: 'description', dataTypeID: 25 }, { name: 'created_at', dataTypeID: 1114 }];
  const rows = isAuthor
    ? authorPresent ? [['user_db_fixture', 'Fixture Author']] : []
    : gamePresent ? [['Fixture Game', 'Published fixture', '2026-01-01 00:00:00']] : [];
  return new Response(JSON.stringify({ fields, rows, rowCount: rows.length, command: 'SELECT' }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});

/** Execute the actual exported proxy and published lookup against the seeded transport. */
async function request(method = 'GET') {
  const { proxy } = await import('@/proxy');
  return proxy(new NextRequest('http://localhost:3000/play/user_transport_fixture/fixture-game', { method }));
}

describe('published lookup integration', () => {
  beforeEach(() => {
    vi.resetModules();
    queries = [];
    authorPresent = false;
    gamePresent = false;
    lookupFails = false;
    transport.mockClear();
    vi.stubEnv('DATABASE_URL', 'postgresql://fixture:fixture@fixture.neon.tech/fixture');
    vi.stubEnv('CLERK_SECRET_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    neonConfig.fetchFunction = transport;
  });
  afterEach(() => {
    neonConfig.fetchFunction = originalFetch;
    vi.unstubAllEnvs();
  });

  it('returns literal404 after the actual author query finds no author', async () => {
    const response = await request();
    expect(response.status).toBe(404);
    expect(queries).toHaveLength(1);
    expect(queries[0].query).toContain('from "users"');
    expect(queries[0].params).toContain('user_transport_fixture');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.headers.get('x-middleware-next')).toBeNull();
    expect(await response.text()).toContain('<h1>Game Not Found</h1>');
  });

  it('returns literal404 for an absent published game after querying an existing author', async () => {
    authorPresent = true;
    const response = await request();
    expect(response.status).toBe(404);
    expect(queries).toHaveLength(2);
    expect(queries[1].query).toContain('from "published_games"');
    expect(queries[1].query).toContain('"status"');
    expect(queries[1].params).toEqual(['user_db_fixture', 'fixture-game', 'published', '1']);
    expect(await response.text()).not.toContain('VideoGame');
  });

  it('preserves200 passthrough for the actual published metadata result', async () => {
    authorPresent = true;
    gamePresent = true;
    const response = await request();
    expect(response.status).toBe(200);
    expect(queries).toHaveLength(2);
    expect(queries[1].params).toContain('published');
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(await response.text()).toBe('');
  });

  it.each(['GET', 'HEAD'])('returns503 rather than absence when the actual transport fails: %s', async method => {
    lookupFails = true;
    const response = await request(method);
    expect(queries).toHaveLength(1);
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBeNull();
    const html = await response.text();
    expect(html).not.toContain('secret database endpoint');
    expect(html).not.toContain('noindex');
    if (method === 'HEAD') expect(response.body).toBeNull();
    else expect(html).toContain('<h1>Game Temporarily Unavailable</h1>');
  });
});
