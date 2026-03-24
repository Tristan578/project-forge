// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));
// Mock child_process and fs before imports
vi.mock('child_process', () => ({
  execFile: vi.fn(),
  default: { execFile: vi.fn() },
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  default: { existsSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn(), mkdirSync: vi.fn() },
}));
vi.mock('os', () => ({
  homedir: vi.fn(() => '/mock-home'),
  platform: vi.fn(() => 'darwin'),
  default: { homedir: vi.fn(() => '/mock-home'), platform: vi.fn(() => 'darwin') },
}));

import * as fs from 'fs';
import * as childProcess from 'child_process';

// Use dynamic import so each test group gets a fresh module-level cache.
async function importBridgeManager() {
  vi.resetModules();
  // Re-apply mocks after module reset
  vi.mock('server-only', () => ({}));
  vi.mock('child_process', () => ({
    execFile: vi.fn(),
    default: { execFile: vi.fn() },
  }));
  vi.mock('fs', () => ({
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    default: { existsSync: vi.fn(), readFileSync: vi.fn(), writeFileSync: vi.fn(), mkdirSync: vi.fn() },
  }));
  vi.mock('os', () => ({
    homedir: vi.fn(() => '/mock-home'),
    platform: vi.fn(() => 'darwin'),
    default: { homedir: vi.fn(() => '/mock-home'), platform: vi.fn(() => 'darwin') },
  }));
  return await import('../bridgeManager');
}

// Static import for tests that don't need a fresh cache
import * as bridgeManager from '../bridgeManager';

describe('BridgeManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getDefaultPaths', () => {
    it('returns macOS default paths for aseprite', () => {
      const paths = bridgeManager.getDefaultPaths('aseprite');
      expect(paths.darwin).toContain('Aseprite.app');
      expect(paths.win32).toContain('Aseprite');
      expect(paths.linux).not.toBeUndefined();
    });
  });

  describe('discoverTool', () => {
    it('returns connected config when binary exists on macOS', async () => {
      // Use fresh module to avoid cache from other tests
      const freshModule = await importBridgeManager();
      const freshFs = await import('fs');
      const freshCp = await import('child_process');

      vi.mocked(freshFs.existsSync).mockReturnValue(true);
      vi.mocked(freshCp.execFile).mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'Aseprite 1.3.17-arm64', '');
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const config = await freshModule.discoverTool('aseprite');
      expect(config.status).toBe('connected');
      expect(config.activeVersion).toBe('1.3.17');
    });

    it('returns not_found when no binary exists', async () => {
      // Use fresh module so the discovery cache is empty — no time travel needed
      const freshModule = await importBridgeManager();
      const freshFs = await import('fs');

      vi.mocked(freshFs.existsSync).mockReturnValue(false);

      const config = await freshModule.discoverTool('aseprite');
      expect(config.status).toBe('not_found');
      expect(config.activeVersion).toBeNull();
    });

    it('rejects unknown toolId with not_found status', async () => {
      const config = await bridgeManager.discoverTool('unknown-tool');
      expect(config.status).toBe('not_found');
    });

    it('validates toolId against allowlist', () => {
      expect(bridgeManager.isAllowedToolId('aseprite')).toBe(true);
      expect(bridgeManager.isAllowedToolId('unknown')).toBe(false);
      expect(bridgeManager.isAllowedToolId('../etc/passwd')).toBe(false);
    });
  });

  describe('loadConfig / saveConfig', () => {
    it('returns empty config when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const config = bridgeManager.loadBridgesConfig();
      expect(config).toEqual({});
    });

    it('loads config from ~/.spawnforge/bridges.json', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        aseprite: { paths: { darwin: '/usr/local/bin/aseprite' }, activeVersion: '1.3.17' },
      }));
      const config = bridgeManager.loadBridgesConfig();
      expect(config.aseprite).not.toBeUndefined();
      expect(config.aseprite.activeVersion).toBe('1.3.17');
    });

    it('saves config to ~/.spawnforge/bridges.json', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const mockWrite = vi.mocked(fs.writeFileSync);
      bridgeManager.saveBridgesConfig({
        aseprite: { paths: { darwin: '/usr/bin/aseprite' }, activeVersion: '1.3.17' },
      });
      expect(mockWrite).toHaveBeenCalledWith(
        expect.stringContaining('bridges.json'),
        expect.any(String),
        'utf-8'
      );
    });
  });

  describe('healthCheck', () => {
    it('returns connected when binary responds', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: null, stdout: string, stderr: string) => void)(null, 'Aseprite 1.3.17', '');
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const status = await bridgeManager.healthCheck('/Applications/Aseprite.app/Contents/MacOS/aseprite');
      expect(status).toBe('connected');
    });

    it('returns error when binary fails', async () => {
      const mockExecFile = vi.mocked(childProcess.execFile);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
        (cb as (err: Error, stdout: string, stderr: string) => void)(new Error('ENOENT'), '', 'not found');
        return {} as ReturnType<typeof childProcess.execFile>;
      });

      const status = await bridgeManager.healthCheck('/bad/path');
      expect(status).toBe('error');
    });
  });
});
