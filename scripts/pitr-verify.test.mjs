import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PitrError,
  formatBranchName,
  computeParentTimestamp,
  buildBranchPayload,
  parseCreateResponse,
  isOperationDone,
  waitForOperation,
  runVerifyScript,
  main,
} from './pitr-verify.mjs';

describe('formatBranchName', () => {
  test('produces filesystem-safe branch name from Date', () => {
    const d = new Date('2026-04-11T19:04:38.123Z');
    assert.equal(formatBranchName(d), 'pitr-verify-2026-04-11T19-04-38');
  });
});

describe('computeParentTimestamp', () => {
  test('subtracts the given hours from now', () => {
    const now = new Date('2026-04-11T12:00:00Z');
    assert.equal(computeParentTimestamp(now, 24), '2026-04-10T12:00:00.000Z');
  });

  test('accepts numeric string', () => {
    const now = new Date('2026-04-11T12:00:00Z');
    assert.equal(computeParentTimestamp(now, '6'), '2026-04-11T06:00:00.000Z');
  });

  test('rejects zero', () => {
    assert.throws(() => computeParentTimestamp(new Date(), 0), PitrError);
  });

  test('rejects negative', () => {
    assert.throws(() => computeParentTimestamp(new Date(), -1), PitrError);
  });

  test('rejects non-numeric', () => {
    assert.throws(() => computeParentTimestamp(new Date(), 'abc'), PitrError);
  });

  test('error carries exit code 2', () => {
    try {
      computeParentTimestamp(new Date(), 0);
      assert.fail('should have thrown');
    } catch (e) {
      assert.equal(e.exitCode, 2);
    }
  });
});

describe('buildBranchPayload', () => {
  test('shapes the Neon branch-create request body', () => {
    const body = buildBranchPayload({
      parentTimestamp: '2026-04-10T12:00:00.000Z',
      branchName: 'pitr-verify-2026-04-11T12-00-00',
    });
    assert.deepEqual(body, {
      branch: {
        parent_timestamp: '2026-04-10T12:00:00.000Z',
        name: 'pitr-verify-2026-04-11T12-00-00',
      },
      endpoints: [{ type: 'read_only' }],
    });
  });
});

describe('parseCreateResponse', () => {
  test('extracts branch id, connection uri, and operation ids', () => {
    const json = {
      branch: { id: 'br_abc' },
      connection_uris: [{ connection_uri: 'postgres://user:pw@host/db' }],
      operations: [{ id: 'op_1' }, { id: 'op_2' }],
    };
    assert.deepEqual(parseCreateResponse(json), {
      branchId: 'br_abc',
      connectionUri: 'postgres://user:pw@host/db',
      operationIds: ['op_1', 'op_2'],
    });
  });

  test('handles missing operations array', () => {
    const json = {
      branch: { id: 'br_abc' },
      connection_uris: [{ connection_uri: 'postgres://host/db' }],
    };
    assert.deepEqual(parseCreateResponse(json).operationIds, []);
  });

  test('throws if branch.id is missing', () => {
    assert.throws(
      () => parseCreateResponse({ connection_uris: [{ connection_uri: 'x' }] }),
      PitrError,
    );
  });

  test('throws if connection_uri is missing', () => {
    assert.throws(() => parseCreateResponse({ branch: { id: 'br_abc' } }), PitrError);
  });

  test('filters falsy operation ids', () => {
    const json = {
      branch: { id: 'br_abc' },
      connection_uris: [{ connection_uri: 'x' }],
      operations: [{ id: 'op_1' }, { id: null }, {}],
    };
    assert.deepEqual(parseCreateResponse(json).operationIds, ['op_1']);
  });
});

describe('isOperationDone', () => {
  test('finished → done + ok', () => {
    assert.deepEqual(isOperationDone({ operation: { status: 'finished' } }), {
      done: true,
      ok: true,
    });
  });

  test('failed → done + not ok', () => {
    const r = isOperationDone({ operation: { status: 'failed' } });
    assert.equal(r.done, true);
    assert.equal(r.ok, false);
    assert.equal(r.status, 'failed');
  });

  test('error → done + not ok', () => {
    assert.equal(isOperationDone({ operation: { status: 'error' } }).ok, false);
  });

  test('cancelled → done + not ok', () => {
    assert.equal(isOperationDone({ operation: { status: 'cancelled' } }).ok, false);
  });

  test('running → not done', () => {
    assert.deepEqual(isOperationDone({ operation: { status: 'running' } }), { done: false });
  });

  test('missing status → not done', () => {
    assert.deepEqual(isOperationDone({}), { done: false });
  });
});

function makeFetch(responses) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`no more mocked responses for ${url}`);
    return {
      ok: next.ok,
      status: next.status ?? (next.ok ? 200 : 500),
      statusText: next.statusText ?? '',
      text: async () => next.body ?? '',
    };
  };
  return { fetchFn, calls };
}

describe('waitForOperation', () => {
  test('resolves when first poll returns finished', async () => {
    const { fetchFn, calls } = makeFetch([
      { ok: true, body: JSON.stringify({ operation: { status: 'finished' } }) },
    ]);
    const sleeps = [];
    await waitForOperation({
      fetchFn,
      projectId: 'proj_1',
      apiKey: 'napi_xxx',
      operationId: 'op_1',
      sleepFn: async (ms) => sleeps.push(ms),
      now: () => 1000,
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/projects\/proj_1\/operations\/op_1$/);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer napi_xxx');
    assert.equal(sleeps.length, 0);
  });

  test('polls until finished', async () => {
    const { fetchFn, calls } = makeFetch([
      { ok: true, body: JSON.stringify({ operation: { status: 'running' } }) },
      { ok: true, body: JSON.stringify({ operation: { status: 'running' } }) },
      { ok: true, body: JSON.stringify({ operation: { status: 'finished' } }) },
    ]);
    let t = 0;
    const sleeps = [];
    await waitForOperation({
      fetchFn,
      projectId: 'p',
      apiKey: 'k',
      operationId: 'o',
      sleepFn: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
      now: () => t,
    });
    assert.equal(calls.length, 3);
    assert.deepEqual(sleeps, [2000, 2000]);
  });

  test('throws PitrError with exitCode 3 when operation fails', async () => {
    const { fetchFn } = makeFetch([
      { ok: true, body: JSON.stringify({ operation: { status: 'failed' } }) },
    ]);
    try {
      await waitForOperation({
        fetchFn,
        projectId: 'p',
        apiKey: 'k',
        operationId: 'op_bad',
        sleepFn: async () => {},
        now: () => 0,
      });
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e instanceof PitrError);
      assert.equal(e.exitCode, 3);
      assert.match(e.message, /op_bad/);
    }
  });

  test('throws PitrError with exitCode 4 on timeout', async () => {
    const { fetchFn } = makeFetch([
      { ok: true, body: JSON.stringify({ operation: { status: 'running' } }) },
    ]);
    let t = 0;
    try {
      await waitForOperation({
        fetchFn,
        projectId: 'p',
        apiKey: 'k',
        operationId: 'op_slow',
        sleepFn: async (ms) => {
          t += ms + 200_000;
        },
        now: () => t,
      });
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e instanceof PitrError);
      assert.equal(e.exitCode, 4);
    }
  });

  test('throws PitrError with exitCode 3 on non-2xx', async () => {
    const { fetchFn } = makeFetch([
      { ok: false, status: 401, statusText: 'Unauthorized', body: 'bad key' },
    ]);
    try {
      await waitForOperation({
        fetchFn,
        projectId: 'p',
        apiKey: 'k',
        operationId: 'o',
        sleepFn: async () => {},
        now: () => 0,
      });
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e instanceof PitrError);
      assert.equal(e.exitCode, 3);
      assert.match(e.message, /401/);
    }
  });
});

describe('runVerifyScript', () => {
  test('resolves with child exit code and sets NEON_VERIFY_DB_URL env', async () => {
    const spawned = [];
    const spawnFn = (cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      const listeners = {};
      const child = {
        on: (event, fn) => {
          listeners[event] = fn;
          return child;
        },
      };
      setImmediate(() => listeners.exit?.(0));
      return child;
    };
    const code = await runVerifyScript({
      connectionUri: 'postgres://host/db',
      scriptPath: '/tmp/verify.sh',
      spawnFn,
    });
    assert.equal(code, 0);
    assert.equal(spawned[0].cmd, 'bash');
    assert.deepEqual(spawned[0].args, ['/tmp/verify.sh']);
    assert.equal(spawned[0].opts.env.NEON_VERIFY_DB_URL, 'postgres://host/db');
    assert.equal(spawned[0].opts.stdio, 'inherit');
  });

  test('rejects on child error', async () => {
    const spawnFn = () => {
      const listeners = {};
      const child = {
        on: (event, fn) => {
          listeners[event] = fn;
          return child;
        },
      };
      setImmediate(() => listeners.error?.(new Error('spawn failed')));
      return child;
    };
    await assert.rejects(
      runVerifyScript({ connectionUri: 'x', scriptPath: '/tmp/x.sh', spawnFn }),
      /spawn failed/,
    );
  });

  test('treats null exit code as failure (1)', async () => {
    const spawnFn = () => {
      const listeners = {};
      const child = {
        on: (event, fn) => {
          listeners[event] = fn;
          return child;
        },
      };
      setImmediate(() => listeners.exit?.(null));
      return child;
    };
    const code = await runVerifyScript({
      connectionUri: 'x',
      scriptPath: '/tmp/x.sh',
      spawnFn,
    });
    assert.equal(code, 1);
  });
});

function makeEnv(overrides = {}) {
  return {
    NEON_API_KEY: 'napi_test',
    NEON_PROJECT_ID: 'proj_test',
    HOURS_AGO: '24',
    ...overrides,
  };
}

describe('main', () => {
  test('creates branch, waits for ops, runs verify, deletes branch, returns 0', async () => {
    const createBody = JSON.stringify({
      branch: { id: 'br_new' },
      connection_uris: [{ connection_uri: 'postgres://host/db' }],
      operations: [{ id: 'op_1' }],
    });
    const { fetchFn, calls } = makeFetch([
      { ok: true, body: createBody },
      { ok: true, body: JSON.stringify({ operation: { status: 'finished' } }) },
      { ok: true, body: '{}' },
    ]);
    const spawnFn = () => {
      const listeners = {};
      const child = {
        on: (event, fn) => {
          listeners[event] = fn;
          return child;
        },
      };
      setImmediate(() => listeners.exit?.(0));
      return child;
    };
    const logs = [];
    const code = await main({
      env: makeEnv(),
      fetchFn,
      spawnFn,
      sleepFn: async () => {},
      now: () => Date.parse('2026-04-11T12:00:00Z'),
      log: (m) => logs.push(m),
      scriptPath: '/tmp/verify.sh',
    });
    assert.equal(code, 0);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].init.method, 'POST');
    assert.match(calls[0].url, /\/projects\/proj_test\/branches$/);
    assert.equal(calls[2].init.method, 'DELETE');
    assert.match(calls[2].url, /\/projects\/proj_test\/branches\/br_new$/);
    assert.ok(logs.some((l) => l.includes('Branch deleted')));
  });

  test('deletes branch even when verify script fails, returns 1', async () => {
    const createBody = JSON.stringify({
      branch: { id: 'br_new' },
      connection_uris: [{ connection_uri: 'postgres://host/db' }],
      operations: [{ id: 'op_1' }],
    });
    const { fetchFn, calls } = makeFetch([
      { ok: true, body: createBody },
      { ok: true, body: JSON.stringify({ operation: { status: 'finished' } }) },
      { ok: true, body: '{}' },
    ]);
    const spawnFn = () => {
      const listeners = {};
      const child = {
        on: (event, fn) => {
          listeners[event] = fn;
          return child;
        },
      };
      setImmediate(() => listeners.exit?.(2));
      return child;
    };
    const code = await main({
      env: makeEnv(),
      fetchFn,
      spawnFn,
      sleepFn: async () => {},
      now: () => Date.parse('2026-04-11T12:00:00Z'),
      log: () => {},
      scriptPath: '/tmp/verify.sh',
    });
    assert.equal(code, 1);
    assert.equal(calls[2].init.method, 'DELETE');
  });

  test('deletes branch even when operation polling throws', async () => {
    const createBody = JSON.stringify({
      branch: { id: 'br_new' },
      connection_uris: [{ connection_uri: 'postgres://host/db' }],
      operations: [{ id: 'op_1' }],
    });
    const { fetchFn, calls } = makeFetch([
      { ok: true, body: createBody },
      { ok: true, body: JSON.stringify({ operation: { status: 'failed' } }) },
      { ok: true, body: '{}' },
    ]);
    await assert.rejects(
      main({
        env: makeEnv(),
        fetchFn,
        spawnFn: () => {
          throw new Error('should not spawn');
        },
        sleepFn: async () => {},
        now: () => Date.parse('2026-04-11T12:00:00Z'),
        log: () => {},
        scriptPath: '/tmp/verify.sh',
      }),
      PitrError,
    );
    assert.equal(calls[2].init.method, 'DELETE');
  });

  test('swallows delete failure with warning', async () => {
    const createBody = JSON.stringify({
      branch: { id: 'br_new' },
      connection_uris: [{ connection_uri: 'postgres://host/db' }],
      operations: [],
    });
    const { fetchFn } = makeFetch([
      { ok: true, body: createBody },
      { ok: false, status: 500, statusText: 'Server Error', body: 'boom' },
    ]);
    const spawnFn = () => {
      const listeners = {};
      const child = {
        on: (event, fn) => {
          listeners[event] = fn;
          return child;
        },
      };
      setImmediate(() => listeners.exit?.(0));
      return child;
    };
    const logs = [];
    const code = await main({
      env: makeEnv(),
      fetchFn,
      spawnFn,
      sleepFn: async () => {},
      now: () => Date.parse('2026-04-11T12:00:00Z'),
      log: (m) => logs.push(m),
      scriptPath: '/tmp/verify.sh',
    });
    assert.equal(code, 0);
    assert.ok(logs.some((l) => l.startsWith('WARN: failed to delete branch')));
  });

  test('throws PitrError with exitCode 2 when NEON_API_KEY missing', async () => {
    try {
      await main({
        env: makeEnv({ NEON_API_KEY: undefined }),
        fetchFn: async () => {
          throw new Error('should not fetch');
        },
        spawnFn: () => {
          throw new Error('should not spawn');
        },
        sleepFn: async () => {},
        now: () => 0,
        log: () => {},
        scriptPath: '/tmp/verify.sh',
      });
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e instanceof PitrError);
      assert.equal(e.exitCode, 2);
      assert.match(e.message, /NEON_API_KEY/);
    }
  });

  test('throws PitrError with exitCode 2 when NEON_PROJECT_ID missing', async () => {
    try {
      await main({
        env: makeEnv({ NEON_PROJECT_ID: undefined }),
        fetchFn: async () => {
          throw new Error('should not fetch');
        },
        spawnFn: () => {
          throw new Error('should not spawn');
        },
        sleepFn: async () => {},
        now: () => 0,
        log: () => {},
        scriptPath: '/tmp/verify.sh',
      });
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e instanceof PitrError);
      assert.equal(e.exitCode, 2);
      assert.match(e.message, /NEON_PROJECT_ID/);
    }
  });

  test('sends parent_timestamp hours before now', async () => {
    const createBody = JSON.stringify({
      branch: { id: 'br_new' },
      connection_uris: [{ connection_uri: 'x' }],
      operations: [],
    });
    const { fetchFn, calls } = makeFetch([
      { ok: true, body: createBody },
      { ok: true, body: '{}' },
    ]);
    const spawnFn = () => {
      const listeners = {};
      const child = {
        on: (event, fn) => {
          listeners[event] = fn;
          return child;
        },
      };
      setImmediate(() => listeners.exit?.(0));
      return child;
    };
    await main({
      env: makeEnv({ HOURS_AGO: '6' }),
      fetchFn,
      spawnFn,
      sleepFn: async () => {},
      now: () => Date.parse('2026-04-11T12:00:00Z'),
      log: () => {},
      scriptPath: '/tmp/verify.sh',
    });
    const postBody = JSON.parse(calls[0].init.body);
    assert.equal(postBody.branch.parent_timestamp, '2026-04-11T06:00:00.000Z');
    assert.equal(postBody.endpoints[0].type, 'read_only');
  });
});
