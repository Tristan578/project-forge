// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('child_process', () => ({
  execFile: vi.fn(),
  default: { execFile: vi.fn() },
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  default: { existsSync: vi.fn(() => true), readFileSync: vi.fn(), writeFileSync: vi.fn(), mkdirSync: vi.fn(), unlinkSync: vi.fn() },
}));
vi.mock('os', () => ({
  tmpdir: vi.fn(() => '/tmp'),
  homedir: vi.fn(() => '/mock-home'),
  platform: vi.fn(() => 'darwin'),
  default: { tmpdir: vi.fn(() => '/tmp'), homedir: vi.fn(() => '/mock-home'), platform: vi.fn(() => 'darwin') },
}));

import * as asepriteBridge from '../asepriteBridge';
import * as childProcess from 'child_process';
import * as fs from 'fs';

describe('AsepriteBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('executeOperation', () => {
    it('creates sprite via Lua script', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      vi.mocked(fs.readFileSync).mockReturnValue('Sprite({{width}}, {{height}})\nprint("OK:32x32")');

      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'OK:32x32', '');
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const result = await asepriteBridge.executeOperation(
        '/usr/bin/aseprite',
        { name: 'createSprite', params: { width: '32', height: '32' } }
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('OK');
      expect(mockExecFile).toHaveBeenCalledWith(
        '/usr/bin/aseprite',
        expect.arrayContaining(['--batch', '--script']),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('returns error result on Aseprite failure', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid lua');

      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: Error & { code?: number }, stdout: string, stderr: string) => void)(
          Object.assign(new Error('exit code 1'), { code: 1 }),
          '',
          'Script error: line 1'
        );
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const result = await asepriteBridge.executeOperation(
        '/usr/bin/aseprite',
        { name: 'createSprite', params: { width: '32', height: '32' } }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('writes temporary Lua script file', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      const mockWrite = vi.mocked(fs.writeFileSync);
      vi.mocked(fs.readFileSync).mockReturnValue('print("OK")');

      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'OK', '');
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      await asepriteBridge.executeOperation(
        '/usr/bin/aseprite',
        { name: 'createSprite', params: {} }
      );

      expect(mockWrite).toHaveBeenCalledWith(
        expect.stringContaining('.lua'),
        expect.any(String),
        'utf-8'
      );
    });

    it('cleans up temp script after execution', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      const mockUnlink = vi.mocked(fs.unlinkSync);
      vi.mocked(fs.readFileSync).mockReturnValue('print("OK")');

      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'OK', '');
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      await asepriteBridge.executeOperation(
        '/usr/bin/aseprite',
        { name: 'createSprite', params: {} }
      );

      expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('.lua'));
    });
  });

  describe('parseOutput', () => {
    it('extracts OK status from stdout', () => {
      const parsed = asepriteBridge.parseOutput('OK:32x32', '', 0);
      expect(parsed.success).toBe(true);
    });

    it('detects ERROR in stdout', () => {
      const parsed = asepriteBridge.parseOutput('ERROR:Could not open file', '', 0);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('Could not open file');
    });

    it('treats non-zero exit code as failure', () => {
      const parsed = asepriteBridge.parseOutput('', 'segfault', 1);
      expect(parsed.success).toBe(false);
    });
  });

  describe('fixture-based tests', () => {
    it('handles real createSprite response from fixture', async () => {
      let fixture: { stdout: string; stderr: string; exitCode: number };
      try {
        fixture = (await import('./fixtures/createSprite.json')).default;
      } catch {
        return; // Skip if fixtures not recorded yet
      }

      const mockExecFile = vi.mocked(childProcess.execFile);
      vi.mocked(fs.readFileSync).mockReturnValue('print("OK")');

      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(
          null, fixture.stdout, fixture.stderr
        );
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const result = await asepriteBridge.executeOperation(
        '/usr/bin/aseprite',
        { name: 'createSprite', params: { width: '32', height: '32' } }
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toBe(fixture.stdout);
    });

    it('handles real error response from fixture', async () => {
      let fixture: { stdout: string; stderr: string; exitCode: number };
      try {
        fixture = (await import('./fixtures/badScript.json')).default;
      } catch {
        return;
      }

      const mockExecFile = vi.mocked(childProcess.execFile);
      vi.mocked(fs.readFileSync).mockReturnValue('bad lua');

      if (fixture.exitCode !== 0) {
        mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          (cb as (err: Error, stdout: string, stderr: string) => void)(
            Object.assign(new Error('exit'), { code: fixture.exitCode }),
            fixture.stdout, fixture.stderr
          );
          return {} as ReturnType<typeof childProcess.execFile>;
        });
      } else {
        mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          (cb as (err: null, stdout: string, stderr: string) => void)(
            null, fixture.stdout, fixture.stderr
          );
          return {} as ReturnType<typeof childProcess.execFile>;
        });
      }

      const result = await asepriteBridge.executeOperation(
        '/usr/bin/aseprite',
        { name: 'createSprite', params: {} }
      );

      if (fixture.exitCode !== 0) {
        expect(result.success).toBe(false);
      }
    });
  });
});
