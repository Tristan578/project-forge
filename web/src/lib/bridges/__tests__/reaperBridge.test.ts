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

import * as reaperBridge from '../reaperBridge';
import * as childProcess from 'child_process';

describe('reaperBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('tool identity', () => {
    it('exports REAPER_TOOL_ID as "reaper"', () => {
      expect(reaperBridge.REAPER_TOOL_ID).toBe('reaper');
    });

    it('includes all expected binary search names', () => {
      expect(reaperBridge.REAPER_BINARY_NAMES).toContain('reaper');
      expect(reaperBridge.REAPER_BINARY_NAMES).toContain('REAPER');
      expect(reaperBridge.REAPER_BINARY_NAMES).toContain('reaper.exe');
    });

    it('exports all three supported operations', () => {
      expect(reaperBridge.REAPER_OPERATIONS).toContain('openInReaper');
      expect(reaperBridge.REAPER_OPERATIONS).toContain('batchExport');
      expect(reaperBridge.REAPER_OPERATIONS).toContain('normalize');
    });
  });

  describe('default paths', () => {
    it('provides default path for darwin', () => {
      expect(reaperBridge.REAPER_DEFAULT_PATHS['darwin']).toContain('REAPER');
    });

    it('provides default path for win32', () => {
      expect(reaperBridge.REAPER_DEFAULT_PATHS['win32']).toContain('reaper.exe');
    });

    it('provides default path for linux', () => {
      expect(reaperBridge.REAPER_DEFAULT_PATHS['linux']).toContain('reaper');
    });

    it('returns default binary path for current platform (darwin mocked)', () => {
      const path = reaperBridge.getDefaultBinaryPath();
      // platform is mocked to 'darwin'
      expect(path).toBe('/Applications/REAPER.app/Contents/MacOS/REAPER');
    });
  });

  describe('buildOpenCommand', () => {
    it('returns the file path as a positional argument', () => {
      const args = reaperBridge.buildOpenCommand('/home/user/track.wav');
      expect(args).toEqual(['/home/user/track.wav']);
    });

    it('throws on path traversal attempt', () => {
      expect(() => reaperBridge.buildOpenCommand('/home/user/../../../etc/passwd')).toThrow(
        'Invalid file path'
      );
    });

    it('throws on relative path', () => {
      expect(() => reaperBridge.buildOpenCommand('track.wav')).toThrow('Invalid file path');
    });

    it('throws on null byte in path', () => {
      expect(() => reaperBridge.buildOpenCommand('/home/user/tr\0ack.wav')).toThrow(
        'Invalid file path'
      );
    });
  });

  describe('buildBatchExportCommand', () => {
    it('builds correct command for wav format', () => {
      const args = reaperBridge.buildBatchExportCommand(
        '/projects/game.rpp',
        '/output',
        'wav'
      );
      expect(args).toEqual(['-batchconvert', '/projects/game.rpp', '-outputdir', '/output', '-format', 'wav']);
    });

    it('builds correct command for mp3 format', () => {
      const args = reaperBridge.buildBatchExportCommand(
        '/projects/game.rpp',
        '/output',
        'mp3'
      );
      expect(args).toContain('-format');
      expect(args).toContain('mp3');
    });

    it('builds correct command for ogg format', () => {
      const args = reaperBridge.buildBatchExportCommand(
        '/projects/game.rpp',
        '/output',
        'ogg'
      );
      expect(args).toContain('ogg');
    });

    it('throws on invalid format', () => {
      expect(() =>
        reaperBridge.buildBatchExportCommand(
          '/projects/game.rpp',
          '/output',
          'flac' as 'wav'
        )
      ).toThrow('Invalid format');
    });

    it('throws on path traversal in project path', () => {
      expect(() =>
        reaperBridge.buildBatchExportCommand(
          '/projects/../etc/game.rpp',
          '/output',
          'wav'
        )
      ).toThrow('Invalid project path');
    });

    it('throws on path traversal in output dir', () => {
      expect(() =>
        reaperBridge.buildBatchExportCommand(
          '/projects/game.rpp',
          '/output/../etc',
          'wav'
        )
      ).toThrow('Invalid output directory path');
    });
  });

  describe('buildNormalizeCommand', () => {
    it('builds normalize command with file path', () => {
      const args = reaperBridge.buildNormalizeCommand('/audio/voice.wav');
      expect(args).toContain('/audio/voice.wav');
      expect(args).toContain('normalize');
    });

    it('throws on path traversal', () => {
      expect(() => reaperBridge.buildNormalizeCommand('/audio/../etc/voice.wav')).toThrow(
        'Invalid file path'
      );
    });

    it('throws on relative path', () => {
      expect(() => reaperBridge.buildNormalizeCommand('voice.wav')).toThrow('Invalid file path');
    });
  });

  describe('openInReaper', () => {
    it('calls execFile with binary path and file argument', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, '', '');
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const result = await reaperBridge.openInReaper(
        '/Applications/REAPER.app/Contents/MacOS/REAPER',
        '/home/user/track.wav'
      );

      expect(result.success).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        '/Applications/REAPER.app/Contents/MacOS/REAPER',
        ['/home/user/track.wav'],
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('returns error result when REAPER fails', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: Error & { code?: number }, stdout: string, stderr: string) => void)(
          Object.assign(new Error('exit'), { code: 1 }),
          '',
          'REAPER: cannot open file'
        );
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const result = await reaperBridge.openInReaper(
        '/Applications/REAPER.app/Contents/MacOS/REAPER',
        '/home/user/track.wav'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects invalid binary path without calling execFile', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);

      const result = await reaperBridge.openInReaper(
        '../../../etc/malicious',
        '/home/user/track.wav'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid binary path');
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it('rejects invalid file path without calling execFile', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);

      const result = await reaperBridge.openInReaper(
        '/Applications/REAPER.app/Contents/MacOS/REAPER',
        'relative/path.wav'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid file path');
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });

  describe('batchExport', () => {
    it('calls execFile with batchconvert and format arguments', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, '', '');
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const result = await reaperBridge.batchExport(
        '/Applications/REAPER.app/Contents/MacOS/REAPER',
        '/projects/game.rpp',
        '/output/stems',
        'wav'
      );

      expect(result.success).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        '/Applications/REAPER.app/Contents/MacOS/REAPER',
        ['-batchconvert', '/projects/game.rpp', '-outputdir', '/output/stems', '-format', 'wav'],
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('returns error for invalid binary path', async () => {
      const result = await reaperBridge.batchExport(
        'reaper',
        '/projects/game.rpp',
        '/output',
        'wav'
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid binary path');
    });

    it('returns error for invalid format', async () => {
      const result = await reaperBridge.batchExport(
        '/Applications/REAPER.app/Contents/MacOS/REAPER',
        '/projects/game.rpp',
        '/output',
        'flac' as 'wav'
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid format');
    });

    it('propagates stderr on failure', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: Error & { code?: number }, stdout: string, stderr: string) => void)(
          Object.assign(new Error('exit'), { code: 2 }),
          '',
          'Render error: project not found'
        );
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const result = await reaperBridge.batchExport(
        '/Applications/REAPER.app/Contents/MacOS/REAPER',
        '/projects/game.rpp',
        '/output',
        'mp3'
      );

      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Render error');
      expect(result.exitCode).toBe(2);
    });
  });

  describe('normalize', () => {
    it('calls execFile with normalize arguments', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, '', '');
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const result = await reaperBridge.normalize(
        '/Applications/REAPER.app/Contents/MacOS/REAPER',
        '/audio/voice.wav'
      );

      expect(result.success).toBe(true);
      expect(mockExecFile).toHaveBeenCalledWith(
        '/Applications/REAPER.app/Contents/MacOS/REAPER',
        expect.arrayContaining(['/audio/voice.wav', 'normalize']),
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('returns error for invalid binary path', async () => {
      const result = await reaperBridge.normalize('reaper', '/audio/voice.wav');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid binary path');
    });

    it('returns error for invalid file path', async () => {
      const result = await reaperBridge.normalize(
        '/Applications/REAPER.app/Contents/MacOS/REAPER',
        '../evil.wav'
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid file path');
    });

    it('captures exitCode from failed process', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: Error & { code?: number }, stdout: string, stderr: string) => void)(
          Object.assign(new Error('exit'), { code: 127 }),
          '',
          'REAPER: command not found'
        );
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const result = await reaperBridge.normalize(
        '/Applications/REAPER.app/Contents/MacOS/REAPER',
        '/audio/voice.wav'
      );

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(127);
    });
  });
});
