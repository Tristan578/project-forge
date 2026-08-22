import { describe, it, expect } from 'vitest';
import { bundleScripts } from '../scriptBundler';
import { SHADOWED_GLOBALS } from '@/lib/scripting/sandboxGlobals';
import type { ScriptData } from '@/stores/editorStore';

function makeScript(source: string, enabled = true): ScriptData {
  return { source, enabled };
}

describe('bundleScripts', () => {
  it('returns empty code and count 0 for empty scripts record', () => {
    const result = bundleScripts({});
    expect(result.code).toBe('');
    expect(result.count).toBe(0);
  });

  it('returns empty code when all scripts are disabled', () => {
    const result = bundleScripts({
      'entity-1': makeScript('function onStart() {}', false),
      'entity-2': makeScript('function onUpdate(dt) {}', false),
    });
    expect(result.code).toBe('');
    expect(result.count).toBe(0);
  });

  it('bundles a single enabled script', () => {
    const result = bundleScripts({
      'entity-1': makeScript('function onStart() { forge.log("hello"); }'),
    });
    expect(result.count).toBe(1);
    expect(result.code).toContain('entity-1');
    expect(result.code).toContain('forge.log');
  });

  it('skips disabled scripts while including enabled ones', () => {
    const result = bundleScripts({
      'enabled-entity': makeScript('function onStart() {}'),
      'disabled-entity': makeScript('function onStart() {}', false),
    });
    expect(result.count).toBe(1);
    expect(result.code).toContain('enabled-entity');
    expect(result.code).not.toContain('disabled-entity');
  });

  it('bundles multiple enabled scripts', () => {
    const result = bundleScripts({
      'e1': makeScript('function onStart() {}'),
      'e2': makeScript('function onUpdate(dt) {}'),
      'e3': makeScript('function onDestroy() {}'),
    });
    expect(result.count).toBe(3);
    expect(result.code).toContain('e1');
    expect(result.code).toContain('e2');
    expect(result.code).toContain('e3');
  });

  it('wraps each script in a closure with its entity ID', () => {
    const result = bundleScripts({
      'my-entity': makeScript('function onStart() {}'),
    });
    expect(result.code).toContain('scripts["my-entity"]');
    expect(result.code).toContain('(function(forge)');
  });

  it('includes the minimal forge API runtime', () => {
    const result = bundleScripts({
      'e1': makeScript('function onStart() {}'),
    });
    // Core forge API object properties (defined inside const forge = { ... })
    expect(result.code).toContain('log: function');
    expect(result.code).toContain('input:');
    expect(result.code).toContain('audio:');
    expect(result.code).toContain('physics:');
    expect(result.code).toContain('getTransform: function');
    expect(result.code).toContain('setPosition: function');
    expect(result.code).toContain('state:');
  });

  it('includes lifecycle management functions', () => {
    const result = bundleScripts({
      'e1': makeScript('function onStart() {}'),
    });
    expect(result.code).toContain('__forgeScriptStart');
    expect(result.code).toContain('__forgeScriptUpdate');
    expect(result.code).toContain('__forgeScriptDestroy');
    expect(result.code).toContain('__forgeFlushCommands');
  });

  it('JSON-encodes script source to prevent closure breakout', () => {
    const malicious = 'function onStart() { }); alert("xss"); (function() { }';
    const result = bundleScripts({
      'e1': makeScript(malicious),
    });
    // The source should be JSON.stringify'd — which escapes the closing paren
    expect(result.code).toContain(JSON.stringify(malicious));
    // The raw malicious string should NOT appear unescaped
    expect(result.code).not.toContain('); alert("xss"); (function()');
  });

  it('handles script source with special characters', () => {
    const source = 'function onStart() { forge.log("line1\\nline2"); }';
    const result = bundleScripts({
      'e1': makeScript(source),
    });
    expect(result.count).toBe(1);
    // Should not throw during bundling
    expect(result.code.length).toBeGreaterThan(0);
  });

  it('handles entity IDs with single quotes without breaking JS syntax', () => {
    // Entity IDs with single quotes appear in scripts['entityId'] — if unescaped,
    // the quote breaks out of the string literal. This test verifies the bundled
    // JS is syntactically valid even with adversarial entity IDs.
    const result = bundleScripts({
      "entity-with-'quotes": makeScript('function onStart() {}'),
    });
    expect(result.count).toBe(1);
    // The bundled JS must be parseable — if the quote breaks syntax, Function() throws
    // Using Function constructor intentionally to test JS syntax validity
    expect(() => new Function(result.code)).not.toThrow();
  });

  it('wraps bundle in an IIFE', () => {
    const result = bundleScripts({
      'e1': makeScript('function onStart() {}'),
    });
    // Should be a self-executing function to avoid global pollution
    expect(result.code).toContain('(function()');
    expect(result.code.trimEnd()).toMatch(/\}\)\(\);?\s*$/);
  });

  it('includes pendingCommands array for command queuing', () => {
    const result = bundleScripts({
      'e1': makeScript('function onStart() {}'),
    });
    expect(result.code).toContain('pendingCommands');
    expect(result.code).toContain('pendingCommands.push');
  });

  it('includes all SHADOWED_GLOBALS as parameters in the inner Function constructor call', () => {
    const result = bundleScripts({
      'e1': makeScript('function onStart() {}'),
    });
    // Every global from the shared list must appear as a string argument to new Function(...)
    // so that the exported script sandbox matches the worker sandbox.
    for (const global of SHADOWED_GLOBALS) {
      expect(result.code).toContain(JSON.stringify(global));
    }
  });

  it('passes undefined for all shadowed globals when calling the compiled function', () => {
    const result = bundleScripts({
      'e1': makeScript('function onStart() {}'),
    });
    // The call site must pass the correct number of undefined arguments.
    // Count occurrences of ', undefined' after the __resetGuards argument.
    // There should be exactly SHADOWED_GLOBALS.length of them.
    const undefinedArgs = (result.code.match(/\bundefined\b/g) || []).length;
    expect(undefinedArgs).toBeGreaterThanOrEqual(SHADOWED_GLOBALS.length);
  });
});

/**
 * `forge.physics.isGrounded` in an EXPORTED game (PF-1214, review finding #7).
 *
 * The editor's script worker answers this from a grounded map the engine feeds
 * it; the export bundle is a separate, hand-written shim, so an API that works
 * in the editor and is simply absent from the export is invisible until a
 * creator ships a jump that never lands. These cases RUN the generated bundle
 * against a fake `window` rather than matching its text, because the thing
 * under test is which global the shim reads.
 */
describe('forge.physics.isGrounded in the exported bundle', () => {
  type FakeWindow = Record<string, unknown>;

  /**
   * Runs the bundle with a single script that reports what
   * `forge.physics.isGrounded` answered for each id it was asked about.
   *
   * The answer travels out on the bundle's OWN command queue — the script
   * encodes `typeof v + ':' + String(v)` as an entity id and
   * `window.__forgeFlushCommands()` hands it back. That channel is used instead
   * of a side global because `window` is a shadowed name inside the sandbox
   * (see `sandboxGlobals.ts`), so a script cannot write one — and it pins the
   * TYPE as well as the value, which a truthiness assertion would not.
   *
   * The bundle itself references a bare `window`, which is how it runs in the
   * exported page; passing it as a parameter is what lets this suite stay in
   * the node environment.
   */
  function runBundle(ids: string[]): {
    win: FakeWindow;
    probe: () => Record<string, string>;
  } {
    const { code } = bundleScripts({
      'probe-entity': makeScript(
        `function onUpdate(dt) {
${ids
  .map(
    (id) =>
      `           var v_${id} = forge.physics.isGrounded(${JSON.stringify(id)});\n` +
      `           forge.physics.applyForce(${JSON.stringify(id)} + '=' + (typeof v_${id}) + ':' + String(v_${id}), 0, 0, 0);`,
  )
  .join('\n')}
         }`,
      ),
    });

    const win: FakeWindow = {};
    new Function('window', code)(win);

    return {
      win,
      probe: () => {
        (win['__forgeScriptUpdate'] as (dt: number) => void)(0.016);
        const cmds = (win['__forgeFlushCommands'] as () => Array<{ entityId: string }>)();
        const out: Record<string, string> = {};
        for (const c of cmds) {
          const [id, answer] = c.entityId.split('=');
          out[id!] = answer!;
        }
        return out;
      },
    };
  }

  it('reads the grounded state the runtime mirrored from the engine', () => {
    const { win, probe } = runBundle(['player']);
    win['__forgeGrounded'] = { player: true };
    expect(probe()['player']).toBe('boolean:true');
  });

  it('answers false once the entity leaves the ground', () => {
    const { win, probe } = runBundle(['player']);
    win['__forgeGrounded'] = { player: true };
    expect(probe()['player']).toBe('boolean:true');
    win['__forgeGrounded'] = { player: false };
    expect(probe()['player']).toBe('boolean:false');
  });

  it('answers false for an entity the engine has never reported', () => {
    const { win, probe } = runBundle(['ghost']);
    win['__forgeGrounded'] = { player: true };
    expect(probe()['ghost']).toBe('boolean:false');
  });

  it('answers false before any event has arrived, rather than throwing', () => {
    const { probe } = runBundle(['player']);
    // `__forgeGrounded` is only created when the first
    // CHARACTER_GROUNDED_CHANGED lands, so every script's first frame runs
    // against an absent global.
    expect(probe()['player']).toBe('boolean:false');
  });

  it('returns a real boolean, not the raw stored value', () => {
    const { win, probe } = runBundle(['player']);
    win['__forgeGrounded'] = { player: 'yes' };
    expect(probe()['player']).toBe('boolean:true');
  });
});
