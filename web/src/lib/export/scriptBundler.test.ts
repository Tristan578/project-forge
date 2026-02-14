import { describe, it, expect } from 'vitest';
import { bundleScripts } from './scriptBundler';
import type { ScriptData } from '@/stores/editorStore';

describe('scriptBundler', () => {
  describe('bundleScripts', () => {
    it('returns empty code and zero count when no scripts provided', () => {
      const result = bundleScripts({});
      expect(result.code).toBe('');
      expect(result.count).toBe(0);
    });

    it('returns empty code and zero count when all scripts are disabled', () => {
      const scripts: Record<string, ScriptData> = {
        entity1: {
          source: 'console.log("test")',
          enabled: false,
          template: null,
        },
        entity2: {
          source: 'console.log("test2")',
          enabled: false,
          template: null,
        },
      };
      const result = bundleScripts(scripts);
      expect(result.code).toBe('');
      expect(result.count).toBe(0);
    });

    it('filters out disabled scripts', () => {
      const scripts: Record<string, ScriptData> = {
        entity1: {
          source: 'console.log("enabled")',
          enabled: true,
          template: null,
        },
        entity2: {
          source: 'console.log("disabled")',
          enabled: false,
          template: null,
        },
        entity3: {
          source: 'console.log("also enabled")',
          enabled: true,
          template: null,
        },
      };
      const result = bundleScripts(scripts);
      expect(result.count).toBe(2);
      expect(result.code).toContain('console.log("enabled")');
      expect(result.code).not.toContain('console.log("disabled")');
      expect(result.code).toContain('console.log("also enabled")');
    });

    it('returns correct count of enabled scripts', () => {
      const scripts: Record<string, ScriptData> = {
        entity1: { source: 'code1', enabled: true, template: null },
        entity2: { source: 'code2', enabled: true, template: null },
        entity3: { source: 'code3', enabled: true, template: null },
      };
      const result = bundleScripts(scripts);
      expect(result.count).toBe(3);
    });

    it('wraps scripts in closures with entity IDs', () => {
      const scripts: Record<string, ScriptData> = {
        entity1: {
          source: 'console.log("test")',
          enabled: true,
          template: null,
        },
      };
      const result = bundleScripts(scripts);
      expect(result.code).toContain("scripts['entity1']");
      expect(result.code).toContain('(function(forge)');
      expect(result.code).toContain('console.log("test")');
      expect(result.code).toContain('onStart');
      expect(result.code).toContain('onUpdate');
      expect(result.code).toContain('onDestroy');
    });

    it('includes forge.* API stubs', () => {
      const scripts: Record<string, ScriptData> = {
        entity1: {
          source: '',
          enabled: true,
          template: null,
        },
      };
      const result = bundleScripts(scripts);
      expect(result.code).toContain('const forge = {');
      expect(result.code).toContain('log: function(msg)');
      expect(result.code).toContain('warn: function(msg)');
      expect(result.code).toContain('error: function(msg)');
      expect(result.code).toContain('state: {');
      expect(result.code).toContain('input: {');
      expect(result.code).toContain('audio: {');
      expect(result.code).toContain('physics: {');
      expect(result.code).toContain('getTransform: function(id)');
      expect(result.code).toContain('setPosition: function(id, x, y, z)');
      expect(result.code).toContain('setRotation: function(id, rx, ry, rz)');
      expect(result.code).toContain('translate: function(id, dx, dy, dz)');
      expect(result.code).toContain('rotate: function(id, drx, dry, drz)');
    });

    it('handles empty source scripts', () => {
      const scripts: Record<string, ScriptData> = {
        entity1: {
          source: '',
          enabled: true,
          template: null,
        },
      };
      const result = bundleScripts(scripts);
      expect(result.count).toBe(1);
      expect(result.code).toContain("scripts['entity1']");
    });

    it('bundles multiple scripts correctly', () => {
      const scripts: Record<string, ScriptData> = {
        entity1: {
          source: 'function onStart() { console.log("1"); }',
          enabled: true,
          template: null,
        },
        entity2: {
          source: 'function onUpdate(dt) { console.log("2"); }',
          enabled: true,
          template: null,
        },
      };
      const result = bundleScripts(scripts);
      expect(result.count).toBe(2);
      expect(result.code).toContain("scripts['entity1']");
      expect(result.code).toContain("scripts['entity2']");
      expect(result.code).toContain('console.log("1")');
      expect(result.code).toContain('console.log("2")');
    });

    it('includes lifecycle dispatch code', () => {
      const scripts: Record<string, ScriptData> = {
        entity1: {
          source: '',
          enabled: true,
          template: null,
        },
      };
      const result = bundleScripts(scripts);
      expect(result.code).toContain('window.__forgeScriptStart');
      expect(result.code).toContain('window.__forgeScriptUpdate');
      expect(result.code).toContain('window.__forgeScriptDestroy');
      expect(result.code).toContain('if (s.onStart) s.onStart()');
      expect(result.code).toContain('if (s.onUpdate) s.onUpdate(dt)');
      expect(result.code).toContain('if (s.onDestroy) s.onDestroy()');
    });

    it('includes command queue and flush mechanism', () => {
      const scripts: Record<string, ScriptData> = {
        entity1: {
          source: '',
          enabled: true,
          template: null,
        },
      };
      const result = bundleScripts(scripts);
      expect(result.code).toContain('const pendingCommands = []');
      expect(result.code).toContain('window.__forgeFlushCommands');
      expect(result.code).toContain('pendingCommands.splice(0)');
    });

    it('includes error handling in lifecycle methods', () => {
      const scripts: Record<string, ScriptData> = {
        entity1: {
          source: '',
          enabled: true,
          template: null,
        },
      };
      const result = bundleScripts(scripts);
      expect(result.code).toContain('try {');
      expect(result.code).toContain('} catch(e) {');
      expect(result.code).toContain("console.error('[Script ' + id + ']");
    });

    it('includes input state API', () => {
      const scripts: Record<string, ScriptData> = {
        entity1: {
          source: '',
          enabled: true,
          template: null,
        },
      };
      const result = bundleScripts(scripts);
      expect(result.code).toContain('input: {');
      expect(result.code).toContain('isPressed: function(action)');
      expect(result.code).toContain('justPressed: function(action)');
      expect(result.code).toContain('justReleased: function(action)');
      expect(result.code).toContain('getAxis: function(action)');
      expect(result.code).toContain('window.__forgeInputState');
    });

    it('includes audio control API', () => {
      const scripts: Record<string, ScriptData> = {
        entity1: {
          source: '',
          enabled: true,
          template: null,
        },
      };
      const result = bundleScripts(scripts);
      expect(result.code).toContain('audio: {');
      expect(result.code).toContain('play: function(id)');
      expect(result.code).toContain('stop: function(id)');
      expect(result.code).toContain('pause: function(id)');
      expect(result.code).toContain('setVolume: function(id, v)');
      expect(result.code).toContain('setPitch: function(id, p)');
      expect(result.code).toContain('isPlaying: function(id)');
    });

    it('includes physics API', () => {
      const scripts: Record<string, ScriptData> = {
        entity1: {
          source: '',
          enabled: true,
          template: null,
        },
      };
      const result = bundleScripts(scripts);
      expect(result.code).toContain('physics: {');
      expect(result.code).toContain('applyForce: function(id, x, y, z)');
      expect(result.code).toContain('applyImpulse: function(id, x, y, z)');
      expect(result.code).toContain('applyTorque: function(id, x, y, z)');
    });

    it('includes state persistence API', () => {
      const scripts: Record<string, ScriptData> = {
        entity1: {
          source: '',
          enabled: true,
          template: null,
        },
      };
      const result = bundleScripts(scripts);
      expect(result.code).toContain('state: {');
      expect(result.code).toContain('_data: {}');
      expect(result.code).toContain('get: function(key)');
      expect(result.code).toContain('set: function(key, value)');
    });
  });
});
