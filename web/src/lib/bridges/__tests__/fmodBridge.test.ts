// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('child_process', () => ({
  execFile: vi.fn(),
  default: { execFile: vi.fn() },
}));
vi.mock('os', () => ({
  platform: vi.fn(() => 'darwin'),
  default: { platform: vi.fn(() => 'darwin') },
}));

import * as fmodBridge from '../fmodBridge';
import * as childProcess from 'child_process';

describe('fmodBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Tool identity
  // -------------------------------------------------------------------------

  describe('tool identity', () => {
    it('exports FMOD_TOOL_ID as "fmod"', () => {
      expect(fmodBridge.FMOD_TOOL_ID).toBe('fmod');
    });

    it('includes all expected binary search names', () => {
      expect(fmodBridge.FMOD_BINARY_NAMES).toContain('fmodstudio');
      expect(fmodBridge.FMOD_BINARY_NAMES).toContain('FMOD Studio');
      expect(fmodBridge.FMOD_BINARY_NAMES).toContain('FMODStudio.exe');
    });

    it('exports all three supported operations', () => {
      expect(fmodBridge.FMOD_OPERATIONS).toContain('openProject');
      expect(fmodBridge.FMOD_OPERATIONS).toContain('buildBanks');
      expect(fmodBridge.FMOD_OPERATIONS).toContain('exportMetadata');
    });
  });

  // -------------------------------------------------------------------------
  // Default paths
  // -------------------------------------------------------------------------

  describe('default paths', () => {
    it('provides default path for darwin', () => {
      expect(fmodBridge.FMOD_DEFAULT_PATHS['darwin']).toContain('FMOD Studio');
    });

    it('provides default path for win32', () => {
      expect(fmodBridge.FMOD_DEFAULT_PATHS['win32']).toContain('fmodstudio.exe');
    });

    it('provides default path for linux', () => {
      expect(fmodBridge.FMOD_DEFAULT_PATHS['linux']).toContain('fmodstudio');
    });

    it('returns default binary path for darwin (platform mocked to darwin)', () => {
      const path = fmodBridge.getDefaultBinaryPath();
      expect(path).toBe('/Applications/FMOD Studio/FMOD Studio.app/Contents/MacOS/FMOD Studio');
    });

    it('returns null for an unknown platform via the defaults map', () => {
      // The exported map simply has no entry for non-standard platforms
      expect(fmodBridge.FMOD_DEFAULT_PATHS['freebsd']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // isSafePath
  // -------------------------------------------------------------------------

  describe('isSafePath', () => {
    it('accepts a valid Unix absolute path', () => {
      expect(fmodBridge.isSafePath('/Applications/FMOD Studio/project.fspro')).toBe(true);
    });

    it('accepts a valid Windows absolute path', () => {
      expect(fmodBridge.isSafePath('C:\\Users\\Dev\\project.fspro')).toBe(true);
    });

    it('rejects a path with ..', () => {
      expect(fmodBridge.isSafePath('/projects/../etc/passwd')).toBe(false);
    });

    it('rejects a path with null byte', () => {
      expect(fmodBridge.isSafePath('/projects/game\0.fspro')).toBe(false);
    });

    it('rejects a relative path', () => {
      expect(fmodBridge.isSafePath('projects/game.fspro')).toBe(false);
    });

    it('rejects an empty string', () => {
      expect(fmodBridge.isSafePath('')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // buildOpenProjectCommand
  // -------------------------------------------------------------------------

  describe('buildOpenProjectCommand', () => {
    it('returns project path as positional argument', () => {
      const args = fmodBridge.buildOpenProjectCommand('/projects/game.fspro');
      expect(args).toEqual(['/projects/game.fspro']);
    });

    it('throws on path traversal', () => {
      expect(() =>
        fmodBridge.buildOpenProjectCommand('/projects/../etc/game.fspro')
      ).toThrow('Invalid project path');
    });

    it('throws on relative path', () => {
      expect(() =>
        fmodBridge.buildOpenProjectCommand('game.fspro')
      ).toThrow('Invalid project path');
    });

    it('throws on null byte', () => {
      expect(() =>
        fmodBridge.buildOpenProjectCommand('/projects/ga\0me.fspro')
      ).toThrow('Invalid project path');
    });
  });

  // -------------------------------------------------------------------------
  // buildBuildBanksCommand
  // -------------------------------------------------------------------------

  describe('buildBuildBanksCommand', () => {
    it('builds correct command without platform', () => {
      const args = fmodBridge.buildBuildBanksCommand(
        '/projects/game.fspro',
        '/output/banks'
      );
      expect(args).toEqual([
        '-build', '/projects/game.fspro',
        '-outputdir', '/output/banks',
      ]);
    });

    it('includes platform flag when provided', () => {
      const args = fmodBridge.buildBuildBanksCommand(
        '/projects/game.fspro',
        '/output/banks',
        'Desktop'
      );
      expect(args).toEqual([
        '-build', '/projects/game.fspro',
        '-outputdir', '/output/banks',
        '-platform', 'Desktop',
      ]);
    });

    it('accepts Mobile as a valid platform identifier', () => {
      const args = fmodBridge.buildBuildBanksCommand(
        '/projects/game.fspro',
        '/output',
        'Mobile'
      );
      expect(args).toContain('Mobile');
    });

    it('accepts alphanumeric platform identifiers', () => {
      const args = fmodBridge.buildBuildBanksCommand(
        '/projects/game.fspro',
        '/output',
        'PS5'
      );
      expect(args).toContain('PS5');
    });

    it('throws on invalid platform identifier with shell metacharacters', () => {
      expect(() =>
        fmodBridge.buildBuildBanksCommand('/projects/game.fspro', '/output', 'Desktop; rm -rf /')
      ).toThrow('Invalid platform identifier');
    });

    it('throws on path traversal in project path', () => {
      expect(() =>
        fmodBridge.buildBuildBanksCommand('/projects/../etc/game.fspro', '/output')
      ).toThrow('Invalid project path');
    });

    it('throws on path traversal in output directory', () => {
      expect(() =>
        fmodBridge.buildBuildBanksCommand('/projects/game.fspro', '/output/../etc')
      ).toThrow('Invalid output directory path');
    });

    it('throws on relative project path', () => {
      expect(() =>
        fmodBridge.buildBuildBanksCommand('game.fspro', '/output')
      ).toThrow('Invalid project path');
    });

    it('throws on relative output directory', () => {
      expect(() =>
        fmodBridge.buildBuildBanksCommand('/projects/game.fspro', 'output')
      ).toThrow('Invalid output directory path');
    });
  });

  // -------------------------------------------------------------------------
  // buildExportMetadataCommand
  // -------------------------------------------------------------------------

  describe('buildExportMetadataCommand', () => {
    it('builds correct metadata export command', () => {
      const args = fmodBridge.buildExportMetadataCommand('/projects/game.fspro');
      expect(args).toEqual(['-exportmetadata', '/projects/game.fspro']);
    });

    it('throws on path traversal', () => {
      expect(() =>
        fmodBridge.buildExportMetadataCommand('/projects/../etc/game.fspro')
      ).toThrow('Invalid project path');
    });

    it('throws on relative path', () => {
      expect(() =>
        fmodBridge.buildExportMetadataCommand('game.fspro')
      ).toThrow('Invalid project path');
    });

    it('throws on null byte', () => {
      expect(() =>
        fmodBridge.buildExportMetadataCommand('/projects/ga\0me.fspro')
      ).toThrow('Invalid project path');
    });
  });

  // -------------------------------------------------------------------------
  // openProject (integration with execFile)
  // -------------------------------------------------------------------------

  describe('openProject', () => {
    it('calls execFile with binary and project path, returns success', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      mockExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          (cb as (err: null, stdout: string, stderr: string) => void)(null, '', '');
          return {} as ReturnType<typeof childProcess.execFile>;
        }
      );

      const result = await fmodBridge.openProject(
        '/Applications/FMOD Studio/FMOD Studio.app/Contents/MacOS/FMOD Studio',
        '/projects/game.fspro'
      );

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(mockExecFile).toHaveBeenCalledWith(
        '/Applications/FMOD Studio/FMOD Studio.app/Contents/MacOS/FMOD Studio',
        ['/projects/game.fspro'],
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('returns error result when FMOD Studio fails', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      mockExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          (cb as (err: Error & { code?: number }, stdout: string, stderr: string) => void)(
            Object.assign(new Error('exit'), { code: 1 }),
            '',
            'FMOD: project not found'
          );
          return {} as ReturnType<typeof childProcess.execFile>;
        }
      );

      const result = await fmodBridge.openProject(
        '/Applications/FMOD Studio/FMOD Studio.app/Contents/MacOS/FMOD Studio',
        '/projects/game.fspro'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('FMOD');
    });

    it('returns error for invalid binary path', async () => {
      const result = await fmodBridge.openProject(
        '../evil/fmodstudio',
        '/projects/game.fspro'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid binary path');
      expect(childProcess.execFile).not.toHaveBeenCalled();
    });

    it('returns error for invalid project path', async () => {
      const result = await fmodBridge.openProject(
        '/Applications/FMOD Studio/FMOD Studio.app/Contents/MacOS/FMOD Studio',
        '../evil/game.fspro'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid project path');
      expect(childProcess.execFile).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // buildBanks (integration with execFile)
  // -------------------------------------------------------------------------

  describe('buildBanks', () => {
    const BINARY = '/Applications/FMOD Studio/FMOD Studio.app/Contents/MacOS/FMOD Studio';
    const PROJECT = '/projects/game.fspro';
    const OUTPUT = '/output/banks';

    it('calls execFile with build args and returns success', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      mockExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          (cb as (err: null, stdout: string, stderr: string) => void)(null, 'Banks built', '');
          return {} as ReturnType<typeof childProcess.execFile>;
        }
      );

      const result = await fmodBridge.buildBanks(BINARY, PROJECT, OUTPUT);

      expect(result.success).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        BINARY,
        ['-build', PROJECT, '-outputdir', OUTPUT],
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('passes platform flag when provided', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      mockExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          (cb as (err: null, stdout: string, stderr: string) => void)(null, '', '');
          return {} as ReturnType<typeof childProcess.execFile>;
        }
      );

      await fmodBridge.buildBanks(BINARY, PROJECT, OUTPUT, 'Desktop');

      expect(mockExecFile).toHaveBeenCalledWith(
        BINARY,
        ['-build', PROJECT, '-outputdir', OUTPUT, '-platform', 'Desktop'],
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('returns error for invalid binary path', async () => {
      const result = await fmodBridge.buildBanks('../evil', PROJECT, OUTPUT);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid binary path');
      expect(childProcess.execFile).not.toHaveBeenCalled();
    });

    it('returns error for invalid project path', async () => {
      const result = await fmodBridge.buildBanks(BINARY, '../evil.fspro', OUTPUT);

      expect(result.success).toBe(false);
      expect(childProcess.execFile).not.toHaveBeenCalled();
    });

    it('returns error for invalid output path', async () => {
      const result = await fmodBridge.buildBanks(BINARY, PROJECT, '../evil');

      expect(result.success).toBe(false);
      expect(childProcess.execFile).not.toHaveBeenCalled();
    });

    it('returns error for platform with shell metacharacters', async () => {
      const result = await fmodBridge.buildBanks(
        BINARY,
        PROJECT,
        OUTPUT,
        '$(rm -rf /)'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid platform identifier');
      expect(childProcess.execFile).not.toHaveBeenCalled();
    });

    it('propagates execFile error on non-zero exit', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      mockExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          (cb as (err: Error & { code?: number }, stdout: string, stderr: string) => void)(
            Object.assign(new Error('build failed'), { code: 2 }),
            '',
            'Bank build error'
          );
          return {} as ReturnType<typeof childProcess.execFile>;
        }
      );

      const result = await fmodBridge.buildBanks(BINARY, PROJECT, OUTPUT);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // exportMetadata (integration with execFile)
  // -------------------------------------------------------------------------

  describe('exportMetadata', () => {
    const BINARY = '/Applications/FMOD Studio/FMOD Studio.app/Contents/MacOS/FMOD Studio';
    const PROJECT = '/projects/game.fspro';

    it('calls execFile with exportmetadata args and returns success', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      mockExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          (cb as (err: null, stdout: string, stderr: string) => void)(
            null,
            '{"events": [], "buses": []}',
            ''
          );
          return {} as ReturnType<typeof childProcess.execFile>;
        }
      );

      const result = await fmodBridge.exportMetadata(BINARY, PROJECT);

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('events');
      expect(mockExecFile).toHaveBeenCalledWith(
        BINARY,
        ['-exportmetadata', PROJECT],
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('returns error for invalid binary path', async () => {
      const result = await fmodBridge.exportMetadata('../evil/fmod', PROJECT);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid binary path');
      expect(childProcess.execFile).not.toHaveBeenCalled();
    });

    it('returns error for invalid project path', async () => {
      const result = await fmodBridge.exportMetadata(BINARY, '../evil.fspro');

      expect(result.success).toBe(false);
      expect(childProcess.execFile).not.toHaveBeenCalled();
    });

    it('returns error when execFile reports non-zero exit code', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      mockExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          (cb as (err: Error & { code?: number }, stdout: string, stderr: string) => void)(
            Object.assign(new Error('export failed'), { code: 3 }),
            '',
            'Export error'
          );
          return {} as ReturnType<typeof childProcess.execFile>;
        }
      );

      const result = await fmodBridge.exportMetadata(BINARY, PROJECT);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(3);
      expect(result.error).toContain('Export error');
    });

    it('passes stdout through on success', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      const metadataOutput = JSON.stringify({ events: ['Music/Ambient'], buses: ['Master'] });
      mockExecFile.mockImplementation(
        (_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
          (cb as (err: null, stdout: string, stderr: string) => void)(null, metadataOutput, '');
          return {} as ReturnType<typeof childProcess.execFile>;
        }
      );

      const result = await fmodBridge.exportMetadata(BINARY, PROJECT);

      expect(result.success).toBe(true);
      expect(result.stdout).toBe(metadataOutput);
    });
  });

  // -------------------------------------------------------------------------
  // Extra search paths coverage
  // -------------------------------------------------------------------------

  describe('FMOD_EXTRA_PATHS', () => {
    it('provides extra search paths for win32', () => {
      const paths = fmodBridge.FMOD_EXTRA_PATHS['win32'];
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths) {
        expect(p).toMatch(/fmodstudio\.exe$/i);
      }
    });

    it('provides extra search paths for linux', () => {
      const paths = fmodBridge.FMOD_EXTRA_PATHS['linux'];
      expect(Array.isArray(paths)).toBe(true);
      expect(paths.length).toBeGreaterThan(0);
    });

    it('all extra paths pass isSafePath', () => {
      for (const [_plat, paths] of Object.entries(fmodBridge.FMOD_EXTRA_PATHS)) {
        for (const p of paths) {
          expect(fmodBridge.isSafePath(p)).toBe(true);
        }
      }
    });
  });
});
