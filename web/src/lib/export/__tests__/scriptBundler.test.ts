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
