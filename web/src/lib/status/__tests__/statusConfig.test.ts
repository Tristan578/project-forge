import { describe, it, expect } from 'vitest';
import {
  MONITORED_SERVICES,
  findServiceByHealthCheckName,
  findServiceById,
} from '../statusConfig';

describe('MONITORED_SERVICES', () => {
  it('is a non-empty array', () => {
    expect(MONITORED_SERVICES.length).toBeGreaterThan(0);
  });

  it('each entry has required fields', () => {
    for (const service of MONITORED_SERVICES) {
      expect(typeof service.id).toBe('string');
      expect(service.id.length).toBeGreaterThan(0);
      expect(typeof service.displayName).toBe('string');
      expect(service.displayName.length).toBeGreaterThan(0);
      expect(typeof service.healthCheckName).toBe('string');
      expect(service.healthCheckName.length).toBeGreaterThan(0);
      expect(typeof service.description).toBe('string');
      expect(typeof service.critical).toBe('boolean');
    }
  });

  it('all service IDs are unique', () => {
    const ids = MONITORED_SERVICES.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all healthCheckNames are unique', () => {
    const names = MONITORED_SERVICES.map((s) => s.healthCheckName);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  it('includes critical services: database and auth', () => {
    const db = MONITORED_SERVICES.find((s) => s.id === 'database');
    const auth = MONITORED_SERVICES.find((s) => s.id === 'auth');
    expect(db?.critical).toBe(true);
    expect(auth?.critical).toBe(true);
  });

  it('at least one service is non-critical', () => {
    const nonCritical = MONITORED_SERVICES.filter((s) => !s.critical);
    expect(nonCritical.length).toBeGreaterThan(0);
  });
});

describe('findServiceByHealthCheckName', () => {
  it('returns the matching service config', () => {
    const result = findServiceByHealthCheckName('Database (Neon)');
    expect(result).toBeDefined();
    expect(result?.id).toBe('database');
  });

  it('returns undefined for an unknown health check name', () => {
    const result = findServiceByHealthCheckName('Unknown Service (XYZ)');
    expect(result).toBeUndefined();
  });

  it('returns correct config for Clerk health check name', () => {
    const result = findServiceByHealthCheckName('Clerk');
    expect(result).toBeDefined();
    expect(result?.id).toBe('auth');
    expect(result?.critical).toBe(true);
  });

  it('returns correct config for Engine CDN', () => {
    const result = findServiceByHealthCheckName('Engine CDN');
    expect(result).toBeDefined();
    expect(result?.id).toBe('engine_cdn');
  });
});

describe('findServiceById', () => {
  it('returns the matching service config', () => {
    const result = findServiceById('database');
    expect(result).toBeDefined();
    expect(result?.healthCheckName).toBe('Database (Neon)');
  });

  it('returns undefined for an unknown ID', () => {
    const result = findServiceById('nonexistent_service');
    expect(result).toBeUndefined();
  });

  it('returns correct config for auth', () => {
    const result = findServiceById('auth');
    expect(result).toBeDefined();
    expect(result?.healthCheckName).toBe('Clerk');
    expect(result?.critical).toBe(true);
  });

  it('returns correct config for ai', () => {
    const result = findServiceById('ai');
    expect(result).toBeDefined();
    expect(result?.critical).toBe(false);
  });
});
