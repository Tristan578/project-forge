import type { PGlite } from '@electric-sql/pglite';
import { neon, neonConfig } from '@neondatabase/serverless';
import { afterEach, describe, expect, it } from 'vitest';
import { makeNeonAdapter, SqlTemplate } from './pgliteHarness';

type SingleBody = { query: string; params: unknown[] };
type BatchBody = { queries: SingleBody[] };
type Captured = SingleBody | BatchBody;

function isBatch(body: Captured): body is BatchBody {
  return 'queries' in body;
}

function captureFetch(): { get: () => Captured | undefined; fetchFn: typeof fetch } {
  let captured: Captured | undefined;
  const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Captured;
    captured = body;
    const responseBody = isBatch(body)
      ? { results: body.queries.map(() => ({ fields: [], rows: [] })) }
      : { fields: [], rows: [] };
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  return { get: () => captured, fetchFn };
}

function harnessShape(promise: { queryData: unknown }): SingleBody {
  if (!(promise.queryData instanceof SqlTemplate)) {
    throw new Error('expected tagged-template query data');
  }
  return promise.queryData.toParameterizedQuery();
}

function normalizeParam(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function expectComposedEqual(expected: SingleBody, captured: SingleBody): void {
  expect(captured.query).toBe(expected.query);
  expect(captured.params.map(normalizeParam)).toEqual(expected.params.map(normalizeParam));
}

describe('PGlite harness Neon adapter fidelity', () => {
  // No Postgres-WASM instance at all. Every test here compares the SQL text and
  // parameter list that `makeNeonAdapter` COMPOSES against the wire body the
  // real Neon driver sends, and reads that text synchronously off `queryData`;
  // nothing is ever executed. `makeNeonAdapter` touches its client only inside
  // the `RunQuery` body, which runs when a `NeonQueryPromise` is awaited — so
  // the constructor argument is a type obligation, not a runtime one.
  //
  // This file used to boot and tear down a fresh PGlite around each test.
  // Repeated WASM init/teardown in one process is the shape behind the
  // intermittent V8 CHECK failure in ThreadIsolation::UnregisterWasmAllocation
  // (SIGILL, exit 132) that failed Web Tests closed on #9590 (#9643; upstream
  // electric-sql/pglite#1053, nodejs/node#64500). Sharing one instance would
  // have cut that surface from four to one; needing none cuts it to zero.
  //
  // The stand-in throws rather than no-ops, and records what it was asked for,
  // so a future test that does need a real database fails loudly here instead
  // of silently observing an empty result set. Reach for `createTestHarness()`
  // in that case.
  const touched: string[] = [];
  const pglite = new Proxy({} as PGlite, {
    get(_target, property) {
      const name = String(property);
      touched.push(name);
      throw new Error(
        `pgliteHarness.test.ts composes SQL and executes nothing, but PGlite.${name} was read. ` +
          'Use createTestHarness() if the test needs a real database.',
      );
    },
  });

  afterEach(() => {
    neonConfig.fetchFunction = undefined;
  });

  it('matches embedded-fragment SQL text and parameter numbering', async () => {
    const scratch = makeNeonAdapter(pglite);
    const fragment = scratch`tier = ${'starter'}`;
    const composed = scratch`SELECT * FROM users WHERE id = ${42} AND ${fragment}`;
    const { get, fetchFn } = captureFetch();
    neonConfig.fetchFunction = fetchFn;
    const realSql = neon('postgresql://user:pass@fake-host.neon.tech/db');

    await realSql`SELECT * FROM users WHERE id = ${42} AND tier = ${'starter'}`;
    const captured = get();

    expect(captured).toBeDefined();
    expect(isBatch(captured!)).toBe(false);
    expectComposedEqual(harnessShape(composed), captured as SingleBody);
  });

  it('matches every query in a transaction batch', async () => {
    const scratch = makeNeonAdapter(pglite);
    const first = scratch`INSERT INTO users (id) VALUES (${7})`;
    const second = scratch`UPDATE users SET name = ${'Ada'} WHERE id = ${7}`;
    const { get, fetchFn } = captureFetch();
    neonConfig.fetchFunction = fetchFn;
    const realSql = neon('postgresql://user:pass@fake-host.neon.tech/db');

    await realSql.transaction([
      realSql`INSERT INTO users (id) VALUES (${7})`,
      realSql`UPDATE users SET name = ${'Ada'} WHERE id = ${7}`,
    ]);
    const captured = get();

    expect(captured).toBeDefined();
    expect(isBatch(captured!)).toBe(true);
    const queries = (captured as BatchBody).queries;
    expect(queries).toHaveLength(2);
    expectComposedEqual(harnessShape(first), queries[0]);
    expectComposedEqual(harnessShape(second), queries[1]);
  });

  it('preserves null while matching number and string parameter order', async () => {
    const scratch = makeNeonAdapter(pglite);
    const composed = scratch`SELECT ${null}, ${7}, ${'abc'}`;
    const { get, fetchFn } = captureFetch();
    neonConfig.fetchFunction = fetchFn;
    const realSql = neon('postgresql://user:pass@fake-host.neon.tech/db');

    await realSql`SELECT ${null}, ${7}, ${'abc'}`;
    const expected = harnessShape(composed);
    const captured = get() as SingleBody;

    expect(expected.params[0]).toBeNull();
    expect(captured.params[0]).toBeNull();
    expectComposedEqual(expected, captured);
  });

  it('rejects interpolation of a parameter-bearing raw query', () => {
    const scratch = makeNeonAdapter(pglite);
    const parameterized = scratch.query('x = $1', [5]);
    const composed = new SqlTemplate(['SELECT * WHERE ', ''], [parameterized]);

    expect(() => composed.toParameterizedQuery()).toThrow('This query is not composable');
  });

  // Declared last so it observes every test above. This is what makes dropping
  // PGlite from this file a checked claim rather than an assumption: add a test
  // that actually queries, and the stand-in throws inside it AND this records
  // the property it reached for.
  it('never touches the database client', () => {
    expect(touched).toEqual([]);
  });
});
