import { describe, it, expect, vi } from 'vitest';
import { securityHandlers } from '../securityHandlers';
import { invokeHandler } from './handlerTestUtils';

vi.mock('@/lib/security/validator', () => ({
  getSecurityStatus: vi.fn().mockReturnValue({
    cspEnabled: true,
    corsEnabled: true,
    rateLimitEnabled: true,
    sandboxEnabled: true,
    maxRequestSize: '10KB',
  }),
  validateProjectSecurity: vi.fn().mockReturnValue({
    healthy: true,
    issues: [],
    stats: { totalEntities: 5, suspiciousNames: 0, oversizedScripts: 0 },
  }),
}));

describe('securityHandlers', () => {
  describe('get_security_status', () => {
    it('returns security settings from validator', async () => {
      const { result } = await invokeHandler(securityHandlers, 'get_security_status', {});
      const data = result.result as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(data.status).toContain('Security features enabled');
      expect(data.settings).toEqual({
        cspEnabled: true,
        corsEnabled: true,
        rateLimitEnabled: true,
        sandboxEnabled: true,
        maxRequestSize: '10KB',
      });
    });
  });

  describe('validate_project_security', () => {
    it('returns healthy status when no issues', async () => {
      const { result } = await invokeHandler(securityHandlers, 'validate_project_security', {}, {
        sceneGraph: {
          nodes: {
            n1: { entityId: 'e1', name: 'Player', components: ['mesh'] },
            n2: { entityId: 'e2', name: 'Light', components: ['light'] },
          },
        },
        allScripts: {},
      });
      const data = result.result as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(data.healthy).toBe(true);
      expect(data.issues).toEqual([]);
    });

    it('passes scene graph nodes to validator', async () => {
      const { validateProjectSecurity } = await import('@/lib/security/validator');

      await invokeHandler(securityHandlers, 'validate_project_security', {}, {
        sceneGraph: {
          nodes: {
            n1: { entityId: 'e1', name: 'TestEntity', components: ['cube'] },
          },
        },
        allScripts: { s1: { source: 'console.log("test")' } },
      });

      expect(validateProjectSecurity).toHaveBeenCalledWith(
        [{ id: 'e1', name: 'TestEntity', type: 'cube' }],
        expect.anything(),
      );
    });

    it('reports issues when validation fails', async () => {
      const { validateProjectSecurity } = await import('@/lib/security/validator');
      vi.mocked(validateProjectSecurity).mockReturnValueOnce({
        healthy: false,
        issues: [
          { severity: 'high', category: 'script_security', message: 'Unsafe code pattern in script s1' },
          { severity: 'high', category: 'script_security', message: 'Exposed API key in script s2' },
        ],
        stats: { totalEntities: 3, suspiciousNames: 0, oversizedScripts: 0 },
      });

      const { result } = await invokeHandler(securityHandlers, 'validate_project_security', {}, {
        sceneGraph: { nodes: {} },
        allScripts: {},
      });
      const data = result.result as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect(data.healthy).toBe(false);
      expect(data.status).toContain('Found 2 issue(s)');
      expect(data.issues).toHaveLength(2);
    });

    it('handles empty scene graph', async () => {
      const { result } = await invokeHandler(securityHandlers, 'validate_project_security', {}, {
        sceneGraph: { nodes: {} },
        allScripts: {},
      });

      expect(result.success).toBe(true);
    });

    it('uses first component as entity type', async () => {
      const { validateProjectSecurity } = await import('@/lib/security/validator');
      vi.mocked(validateProjectSecurity).mockClear();

      await invokeHandler(securityHandlers, 'validate_project_security', {}, {
        sceneGraph: {
          nodes: {
            n1: { entityId: 'e1', name: 'Multi', components: ['sphere', 'physics', 'collider'] },
          },
        },
        allScripts: {},
      });

      expect(validateProjectSecurity).toHaveBeenCalledWith(
        [{ id: 'e1', name: 'Multi', type: 'sphere' }],
        {},
      );
    });

    it('defaults type to unknown when no components', async () => {
      const { validateProjectSecurity } = await import('@/lib/security/validator');
      vi.mocked(validateProjectSecurity).mockClear();

      await invokeHandler(securityHandlers, 'validate_project_security', {}, {
        sceneGraph: {
          nodes: {
            n1: { entityId: 'e1', name: 'Empty', components: [] },
          },
        },
        allScripts: {},
      });

      expect(validateProjectSecurity).toHaveBeenCalledWith(
        [{ id: 'e1', name: 'Empty', type: 'unknown' }],
        {},
      );
    });
  });
});
