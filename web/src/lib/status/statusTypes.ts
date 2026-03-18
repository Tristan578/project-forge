/**
 * Status page data model for SpawnForge service monitoring.
 *
 * These types are shared between the public status API route and any
 * client-side status page components. They are intentionally decoupled
 * from the internal health check types in lib/monitoring/healthChecks.ts
 * so that the public contract can evolve independently.
 */

/** Operational state of a single service as reported on the status page. */
export type ServiceStatus = 'operational' | 'degraded' | 'outage' | 'maintenance';

/** Severity level of an active incident. */
export type IncidentSeverity = 'p0' | 'p1' | 'p2';

/** Lifecycle state of an incident. */
export type IncidentState = 'investigating' | 'identified' | 'monitoring' | 'resolved';

/** Operational state of the overall platform. */
export type OverallStatus = 'operational' | 'partial_outage' | 'major_outage' | 'maintenance';

/**
 * Current status of a single monitored service.
 * Returned as part of the public /api/status response.
 */
export interface ServiceStatusEntry {
  /** Stable machine-readable identifier for the service (e.g. "database"). */
  id: string;
  /** Human-readable display name (e.g. "Database"). */
  name: string;
  /** Current operational status. */
  status: ServiceStatus;
  /** ISO 8601 timestamp of the most recent health check for this service. */
  lastCheckedAt: string;
  /**
   * Round-trip latency of the health check in milliseconds.
   * 0 for config-only checks that do not make network calls.
   */
  latencyMs: number;
}

/**
 * A single chronological update posted during an incident.
 */
export interface StatusUpdate {
  /** ISO 8601 timestamp when this update was posted. */
  postedAt: string;
  /** Current incident state at the time of this update. */
  state: IncidentState;
  /** Human-readable update body (plain text). */
  message: string;
}

/**
 * An active or historical incident affecting one or more services.
 */
export interface Incident {
  /** Unique incident identifier (e.g. "INC-20260316-001"). */
  id: string;
  /** Short human-readable title. */
  title: string;
  /** Current lifecycle state of the incident. */
  state: IncidentState;
  /** Severity level. */
  severity: IncidentSeverity;
  /** Service IDs affected by this incident. */
  affectedServices: string[];
  /** ISO 8601 timestamp when the incident was first detected. */
  detectedAt: string;
  /** ISO 8601 timestamp when the incident was resolved. Null if still active. */
  resolvedAt: string | null;
  /** Ordered list of status updates, most recent last. */
  updates: StatusUpdate[];
}

/**
 * Full status page payload returned by GET /api/status.
 */
export interface StatusPagePayload {
  /** ISO 8601 timestamp when this payload was generated. */
  generatedAt: string;
  /** Overall platform status derived from all service statuses. */
  overall: OverallStatus;
  /** Per-service status entries. */
  services: ServiceStatusEntry[];
  /** Active incidents (state !== 'resolved'). Empty array if none. */
  activeIncidents: Incident[];
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

/**
 * Map an internal health check status to a public ServiceStatus.
 * Internal: 'healthy' | 'degraded' | 'down'
 * Public:   'operational' | 'degraded' | 'outage'
 */
export function mapHealthStatusToServiceStatus(
  status: 'healthy' | 'degraded' | 'down',
): ServiceStatus {
  switch (status) {
    case 'healthy':
      return 'operational';
    case 'degraded':
      return 'degraded';
    case 'down':
      return 'outage';
  }
}

/**
 * Derive the overall platform status from the list of service statuses.
 *
 * When `criticalServiceIds` is provided, only outages on critical services
 * result in `major_outage`. Outages on non-critical services are treated as
 * `partial_outage`. When omitted, all outages are treated as `major_outage`
 * (legacy behaviour).
 */
export function deriveOverallStatus(
  services: ServiceStatusEntry[],
  criticalServiceIds?: ReadonlySet<string>,
): OverallStatus {
  let hasCriticalOutage = false;
  let hasNonCriticalOutage = false;
  let hasDegraded = false;
  let hasMaintenance = false;

  for (const s of services) {
    switch (s.status) {
      case 'outage':
        if (!criticalServiceIds || criticalServiceIds.has(s.id)) {
          hasCriticalOutage = true;
        } else {
          hasNonCriticalOutage = true;
        }
        break;
      case 'degraded':
        hasDegraded = true;
        break;
      case 'maintenance':
        hasMaintenance = true;
        break;
    }
  }

  if (hasCriticalOutage) return 'major_outage';
  if (hasNonCriticalOutage || hasDegraded) return 'partial_outage';
  if (hasMaintenance) return 'maintenance';
  return 'operational';
}
