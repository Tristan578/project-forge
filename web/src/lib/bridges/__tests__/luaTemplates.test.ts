// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('server-only', () => ({}));
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
      // Allowlist rejects before checking filesystem
      expect(() => luaTemplates.getTemplate('nonexistent')).toThrow('Unknown bridge template');
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
    it('rejects Lua injection patterns in params', () => {
      const malicious = 'os.execute("rm -rf /")';
      expect(() =>
        luaTemplates.renderTemplate('local name = "{{name}}"', { name: malicious })
      ).toThrow('Unsafe parameter value');
    });

    it('rejects params exceeding max length', () => {
      const longValue = 'x'.repeat(1001);
      expect(() =>
        luaTemplates.renderTemplate('local x = "{{val}}"', { val: longValue })
      ).toThrow('exceeds maximum length');
    });

    it('allows safe string params', () => {
      const result = luaTemplates.renderTemplate(
        'local name = "{{name}}"',
        { name: 'knight_walk_cycle' }
      );
      expect(result).toBe('local name = "knight_walk_cycle"');
    });

    it('blocks path traversal in template names', () => {
      expect(() => luaTemplates.getTemplate('../../../etc/passwd')).toThrow('Unknown bridge template');
    });

    it('validates numeric params are integers in range', () => {
      expect(() =>
        luaTemplates.renderTemplate('local w = {{width}}', { width: '64' })
      ).not.toThrow();

      expect(() =>
        luaTemplates.renderTemplate('local w = {{width}}', { width: '1; os.execute("bad")' })
      ).toThrow('must be an integer');
    });

    it('rejects non-integer numeric params', () => {
      expect(() =>
        luaTemplates.renderTemplate('local w = {{width}}', { width: 'abc' })
      ).toThrow('must be an integer');
    });

    it('rejects out-of-range numeric params', () => {
      expect(() =>
        luaTemplates.renderTemplate('local w = {{width}}', { width: '-1' })
      ).toThrow('must be an integer');

      expect(() =>
        luaTemplates.renderTemplate('local w = {{width}}', { width: '100000' })
      ).toThrow('must be an integer');
    });

    it('rejects semicolons in string params', () => {
      expect(() =>
        luaTemplates.renderTemplate('local x = "{{name}}"', { name: 'a; b' })
      ).toThrow('contains semicolons');
    });
  });
});
