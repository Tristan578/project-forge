import { describe, it, expect, vi } from 'vitest';
import { securityHandlers } from '../securityHandlers';
import { invokeHandler } from './handlerTestUtils';

vi.mock('@/lib/security/validator', () => ({
  getSecurityStatus: vi.fn().mockReturnValue({
    csrfProtection: true,
    rateLimit: true,
    inputSanitization: true,
  }),
  validateProjectSecurity: vi.fn().mockReturnValue({
    healthy: true,
    issues: [],
    stats: { entityCount: 5, scriptCount: 2 },
  }),
}));

describe('securityHandlers', () => {
  describe('get_security_status', () => {
    it('returns security settings from validator', async () => {
      const { result } = await invokeHandler(securityHandlers, 'get_security_status', {});

      expect(result.success).toBe(true);
      expect(result.result?.status).toContain('Security features enabled');
      expect(result.result?.settings).toEqual({
        csrfProtection: true,
        rateLimit: true,
        inputSanitization: true,
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

      expect(result.success).toBe(true);
      expect(result.result?.healthy).toBe(true);
      expect(result.result?.issues).toEqual([]);
    });

    it('passes scene graph nodes to validator', async () => {
      const { validateProjectSecurity } = await import('@/lib/security/validator');

      await invokeHandler(securityHandlers, 'validate_project_security', {}, {
        sceneGraph: {
          nodes: {
            n1: { entityId: 'e1', name: 'TestEntity', components: ['cube'] },
          },
        },
        allScripts: { s1: { code: 'console.log("test")' } },
      });

      expect(validateProjectSecurity).toHaveBeenCalledWith(
        [{ id: 'e1', name: 'TestEntity', type: 'cube' }],
        { s1: { code: 'console.log("test")' } },
      );
    });

    it('reports issues when validation fails', async () => {
      const { validateProjectSecurity } = await import('@/lib/security/validator');
      vi.mocked(validateProjectSecurity).mockReturnValueOnce({
        healthy: false,
        issues: ['Unsafe code pattern in script s1', 'Exposed API key in script s2'],
        stats: { entityCount: 3, scriptCount: 2 },
      });

      const { result } = await invokeHandler(securityHandlers, 'validate_project_security', {}, {
        sceneGraph: { nodes: {} },
        allScripts: {},
      });

      expect(result.success).toBe(true);
      expect(result.result?.healthy).toBe(false);
      expect(result.result?.status).toContain('Found 2 issue(s)');
      expect(result.result?.issues).toHaveLength(2);
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
