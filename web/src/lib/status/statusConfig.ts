/**
 * Configuration for SpawnForge status page monitored services.
 *
 * Each entry maps a stable service ID to its display name and the internal
 * health check service name used by lib/monitoring/healthChecks.ts.
 * The healthCheckName must match the `name` field returned by the
 * corresponding checkXxx() function.
 */

export interface MonitoredServiceConfig {
  /** Stable machine-readable identifier used in the public API response. */
  id: string;
  /** Human-readable name shown on the status page. */
  displayName: string;
  /**
   * The `name` field returned by the internal health check function.
   * Used to correlate health check results with service config entries.
   */
  healthCheckName: string;
  /**
   * Brief description of what this service does, shown to end users.
   */
  description: string;
  /**
   * Whether this service is "critical" — its outage should result in
   * the overall status being 'major_outage' rather than 'partial_outage'.
   */
  critical: boolean;
}

/**
 * Ordered list of services displayed on the status page.
 * Order determines display order — critical services first.
 */
export const MONITORED_SERVICES: MonitoredServiceConfig[] = [
  {
    id: 'app',
    displayName: 'Application',
    healthCheckName: 'Application',
    description: 'Main SpawnForge web application and editor',
    critical: true,
  },
  {
    id: 'database',
    displayName: 'Database',
    healthCheckName: 'Database (Neon)',
    description: 'Project storage and user data',
    critical: true,
  },
  {
    id: 'auth',
    displayName: 'Authentication',
    healthCheckName: 'Clerk',
    description: 'User sign-in and account management',
    critical: true,
  },
  {
    id: 'ai',
    displayName: 'AI Assistant',
    healthCheckName: 'Anthropic',
    description: 'AI chat, code generation, and scene building',
    critical: false,
  },
  {
    id: 'asset_storage',
    displayName: 'Asset Storage',
    healthCheckName: 'Cloudflare R2',
    description: 'Game assets, textures, and 3D models',
    critical: false,
  },
  {
    id: 'engine_cdn',
    displayName: 'Engine CDN',
    healthCheckName: 'Engine CDN',
    description: 'WebAssembly game engine delivery',
    critical: false,
  },
  {
    id: 'payments',
    displayName: 'Payments',
    healthCheckName: 'Payments (Stripe)',
    description: 'Subscription billing and plan management',
    critical: false,
  },
  {
    id: 'rate_limiting',
    displayName: 'API Rate Limiting',
    healthCheckName: 'Rate Limiting (Upstash)',
    description: 'API request rate limiting and abuse prevention',
    critical: false,
  },
];

/**
 * Look up a monitored service config by its health check name.
 * Returns undefined if no service is registered for the given name.
 */
export function findServiceByHealthCheckName(
  healthCheckName: string,
): MonitoredServiceConfig | undefined {
  return MONITORED_SERVICES.find((s) => s.healthCheckName === healthCheckName);
}

/**
 * Look up a monitored service config by its stable ID.
 * Returns undefined if no service is registered for the given ID.
 */
export function findServiceById(id: string): MonitoredServiceConfig | undefined {
  return MONITORED_SERVICES.find((s) => s.id === id);
}
