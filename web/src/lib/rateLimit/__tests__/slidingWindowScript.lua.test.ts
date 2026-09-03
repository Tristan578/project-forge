/**
 * Behavioural coverage for the sliding-window Lua script (#8651).
 *
 * `distributed.test.ts` mocks `fetch`, so every assertion there is about the
 * request we *send* to Upstash — the script travels as an opaque string and its
 * arithmetic is never executed. That leaves the part most likely to be wrong
 * untested: the `<` vs `<=` boundary, the `tonumber` coercions on the
 * string-typed ARGV that the REST API delivers, and the claim that the deny
 * path writes nothing.
 *
 * This file runs the *shipped* source — imported, never copied — through a real
 * Lua VM (fengari) against an in-memory Redis double. A mutation to the script
 * therefore fails a test rather than travelling to production unnoticed.
 */
import { describe, it, expect } from 'vitest';
import { lua, lauxlib, lualib, to_luastring, type LuaState } from 'fengari';

import { SLIDING_WINDOW_SCRIPT } from '../distributed';

/** A sorted-set member as Redis stores it. */
interface ZEntry {
  score: number;
  member: string;
}

interface RunOptions {
  existing: ZEntry[];
  windowStart: number;
  limit: number;
  now: number;
  member: string;
  windowSeconds: number;
}

interface RunResult {
  /** First element of the script's return table. */
  allowed: number;
  /** Second element of the script's return table. */
  count: number;
  /**
   * Third element: the oldest in-window score on deny (a NUMBER — the script
   * must `tonumber()` the string Redis returns), `null` on allow.
   */
  oldest: number | string | null;
  zaddCalled: boolean;
  expireCalls: number;
  /**
   * The ZADD score and EXPIRE TTL exactly as Lua handed them to the double —
   * NOT normalised. The script wraps both in `tonumber()`, and a JS-side
   * `Number()` here would launder a dropped coercion into a passing test.
   */
  zaddScoreRaw: string | number | null;
  expireTtlRaw: string | number | null;
  /** Sorted-set contents after the script ran. */
  finalMembers: ZEntry[];
  /** Members dropped by ZREMRANGEBYSCORE. */
  removedByWindow: ZEntry[];
  /** Any command the double did not expect — must always be empty. */
  unexpectedCommands: string[];
}

const KEY = '@spawnforge/ratelimit:test-key';

/**
 * Executes `SLIDING_WINDOW_SCRIPT` in a fresh Lua state.
 *
 * KEYS/ARGV are bound as globals because the script has no enclosing
 * `function(...)` — that is how Redis presents them to an EVAL body. Every ARGV
 * entry is pushed as a *string*, matching the Upstash REST transport, so the
 * script's `tonumber()` calls are genuinely exercised rather than bypassed by a
 * value that was already numeric.
 */
function runScript(opts: RunOptions): RunResult {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  const zset: ZEntry[] = opts.existing.map((e) => ({ ...e }));
  const removedByWindow: ZEntry[] = [];
  const unexpectedCommands: string[] = [];
  let zaddCalled = false;
  let expireCalls = 0;
  let zaddScoreRaw: string | number | null = null;
  let expireTtlRaw: string | number | null = null;

  const redisCall = (S: LuaState): number => {
    const argc = lua.lua_gettop(S);
    const args: Array<string | number> = [];
    for (let i = 1; i <= argc; i += 1) {
      args.push(
        lua.lua_type(S, i) === lua.LUA_TNUMBER
          ? lua.lua_tonumber(S, i)
          : lua.lua_tojsstring(S, i),
      );
    }

    const command = String(args[0]);
    switch (command) {
      case 'ZREMRANGEBYSCORE': {
        // Redis range bounds are inclusive unless prefixed with '(' — the
        // script passes a bare ARGV[1], so an entry scored exactly at
        // windowStart is removed.
        const max = Number(args[3]);
        for (let i = zset.length - 1; i >= 0; i -= 1) {
          if (zset[i].score <= max) removedByWindow.push(...zset.splice(i, 1));
        }
        return 0;
      }
      case 'ZCARD':
        lua.lua_pushinteger(S, zset.length);
        return 1;
      case 'ZADD':
        zaddCalled = true;
        zaddScoreRaw = args[2];
        zset.push({ score: Number(args[2]), member: String(args[3]) });
        return 0;
      case 'EXPIRE':
        expireCalls += 1;
        expireTtlRaw = args[2];
        return 0;
      case 'ZRANGE': {
        // Only the shape the script uses: `ZRANGE key 0 0 WITHSCORES` — the
        // lowest-scored entry as a flat [member, score] array, scores as
        // STRINGS, which is how Redis returns them to Lua.
        if (String(args[2]) !== '0' || String(args[3]) !== '0' || String(args[4]) !== 'WITHSCORES') {
          unexpectedCommands.push(`ZRANGE ${args.slice(2).join(' ')}`);
          return 0;
        }
        const sorted = [...zset].sort((a, b) => a.score - b.score);
        lua.lua_newtable(S);
        if (sorted.length > 0) {
          lua.lua_pushstring(S, to_luastring(sorted[0].member));
          lua.lua_seti(S, -2, 1);
          lua.lua_pushstring(S, to_luastring(String(sorted[0].score)));
          lua.lua_seti(S, -2, 2);
        }
        return 1;
      }
      default:
        unexpectedCommands.push(command);
        return 0;
    }
  };

  lua.lua_createtable(L, 1, 0);
  lua.lua_pushstring(L, to_luastring(KEY));
  lua.lua_seti(L, -2, 1);
  lua.lua_setglobal(L, to_luastring('KEYS'));

  const argv = [
    String(opts.windowStart),
    String(opts.limit),
    String(opts.now),
    opts.member,
    String(opts.windowSeconds),
  ];
  lua.lua_createtable(L, argv.length, 0);
  argv.forEach((value, index) => {
    lua.lua_pushstring(L, to_luastring(value));
    lua.lua_seti(L, -2, index + 1);
  });
  lua.lua_setglobal(L, to_luastring('ARGV'));

  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, redisCall);
  lua.lua_setfield(L, -2, to_luastring('call'));
  lua.lua_setglobal(L, to_luastring('redis'));

  const status = lauxlib.luaL_dostring(L, to_luastring(SLIDING_WINDOW_SCRIPT));
  if (status !== lua.LUA_OK) {
    throw new Error(`Lua execution failed: ${lua.lua_tojsstring(L, -1)}`);
  }

  const top = lua.lua_gettop(L);
  if (lua.lua_type(L, top) !== lua.LUA_TTABLE) {
    throw new Error('script did not return a table');
  }

  lua.lua_geti(L, top, 1);
  const allowed = lua.lua_tointeger(L, -1);
  lua.lua_pop(L, 1);

  lua.lua_geti(L, top, 2);
  const count = lua.lua_tointeger(L, -1);
  lua.lua_pop(L, 1);

  // Third element: the oldest in-window score on the deny branch, absent on
  // allow. Read raw so a script that returned the string Redis handed it (or
  // nil) is visible as such rather than laundered by a JS-side Number().
  lua.lua_geti(L, top, 3);
  const oldestType = lua.lua_type(L, -1);
  const oldest: number | string | null =
    oldestType === lua.LUA_TNUMBER
      ? lua.lua_tonumber(L, -1)
      : oldestType === lua.LUA_TNIL
        ? null
        : lua.lua_tojsstring(L, -1);
  lua.lua_pop(L, 1);

  return {
    allowed,
    count,
    oldest,
    zaddCalled,
    expireCalls,
    zaddScoreRaw,
    expireTtlRaw,
    finalMembers: zset,
    removedByWindow,
    unexpectedCommands,
  };
}

/** Builds `n` entries all scored inside the window. */
function entriesInWindow(n: number, baseScore: number): ZEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    score: baseScore + i,
    member: `existing-${i}`,
  }));
}

describe('SLIDING_WINDOW_SCRIPT — executed in a real Lua VM', () => {
  const WINDOW_START = 1_000;
  const NOW = 2_000;
  const WINDOW_SECONDS = 60;

  it('allows and records the request when the window is below the limit', () => {
    const result = runScript({
      existing: entriesInWindow(3, 1_500),
      windowStart: WINDOW_START,
      limit: 10,
      now: NOW,
      member: 'new-member',
      windowSeconds: WINDOW_SECONDS,
    });

    expect(result.unexpectedCommands).toEqual([]);
    expect(result.allowed).toBe(1);
    expect(result.count).toBe(4);
    // Nothing to wait for on allow, so no oldest score is reported.
    expect(result.oldest).toBeNull();
    expect(result.zaddCalled).toBe(true);
    expect(result.expireCalls).toBe(1);
    expect(result.finalMembers).toHaveLength(4);
    expect(result.finalMembers.at(-1)).toEqual({ score: NOW, member: 'new-member' });
  });

  /**
   * The boundary the script gets right with `<` and would get wrong with `<=`:
   * at exactly the limit the request must be denied. A `<=` would allow an
   * eleventh request through a limit of ten.
   */
  it('denies at exactly the limit and writes no phantom entry', () => {
    const result = runScript({
      existing: entriesInWindow(5, 1_500),
      windowStart: WINDOW_START,
      limit: 5,
      now: NOW,
      member: 'should-not-be-written',
      windowSeconds: WINDOW_SECONDS,
    });

    expect(result.unexpectedCommands).toEqual([]);
    expect(result.allowed).toBe(0);
    expect(result.count).toBe(5);
    // The deny branch reports WHEN the window reopens: the oldest in-window
    // score, coerced to a number (Redis hands Lua a string). The caller turns
    // it into the wait the user is shown, so a stale or string-typed value
    // here becomes a wrong sentence in a toast.
    expect(result.oldest).toBe(1_500);
    expect(typeof result.oldest).toBe('number');
    expect(result.zaddCalled).toBe(false);
    // The deny path still refreshes the TTL, so a saturated key cannot become
    // immortal or expire early.
    expect(result.expireCalls).toBe(1);
    expect(result.finalMembers).toHaveLength(5);
    expect(result.finalMembers.map((e) => e.member)).not.toContain('should-not-be-written');
  });

  it('allows the last request under the limit', () => {
    const result = runScript({
      existing: entriesInWindow(4, 1_500),
      windowStart: WINDOW_START,
      limit: 5,
      now: NOW,
      member: 'fifth',
      windowSeconds: WINDOW_SECONDS,
    });

    expect(result.unexpectedCommands).toEqual([]);
    expect(result.allowed).toBe(1);
    expect(result.count).toBe(5);
    expect(result.zaddCalled).toBe(true);
    expect(result.finalMembers).toHaveLength(5);
  });

  /**
   * Expiry runs before the count is taken, which is what makes the window
   * sliding rather than fixed. The `windowStart` entry is included in the proof
   * because the script passes a bare `ARGV[1]` as the range max, and Redis
   * treats an unprefixed bound as inclusive.
   */
  it('evicts entries at or below windowStart before counting', () => {
    const result = runScript({
      existing: [
        { score: 500, member: 'stale' },
        { score: WINDOW_START, member: 'exactly-at-window-start' },
        { score: 1_500, member: 'live-a' },
        { score: 1_800, member: 'live-b' },
      ],
      windowStart: WINDOW_START,
      limit: 3,
      now: NOW,
      member: 'new-member',
      windowSeconds: WINDOW_SECONDS,
    });

    expect(result.unexpectedCommands).toEqual([]);
    expect(result.removedByWindow.map((e) => e.member).sort()).toEqual([
      'exactly-at-window-start',
      'stale',
    ]);
    // Two survivors, so the new request fits under a limit of three.
    expect(result.allowed).toBe(1);
    expect(result.count).toBe(3);
    expect(result.finalMembers.map((e) => e.member)).toEqual([
      'live-a',
      'live-b',
      'new-member',
    ]);
  });

  it('denies when the window is already over the limit', () => {
    const result = runScript({
      existing: entriesInWindow(7, 1_500),
      windowStart: WINDOW_START,
      limit: 5,
      now: NOW,
      member: 'should-not-be-written',
      windowSeconds: WINDOW_SECONDS,
    });

    expect(result.unexpectedCommands).toEqual([]);
    expect(result.allowed).toBe(0);
    expect(result.count).toBe(7);
    expect(result.oldest).toBe(Math.min(...result.finalMembers.map((e) => e.score)));
    expect(result.zaddCalled).toBe(false);
    expect(result.expireCalls).toBe(1);
    expect(result.finalMembers).toHaveLength(7);
  });

  /**
   * Every ARGV arrives from the Upstash REST API as a string, and the script
   * relies on `tonumber()` at three sites. Each fails differently:
   *
   * - `ARGV[2]` (the limit) — `count < ARGV[2]` is a number-vs-string compare,
   *   a hard error in Lua 5.3+, so the whole EVAL aborts.
   * - `ARGV[3]` (the ZADD score) — Redis rejects a non-numeric score, so the
   *   entry is never recorded and the key silently stops accumulating.
   * - `ARGV[5]` (the TTL) — a string TTL is not an error we would notice here,
   *   which is exactly why it is asserted rather than assumed.
   *
   * The last two are checked against the value Lua actually pushed, not a
   * JS-normalised copy — a `Number()` on the way in would hide the defect.
   */
  it('coerces the string-typed ARGV that the REST transport delivers', () => {
    const result = runScript({
      existing: entriesInWindow(2, 1_500),
      windowStart: WINDOW_START,
      limit: 5,
      now: NOW,
      member: 'coercion-check',
      windowSeconds: WINDOW_SECONDS,
    });

    expect(result.allowed).toBe(1);
    expect(result.zaddScoreRaw).toBe(NOW);
    expect(typeof result.zaddScoreRaw).toBe('number');
    expect(result.expireTtlRaw).toBe(WINDOW_SECONDS);
    expect(typeof result.expireTtlRaw).toBe('number');
  });
});
