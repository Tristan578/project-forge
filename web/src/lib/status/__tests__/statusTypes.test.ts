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

function makeEntry(id: string, status: ServiceStatusEntry['status']): ServiceStatusEntry {
  return {
    id,
    name: id,
    status,
    lastCheckedAt: '2026-03-16T12:00:00.000Z',
    latencyMs: 0,
  };
}

describe('deriveOverallStatus', () => {
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
