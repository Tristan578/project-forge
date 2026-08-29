import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  FAILURE_CLASS,
  FAILURE_CLASSES,
  PitrError,
  classifyError,
  classifyHttpStatus,
  classifyOutcome,
  writeFailureClass,
  formatBranchName,
  computeParentTimestamp,
  buildBranchPayload,
  parseCreateResponse,
  parseRetentionSeconds,
  RETENTION_SAFETY_MARGIN,
  resolveLookbackHours,
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

/** 24h of retention: enough that the default 24h lookback is never clamped. */
const DEFAULT_PROJECT_RESPONSE = Object.freeze({
  ok: true,
  body: JSON.stringify({ project: { history_retention_seconds: 24 * 60 * 60 } }),
});

/**
 * `responses` is an ordered queue for the branch lifecycle (create → poll →
 * delete). The project lookup `main` does first is ambient setup — it exists
 * only to read the retention window — so it is served from its own slot and
 * recorded in `projectCalls`, leaving the queue and every index assertion
 * built on it about the branch lifecycle alone. Tests that care about the
 * lookup pass a `project` override and assert on `projectCalls`.
 */
function makeFetch(responses, { project = DEFAULT_PROJECT_RESPONSE } = {}) {
  const calls = [];
  const projectCalls = [];
  const fetchFn = async (url, init) => {
    if ((init?.method ?? 'GET') === 'GET' && /\/projects\/[^/]+$/.test(url)) {
      projectCalls.push({ url, init });
      return {
        ok: project.ok,
        status: project.status ?? (project.ok ? 200 : 500),
        statusText: project.statusText ?? '',
        text: async () => project.body ?? '',
      };
    }
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
  return { fetchFn, calls, projectCalls };
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

describe('parseRetentionSeconds', () => {
  test('reads a positive window', () => {
    assert.equal(parseRetentionSeconds({ project: { history_retention_seconds: 21600 } }), 21600);
  });

  test('an absent window is null, NOT zero', () => {
    // Zero would clamp every lookback to 0h and turn a missing field into a
    // guaranteed failure. Null means "do not clamp".
    assert.equal(parseRetentionSeconds({ project: {} }), null);
    assert.equal(parseRetentionSeconds({}), null);
    assert.equal(parseRetentionSeconds(null), null);
  });

  test('a non-numeric or non-positive window is null', () => {
    assert.equal(parseRetentionSeconds({ project: { history_retention_seconds: '21600' } }), null);
    assert.equal(parseRetentionSeconds({ project: { history_retention_seconds: 0 } }), null);
    assert.equal(parseRetentionSeconds({ project: { history_retention_seconds: -1 } }), null);
    assert.equal(parseRetentionSeconds({ project: { history_retention_seconds: NaN } }), null);
  });
});

describe('resolveLookbackHours', () => {
  test('a lookback inside the window is used unchanged', () => {
    assert.equal(resolveLookbackHours({ requestedHours: '4', retentionSeconds: 21600 }), 4);
  });

  test('a lookback beyond the window is clamped, not passed through', () => {
    // The live case: 24h requested against a 6h plan. Neon rejected this with
    // 400 every month, which classifyHttpStatus files as a PITR fault.
    const lines = [];
    const got = resolveLookbackHours({
      requestedHours: '24',
      retentionSeconds: 6 * 60 * 60,
      log: m => lines.push(m),
    });
    assert.equal(got, 6 * RETENTION_SAFETY_MARGIN);
    assert.ok(got < 6, 'must stay clear of the trailing edge');
    assert.equal(lines.length, 1, 'the clamp is never silent');
    assert.match(lines[0], /exceeds/);
    assert.match(lines[0], /not a backup fault/);
  });

  test('an unreported window leaves the request unclamped', () => {
    const lines = [];
    assert.equal(
      resolveLookbackHours({ requestedHours: '24', retentionSeconds: null, log: m => lines.push(m) }),
      24,
    );
    assert.equal(lines.length, 1);
  });

  test('a lookback exactly at the window is still clamped clear of the edge', () => {
    // The window slides while the create request is in flight, so asking for
    // exactly `retention` races the boundary.
    const got = resolveLookbackHours({ requestedHours: '6', retentionSeconds: 6 * 60 * 60 });
    assert.ok(got < 6);
    assert.equal(got, 6 * RETENTION_SAFETY_MARGIN);
  });

  test('a non-numeric lookback is a config fault, not a clamp', () => {
    assert.throws(
      () => resolveLookbackHours({ requestedHours: 'soon', retentionSeconds: 21600 }),
      err => err.failureClass === 'config' && err.exitCode === 2,
    );
  });

  test('a zero or negative lookback is a config fault', () => {
    for (const bad of ['0', '-3']) {
      assert.throws(
        () => resolveLookbackHours({ requestedHours: bad, retentionSeconds: 21600 }),
        err => err.failureClass === 'config',
      );
    }
  });
});

/** A spawnFn whose child exits with `code`. */
function okSpawn(code) {
  return () => {
    const listeners = {};
    const child = {
      on: (event, fn) => {
        listeners[event] = fn;
        return child;
      },
    };
    setImmediate(() => listeners.exit?.(code));
    return child;
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

  test('deletes branch when parseCreateResponse throws (missing connection_uris)', async () => {
    const createBody = JSON.stringify({
      branch: { id: 'br_leak' },
      operations: [{ id: 'op_1' }],
    });
    const { fetchFn, calls } = makeFetch([
      { ok: true, body: createBody },
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
      (err) => err instanceof PitrError && err.message.includes('connection_uri'),
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[1].init.method, 'DELETE');
    assert.match(calls[1].url, /\/branches\/br_leak$/);
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

  test('the restore point is clamped to the project retention window', async () => {
    // End to end for the live failure: HOURS_AGO=24 against a 6h plan. Before
    // the clamp this reached Neon as a 24h-old timestamp and came back 400
    // "timestamp is before retention window", classified as a PITR fault.
    const createBody = JSON.stringify({
      branch: { id: 'br_clamp' },
      connection_uris: [{ connection_uri: 'postgres://host/db' }],
      operations: [],
    });
    const { fetchFn, calls, projectCalls } = makeFetch(
      [{ ok: true, body: createBody }, { ok: true, body: '{}' }],
      { project: { ok: true, body: JSON.stringify({ project: { history_retention_seconds: 6 * 60 * 60 } }) } },
    );
    const nowMs = Date.parse('2026-09-01T12:00:00Z');
    await main({
      env: { NEON_API_KEY: 'k', NEON_PROJECT_ID: 'proj_test', HOURS_AGO: '24' },
      fetchFn,
      spawnFn: okSpawn(0),
      sleepFn: async () => {},
      now: () => nowMs,
      log: () => {},
      scriptPath: 's.sh',
    });

    assert.equal(projectCalls.length, 1, 'the retention window is read exactly once');
    assert.match(projectCalls[0].url, /\/projects\/proj_test$/);

    const sent = Date.parse(JSON.parse(calls[0].init.body).branch.parent_timestamp);
    const hoursBack = (nowMs - sent) / 3600000;
    assert.ok(hoursBack < 6, `restore point must be inside the 6h window, got ${hoursBack}h`);
    assert.ok(hoursBack > 5, `and should use most of it, got ${hoursBack}h`);
  });

  test('a 404 on the project lookup is a config fault, before any branch is made', async () => {
    // The #9036 case surfaces here now rather than as a 400 on branch create,
    // which classifyHttpStatus would have filed as a PITR fault.
    const { fetchFn, calls } = makeFetch([], {
      project: { ok: false, status: 404, statusText: 'Not Found', body: '{"message":"project not found"}' },
    });
    await assert.rejects(
      main({
        env: { NEON_API_KEY: 'k', NEON_PROJECT_ID: 'proj_gone', HOURS_AGO: '4' },
        fetchFn,
        spawnFn: okSpawn(0),
        sleepFn: async () => {},
        now: () => Date.now(),
        log: () => {},
        scriptPath: 's.sh',
      }),
      err => err.failureClass === 'config',
    );
    assert.equal(calls.length, 0, 'no branch may be created against an unresolvable project');
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

// --- Failure classification -------------------------------------------------
// The exit code says where we stopped; the class says whose problem it is.
// These are the assertions that stop a stale NEON_PROJECT_ID from being
// reported as a data-loss event.

function makeSpawn(exitCode) {
  return () => {
    const listeners = {};
    const child = {
      on: (event, fn) => {
        listeners[event] = fn;
        return child;
      },
    };
    setImmediate(() => listeners.exit?.(exitCode));
    return child;
  };
}

const NEVER_SPAWN = () => {
  throw new Error('verification script must not run');
};

describe('classifyHttpStatus', () => {
  test('401 is a configuration fault (bad credential)', () => {
    assert.equal(classifyHttpStatus(401), FAILURE_CLASS.CONFIG);
  });

  test('403 is a configuration fault (insufficient scope)', () => {
    assert.equal(classifyHttpStatus(403), FAILURE_CLASS.CONFIG);
  });

  test('404 is a configuration fault, NOT a PITR fault', () => {
    assert.equal(classifyHttpStatus(404), FAILURE_CLASS.CONFIG);
    assert.notEqual(classifyHttpStatus(404), FAILURE_CLASS.PITR);
  });

  test('400 is a PITR fault (the restore request itself was rejected)', () => {
    assert.equal(classifyHttpStatus(400), FAILURE_CLASS.PITR);
  });

  test('422 is a PITR fault', () => {
    assert.equal(classifyHttpStatus(422), FAILURE_CLASS.PITR);
  });

  test('408 is infrastructure/transient', () => {
    assert.equal(classifyHttpStatus(408), FAILURE_CLASS.INFRA);
  });

  test('429 is infrastructure/transient', () => {
    assert.equal(classifyHttpStatus(429), FAILURE_CLASS.INFRA);
  });

  test('every 5xx is infrastructure/transient', () => {
    for (const status of [500, 502, 503, 504, 599]) {
      assert.equal(classifyHttpStatus(status), FAILURE_CLASS.INFRA, `status ${status}`);
    }
  });

  test('an unmapped status is unknown, never silently transient', () => {
    assert.equal(classifyHttpStatus(418), FAILURE_CLASS.UNKNOWN);
    assert.equal(classifyHttpStatus(undefined), FAILURE_CLASS.UNKNOWN);
  });
});

describe('PitrError', () => {
  test('carries the class it was constructed with', () => {
    const e = new PitrError('boom', 3, FAILURE_CLASS.PITR);
    assert.equal(e.failureClass, FAILURE_CLASS.PITR);
    assert.equal(e.exitCode, 3);
  });

  test('defaults to unknown rather than guessing a class', () => {
    assert.equal(new PitrError('boom', 3).failureClass, FAILURE_CLASS.UNKNOWN);
  });
});

describe('classifyError', () => {
  test('reads the class off a PitrError', () => {
    assert.equal(classifyError(new PitrError('x', 2, FAILURE_CLASS.CONFIG)), FAILURE_CLASS.CONFIG);
  });

  test('a plain Error is unknown, not pitr', () => {
    assert.equal(classifyError(new Error('kaboom')), FAILURE_CLASS.UNKNOWN);
  });

  test('an out-of-vocabulary class is rejected', () => {
    const e = new PitrError('x', 3, 'made-up');
    assert.equal(classifyError(e), FAILURE_CLASS.UNKNOWN);
  });
});

describe('classifyOutcome', () => {
  test('success has no failure class', () => {
    assert.equal(classifyOutcome({ exitCode: 0 }), null);
  });

  test('exit 1 means the recovered data was bad — a PITR fault', () => {
    assert.equal(classifyOutcome({ exitCode: 1 }), FAILURE_CLASS.PITR);
  });

  test('an internal script bug (exit 5) is unknown, not a PITR fault', () => {
    assert.equal(classifyOutcome({ exitCode: 5, error: new Error('bug') }), FAILURE_CLASS.UNKNOWN);
  });

  test('the error class wins over the exit code', () => {
    const outcome = classifyOutcome({
      exitCode: 3,
      error: new PitrError('404', 3, FAILURE_CLASS.CONFIG),
    });
    assert.equal(outcome, FAILURE_CLASS.CONFIG);
  });
});

describe('writeFailureClass', () => {
  test('appends the class in GITHUB_OUTPUT key=value form', () => {
    const writes = [];
    const ok = writeFailureClass({
      env: { GITHUB_OUTPUT: '/tmp/out' },
      appendFileFn: (p, data) => writes.push([p, data]),
      failureClass: FAILURE_CLASS.CONFIG,
    });
    assert.equal(ok, true);
    assert.deepEqual(writes, [['/tmp/out', 'failure_class=config\n']]);
  });

  test('is a no-op outside Actions (no GITHUB_OUTPUT)', () => {
    const ok = writeFailureClass({
      env: {},
      appendFileFn: () => assert.fail('must not write'),
      failureClass: FAILURE_CLASS.CONFIG,
    });
    assert.equal(ok, false);
  });

  test('refuses to emit a class outside the vocabulary', () => {
    const ok = writeFailureClass({
      env: { GITHUB_OUTPUT: '/tmp/out' },
      appendFileFn: () => assert.fail('must not write'),
      failureClass: 'made-up',
    });
    assert.equal(ok, false);
  });

  test('a write failure is logged, not thrown — reporting must not mask the failure', () => {
    const logs = [];
    const ok = writeFailureClass({
      env: { GITHUB_OUTPUT: '/tmp/out' },
      appendFileFn: () => {
        throw new Error('EACCES');
      },
      failureClass: FAILURE_CLASS.INFRA,
      log: m => logs.push(m),
    });
    assert.equal(ok, false);
    assert.match(logs[0], /EACCES/);
  });

  test('every class in the vocabulary is writable', () => {
    for (const cls of FAILURE_CLASSES) {
      const writes = [];
      writeFailureClass({
        env: { GITHUB_OUTPUT: '/tmp/out' },
        appendFileFn: (p, d) => writes.push(d),
        failureClass: cls,
      });
      assert.deepEqual(writes, [`failure_class=${cls}\n`]);
    }
  });
});

describe('main — failure classification', () => {
  const baseArgs = {
    sleepFn: async () => {},
    now: () => Date.parse('2026-04-11T12:00:00Z'),
    log: () => {},
    scriptPath: '/tmp/verify.sh',
  };

  test('a missing NEON_API_KEY is a configuration fault', async () => {
    await assert.rejects(
      main({ ...baseArgs, env: makeEnv({ NEON_API_KEY: undefined }), fetchFn: async () => {}, spawnFn: NEVER_SPAWN }),
      e => e.failureClass === FAILURE_CLASS.CONFIG && e.exitCode === 2,
    );
  });

  test('a missing NEON_PROJECT_ID is a configuration fault', async () => {
    await assert.rejects(
      main({ ...baseArgs, env: makeEnv({ NEON_PROJECT_ID: undefined }), fetchFn: async () => {}, spawnFn: NEVER_SPAWN }),
      e => e.failureClass === FAILURE_CLASS.CONFIG && e.exitCode === 2,
    );
  });

  test('an invalid HOURS_AGO is a configuration fault', async () => {
    await assert.rejects(
      main({ ...baseArgs, env: makeEnv({ HOURS_AGO: 'abc' }), fetchFn: async () => {}, spawnFn: NEVER_SPAWN }),
      e => e.failureClass === FAILURE_CLASS.CONFIG,
    );
  });

  test('the live 404 "project not found" is a configuration fault, NOT a data-recovery event', async () => {
    const { fetchFn } = makeFetch([
      {
        ok: false,
        status: 404,
        statusText: 'Not Found',
        body: '{"code":"","message":"project not found"}',
      },
    ]);
    await assert.rejects(
      main({ ...baseArgs, env: makeEnv(), fetchFn, spawnFn: NEVER_SPAWN }),
      e => {
        assert.equal(e.failureClass, FAILURE_CLASS.CONFIG);
        assert.notEqual(e.failureClass, FAILURE_CLASS.PITR);
        assert.equal(classifyOutcome({ exitCode: e.exitCode, error: e }), FAILURE_CLASS.CONFIG);
        return true;
      },
    );
  });

  test('a 401 from the Neon API is a configuration fault', async () => {
    const { fetchFn } = makeFetch([{ ok: false, status: 401, statusText: 'Unauthorized', body: '{}' }]);
    await assert.rejects(
      main({ ...baseArgs, env: makeEnv(), fetchFn, spawnFn: NEVER_SPAWN }),
      e => e.failureClass === FAILURE_CLASS.CONFIG,
    );
  });

  test('a 503 from the Neon API is infrastructure, not configuration', async () => {
    const { fetchFn } = makeFetch([{ ok: false, status: 503, statusText: 'Service Unavailable', body: '{}' }]);
    await assert.rejects(
      main({ ...baseArgs, env: makeEnv(), fetchFn, spawnFn: NEVER_SPAWN }),
      e => e.failureClass === FAILURE_CLASS.INFRA,
    );
  });

  test('a failed restore operation IS a PITR fault', async () => {
    const createBody = JSON.stringify({
      branch: { id: 'br_new' },
      connection_uris: [{ connection_uri: 'postgres://host/db' }],
      operations: [{ id: 'op_1' }],
    });
    const { fetchFn } = makeFetch([
      { ok: true, body: createBody },
      { ok: true, body: JSON.stringify({ operation: { status: 'failed' } }) },
      { ok: true, body: '{}' },
    ]);
    await assert.rejects(
      main({ ...baseArgs, env: makeEnv(), fetchFn, spawnFn: NEVER_SPAWN }),
      e => {
        assert.equal(e.failureClass, FAILURE_CLASS.PITR);
        assert.notEqual(e.failureClass, FAILURE_CLASS.CONFIG);
        return true;
      },
    );
  });

  test('a restore that never finishes is infrastructure/transient', async () => {
    const createBody = JSON.stringify({
      branch: { id: 'br_new' },
      connection_uris: [{ connection_uri: 'postgres://host/db' }],
      operations: [{ id: 'op_1' }],
    });
    let clock = 0;
    const responses = [{ ok: true, body: createBody }];
    for (let i = 0; i < 200; i += 1) {
      responses.push({ ok: true, body: JSON.stringify({ operation: { status: 'running' } }) });
    }
    responses.push({ ok: true, body: '{}' });
    const { fetchFn } = makeFetch(responses);
    await assert.rejects(
      main({
        ...baseArgs,
        env: makeEnv(),
        fetchFn,
        spawnFn: NEVER_SPAWN,
        now: () => {
          clock += 60_000;
          return clock;
        },
      }),
      e => e.failureClass === FAILURE_CLASS.INFRA && e.exitCode === 4,
    );
  });

  test('bad recovered data returns exit 1, which classifies as a PITR fault', async () => {
    const createBody = JSON.stringify({
      branch: { id: 'br_new' },
      connection_uris: [{ connection_uri: 'postgres://host/db' }],
      operations: [],
    });
    const { fetchFn } = makeFetch([
      { ok: true, body: createBody },
      { ok: true, body: '{}' },
    ]);
    const code = await main({
      ...baseArgs,
      env: makeEnv(),
      fetchFn,
      spawnFn: makeSpawn(1),
    });
    assert.equal(code, 1);
    assert.equal(classifyOutcome({ exitCode: code }), FAILURE_CLASS.PITR);
  });

  test('a successful run has no failure class at all', async () => {
    const createBody = JSON.stringify({
      branch: { id: 'br_new' },
      connection_uris: [{ connection_uri: 'postgres://host/db' }],
      operations: [],
    });
    const { fetchFn } = makeFetch([
      { ok: true, body: createBody },
      { ok: true, body: '{}' },
    ]);
    const code = await main({ ...baseArgs, env: makeEnv(), fetchFn, spawnFn: makeSpawn(0) });
    assert.equal(code, 0);
    assert.equal(classifyOutcome({ exitCode: code }), null);
  });
});
