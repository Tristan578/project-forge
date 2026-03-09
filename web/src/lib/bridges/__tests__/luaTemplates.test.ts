// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
  default: { readFileSync: vi.fn(), existsSync: vi.fn(() => true) },
}));

describe('Lua Templates', () => {
  let luaTemplates: typeof import('../luaTemplates');
  let fs: typeof import('fs');

  beforeAll(async () => {
    fs = await import('fs');
    luaTemplates = await import('../luaTemplates');
  });

  describe('renderTemplate', () => {
    it('replaces {{key}} placeholders with values', () => {
      const result = luaTemplates.renderTemplate(
        'local w = {{width}}\nlocal h = {{height}}',
        { width: '32', height: '32' }
      );
      expect(result).toBe('local w = 32\nlocal h = 32');
    });

    it('JSON-escapes string values for safety', () => {
      const result = luaTemplates.renderTemplate(
        'local name = "{{name}}"',
        { name: 'test"file' }
      );
      expect(result).toBe('local name = "test\\"file"');
    });

    it('leaves unmatched placeholders as empty strings', () => {
      const result = luaTemplates.renderTemplate(
        'local x = {{missing}}',
        {}
      );
      expect(result).toBe('local x = ');
    });

    it('handles numeric values', () => {
      const result = luaTemplates.renderTemplate(
        'local r = {{red}}\nlocal g = {{green}}',
        { red: '255', green: '128' }
      );
      expect(result).toBe('local r = 255\nlocal g = 128');
    });
  });

  describe('getTemplate', () => {
    it('reads template file from disk', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('local spr = Sprite({{width}}, {{height}})');
      const tpl = luaTemplates.getTemplate('createSprite');
      expect(tpl).toContain('Sprite({{width}}');
      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('createSprite.lua'),
        'utf-8'
      );
    });

    it('throws for unknown template', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(false);
      expect(() => luaTemplates.getTemplate('nonexistent')).toThrow();
    });
  });

  describe('buildScript', () => {
    it('reads template and applies params', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('Sprite({{width}}, {{height}})');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const script = luaTemplates.buildScript('createSprite', { width: '64', height: '64' });
      expect(script).toBe('Sprite(64, 64)');
    });
  });

  describe('template safety', () => {
    it('does not allow Lua injection via params', () => {
      const malicious = 'os.execute("rm -rf /")';
      const result = luaTemplates.renderTemplate(
        'local name = "{{name}}"',
        { name: malicious }
      );
      // The value should be escaped, not executable as Lua
      expect(result).not.toContain('os.execute("rm');
    });
  });
});
