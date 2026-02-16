/**
 * Security validation utilities for project health checks.
 */

import { validateEntityName, detectPromptInjection } from '@/lib/chat/sanitizer';

export interface SecurityIssue {
  severity: 'low' | 'medium' | 'high';
  category: string;
  message: string;
  entityId?: string;
}

export interface SecurityStatus {
  healthy: boolean;
  issues: SecurityIssue[];
  stats: {
    totalEntities: number;
    suspiciousNames: number;
    oversizedScripts: number;
  };
}

/**
 * Validate project for common security issues.
 *
 * @param sceneGraph - Scene graph from editor store
 * @param scripts - All scripts in the project
 * @returns Security status report
 */
export function validateProjectSecurity(
  sceneGraph: Array<{
    id: string;
    name: string;
    type: string;
  }>,
  scripts: Record<string, { source: string }>
): SecurityStatus {
  const issues: SecurityIssue[] = [];

  // Check entity names
  let suspiciousNames = 0;
  for (const entity of sceneGraph) {
    const sanitized = validateEntityName(entity.name);
    if (sanitized !== entity.name && sanitized !== 'Entity') {
      issues.push({
        severity: 'low',
        category: 'entity_name',
        message: `Entity "${entity.name}" contains special characters`,
        entityId: entity.id,
      });
      suspiciousNames++;
    }

    // Check for injection patterns in entity names
    const injectionCheck = detectPromptInjection(entity.name);
    if (injectionCheck.detected) {
      issues.push({
        severity: 'medium',
        category: 'entity_name',
        message: `Entity "${entity.name}" contains suspicious patterns`,
        entityId: entity.id,
      });
    }
  }

  // Check script sizes
  let oversizedScripts = 0;
  for (const [_entityId, script] of Object.entries(scripts)) {
    if (script.source.length > 50000) {
      issues.push({
        severity: 'medium',
        category: 'script_size',
        message: 'Script exceeds 50KB (may impact performance)',
      });
      oversizedScripts++;
    }

    // Check for suspicious patterns in scripts
    const suspiciousPatterns = [
      /eval\s*\(/i,
      /Function\s*\(/i,
      /new\s+Function/i,
      /__proto__/i,
      /constructor\s*\[/i,
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(script.source)) {
        issues.push({
          severity: 'high',
          category: 'script_security',
          message: `Script contains potentially unsafe pattern: ${pattern.source}`,
        });
        break; // Only report once per script
      }
    }
  }

  // Check total entity count (performance issue, not security, but worth noting)
  if (sceneGraph.length > 1000) {
    issues.push({
      severity: 'low',
      category: 'performance',
      message: `Scene contains ${sceneGraph.length} entities (may impact performance)`,
    });
  }

  const healthy = issues.every((issue) => issue.severity === 'low');

  return {
    healthy,
    issues,
    stats: {
      totalEntities: sceneGraph.length,
      suspiciousNames,
      oversizedScripts,
    },
  };
}

/**
 * Get current security configuration status.
 *
 * @returns Security settings summary
 */
export function getSecurityStatus(): {
  cspEnabled: boolean;
  corsEnabled: boolean;
  rateLimitEnabled: boolean;
  sandboxEnabled: boolean;
  maxRequestSize: string;
} {
  return {
    cspEnabled: true, // CSP in next.config.ts
    corsEnabled: true, // Middleware handles CORS
    rateLimitEnabled: true, // Rate limiter in lib/rateLimit.ts
    sandboxEnabled: true, // Script worker sandbox
    maxRequestSize: '10KB',
  };
}
