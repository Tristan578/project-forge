import { describe, it, expect } from 'vitest';
import {
  mapHealthStatusToServiceStatus,
  deriveOverallStatus,
  type ServiceStatusEntry,
} from '../statusTypes';

// ---------------------------------------------------------------------------
// mapHealthStatusToServiceStatus
// ---------------------------------------------------------------------------

describe('mapHealthStatusToServiceStatus', () => {
  it('maps healthy to operational', () => {
    expect(mapHealthStatusToServiceStatus('healthy')).toBe('operational');
  });

  it('maps degraded to degraded', () => {
    expect(mapHealthStatusToServiceStatus('degraded')).toBe('degraded');
  });

  it('maps down to outage', () => {
    expect(mapHealthStatusToServiceStatus('down')).toBe('outage');
  });
});

// ---------------------------------------------------------------------------
// deriveOverallStatus
// ---------------------------------------------------------------------------

function makeEntry(
  id: string,
  status: ServiceStatusEntry['status'],
  critical = false,
): ServiceStatusEntry {
  return {
    id,
    name: id,
    status,
    lastCheckedAt: '2026-03-16T12:00:00.000Z',
    latencyMs: 0,
    critical,
  };
}

/** Critical service IDs matching statusConfig.ts */
const CRITICAL = new Set(['app', 'database', 'auth']);

describe('deriveOverallStatus', () => {
  // -----------------------------------------------------------------------
  // Legacy behaviour (no criticalServiceIds supplied)
  // -----------------------------------------------------------------------
  describe('without criticalServiceIds (legacy)', () => {
    it('returns operational when all services are operational', () => {
      const services = [
        makeEntry('db', 'operational'),
        makeEntry('auth', 'operational'),
        makeEntry('ai', 'operational'),
      ];
      expect(deriveOverallStatus(services)).toBe('operational');
    });

    it('returns partial_outage when at least one service is degraded', () => {
      const services = [
        makeEntry('db', 'operational'),
        makeEntry('auth', 'degraded'),
        makeEntry('ai', 'operational'),
      ];
      expect(deriveOverallStatus(services)).toBe('partial_outage');
    });

    it('returns major_outage when at least one service is outage', () => {
      const services = [
        makeEntry('db', 'outage'),
        makeEntry('auth', 'operational'),
        makeEntry('ai', 'operational'),
      ];
      expect(deriveOverallStatus(services)).toBe('major_outage');
    });

    it('returns major_outage even when other services are only degraded', () => {
      const services = [
        makeEntry('db', 'outage'),
        makeEntry('auth', 'degraded'),
        makeEntry('ai', 'degraded'),
      ];
      expect(deriveOverallStatus(services)).toBe('major_outage');
    });

    it('returns maintenance when any service is in maintenance (and none outage or degraded)', () => {
      const services = [
        makeEntry('db', 'operational'),
        makeEntry('auth', 'maintenance'),
        makeEntry('ai', 'operational'),
      ];
      expect(deriveOverallStatus(services)).toBe('maintenance');
    });

    it('major_outage takes precedence over maintenance', () => {
      const services = [
        makeEntry('db', 'outage'),
        makeEntry('auth', 'maintenance'),
      ];
      expect(deriveOverallStatus(services)).toBe('major_outage');
    });

    it('partial_outage takes precedence over maintenance', () => {
      const services = [
        makeEntry('db', 'degraded'),
        makeEntry('auth', 'maintenance'),
      ];
      expect(deriveOverallStatus(services)).toBe('partial_outage');
    });

    it('returns operational for an empty service list', () => {
      expect(deriveOverallStatus([])).toBe('operational');
    });

    it('returns operational for a single operational service', () => {
      expect(deriveOverallStatus([makeEntry('db', 'operational')])).toBe('operational');
    });

    it('returns major_outage for a single outage service', () => {
      expect(deriveOverallStatus([makeEntry('db', 'outage')])).toBe('major_outage');
    });
  });

  // -----------------------------------------------------------------------
  // With criticalServiceIds — PF-740 fix
  // -----------------------------------------------------------------------
  describe('with criticalServiceIds', () => {
    it('returns major_outage when a critical service is down', () => {
      const services = [
        makeEntry('app', 'operational'),
        makeEntry('database', 'outage'),
        makeEntry('ai', 'operational'),
      ];
      expect(deriveOverallStatus(services, CRITICAL)).toBe('major_outage');
    });

    it('returns partial_outage when only non-critical services are down', () => {
      const services = [
        makeEntry('app', 'operational'),
        makeEntry('database', 'operational'),
        makeEntry('auth', 'operational'),
        makeEntry('ai', 'outage'),
        makeEntry('payments', 'outage'),
      ];
      expect(deriveOverallStatus(services, CRITICAL)).toBe('partial_outage');
    });

    it('returns major_outage when both critical and non-critical services are down', () => {
      const services = [
        makeEntry('app', 'outage'),
        makeEntry('ai', 'outage'),
      ];
      expect(deriveOverallStatus(services, CRITICAL)).toBe('major_outage');
    });

    it('returns partial_outage for non-critical outage even with degraded services', () => {
      const services = [
        makeEntry('app', 'degraded'),
        makeEntry('ai', 'outage'),
      ];
      expect(deriveOverallStatus(services, CRITICAL)).toBe('partial_outage');
    });

    it('returns partial_outage for degraded critical service (not outage)', () => {
      const services = [
        makeEntry('database', 'degraded'),
        makeEntry('ai', 'operational'),
      ];
      expect(deriveOverallStatus(services, CRITICAL)).toBe('partial_outage');
    });

    it('returns maintenance when no outage or degraded, only maintenance', () => {
      const services = [
        makeEntry('app', 'operational'),
        makeEntry('payments', 'maintenance'),
      ];
      expect(deriveOverallStatus(services, CRITICAL)).toBe('maintenance');
    });

    it('non-critical outage takes precedence over maintenance', () => {
      const services = [
        makeEntry('ai', 'outage'),
        makeEntry('auth', 'maintenance'),
      ];
      expect(deriveOverallStatus(services, CRITICAL)).toBe('partial_outage');
    });

    it('returns operational when all services are operational', () => {
      const services = [
        makeEntry('app', 'operational'),
        makeEntry('database', 'operational'),
        makeEntry('ai', 'operational'),
      ];
      expect(deriveOverallStatus(services, CRITICAL)).toBe('operational');
    });

    it('returns operational for empty service list', () => {
      expect(deriveOverallStatus([], CRITICAL)).toBe('operational');
    });
  });

  // -----------------------------------------------------------------------
  // ServiceStatusEntry.critical field — regression for #7608
  //
  // The critical field is added to ServiceStatusEntry so API consumers can
  // display criticality badges. It does NOT affect derivation — only the
  // explicit criticalServiceIds set does.
  // -----------------------------------------------------------------------
  describe('ServiceStatusEntry.critical field is informational only (regression for #7608)', () => {
    it('exposes the critical flag on entries for API consumers', () => {
      // Verify the field is serialisable on the entry type
      const entry = makeEntry('database', 'operational', true);
      expect(entry.critical).toBe(true);

      const nonCritical = makeEntry('ai', 'operational', false);
      expect(nonCritical.critical).toBe(false);
    });

    it('critical=true entry in outage → still major_outage (legacy path, no set)', () => {
      // Without criticalServiceIds: all outages are major_outage regardless of the field
      const services = [makeEntry('database', 'outage', true)];
      expect(deriveOverallStatus(services)).toBe('major_outage');
    });

    it('critical=false entry in outage → still major_outage (legacy path, no set)', () => {
      // Without criticalServiceIds: all outages remain major_outage even when
      // the entry says critical=false — legacy behaviour is preserved.
      const services = [makeEntry('ai', 'outage', false)];
      expect(deriveOverallStatus(services)).toBe('major_outage');
    });

    it('correctly routes critical vs non-critical when criticalServiceIds is provided', () => {
      const CRIT = new Set(['database']);
      const services = [
        makeEntry('database', 'outage', true),
        makeEntry('ai', 'operational', false),
      ];
      expect(deriveOverallStatus(services, CRIT)).toBe('major_outage');
    });

    it('correctly routes non-critical to partial_outage when criticalServiceIds is provided', () => {
      const CRIT = new Set(['database']);
      const services = [
        makeEntry('database', 'operational', true),
        makeEntry('ai', 'outage', false),
      ];
      expect(deriveOverallStatus(services, CRIT)).toBe('partial_outage');
    });
  });
});
