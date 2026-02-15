/**
 * Security-related tool call handlers.
 */

import type { ToolCallContext, ExecutionResult } from './types';
import { getSecurityStatus, validateProjectSecurity } from '@/lib/security/validator';

/**
 * Get current security configuration status.
 */
async function handleGetSecurityStatus(
  _args: Record<string, unknown>,
  _ctx: ToolCallContext
): Promise<ExecutionResult> {
  const status = getSecurityStatus();

  return {
    success: true,
    result: {
      status: 'Security features enabled',
      settings: status,
    },
  };
}

/**
 * Validate project for security issues.
 */
async function handleValidateProjectSecurity(
  _args: Record<string, unknown>,
  ctx: ToolCallContext
): Promise<ExecutionResult> {
  const { store } = ctx;

  // Get scene graph - convert from object to array
  // Note: SceneNode doesn't have a 'type' field directly, so we extract it from components
  const sceneGraph = Object.values(store.sceneGraph.nodes).map((node) => ({
    id: node.entityId,
    name: node.name,
    type: node.components[0] || 'unknown', // First component is usually the entity type
  }));

  // Get all scripts
  const scripts = store.allScripts;

  // Run validation
  const validation = validateProjectSecurity(sceneGraph, scripts);

  return {
    success: true,
    result: {
      status: validation.healthy ? 'No issues found' : `Found ${validation.issues.length} issue(s)`,
      healthy: validation.healthy,
      issues: validation.issues,
      stats: validation.stats,
    },
  };
}

export const securityHandlers = {
  get_security_status: handleGetSecurityStatus,
  validate_project_security: handleValidateProjectSecurity,
};
