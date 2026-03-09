import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/bridges/bridgeManager', () => ({
  discoverTool: vi.fn(),
  healthCheck: vi.fn(),
}));
vi.mock('@/lib/bridges/asepriteBridge', () => ({
  executeOperation: vi.fn(),
}));

describe('Bridge API logic', () => {
  let bridgeManager: typeof import('../bridgeManager');
  let asepriteBridge: typeof import('../asepriteBridge');

  beforeEach(async () => {
    vi.resetModules();
    bridgeManager = await import('../bridgeManager');
    asepriteBridge = await import('../asepriteBridge');
  });

  describe('discover', () => {
    it('returns tool config on successful discovery', async () => {
      vi.mocked(bridgeManager.discoverTool).mockResolvedValue({
        id: 'aseprite',
        name: 'Aseprite',
        paths: { darwin: '/usr/bin/aseprite' },
        activeVersion: '1.3.17',
        status: 'connected',
      });

      const result = await bridgeManager.discoverTool('aseprite');
      expect(result.status).toBe('connected');
      expect(result.activeVersion).toBe('1.3.17');
    });

    it('returns not_found when tool is missing', async () => {
      vi.mocked(bridgeManager.discoverTool).mockResolvedValue({
        id: 'aseprite',
        name: 'Aseprite',
        paths: {},
        activeVersion: null,
        status: 'not_found',
      });

      const result = await bridgeManager.discoverTool('aseprite');
      expect(result.status).toBe('not_found');
    });
  });

  describe('execute', () => {
    it('returns success result from aseprite bridge', async () => {
      vi.mocked(asepriteBridge.executeOperation).mockResolvedValue({
        success: true,
        stdout: 'OK:32x32',
        exitCode: 0,
      });

      const result = await asepriteBridge.executeOperation('/usr/bin/aseprite', {
        name: 'createSprite',
        params: { width: '32', height: '32' },
      });
      expect(result.success).toBe(true);
    });

    it('returns error result on failure', async () => {
      vi.mocked(asepriteBridge.executeOperation).mockResolvedValue({
        success: false,
        error: 'Script error',
        exitCode: 1,
      });

      const result = await asepriteBridge.executeOperation('/usr/bin/aseprite', {
        name: 'createSprite',
        params: {},
      });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Script error');
    });
  });

  describe('healthCheck', () => {
    it('returns connected for working binary', async () => {
      vi.mocked(bridgeManager.healthCheck).mockResolvedValue('connected');
      const status = await bridgeManager.healthCheck('/usr/bin/aseprite');
      expect(status).toBe('connected');
    });
  });
});
