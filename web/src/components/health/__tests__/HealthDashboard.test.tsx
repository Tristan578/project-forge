import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@/test/utils/componentTestUtils';
import { HealthDashboard } from '../HealthDashboard';
import type { HealthReport, ServiceHealth } from '@/lib/monitoring/healthChecks';

function makeService(
  name: string,
  status: ServiceHealth['status'],
  overrides: Partial<ServiceHealth> = {},
): ServiceHealth {
  return {
    name,
    status,
    latencyMs: status === 'healthy' ? 12 : 0,
    lastChecked: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeReport(
  overall: HealthReport['overall'],
  services: ServiceHealth[] = [],
): HealthReport {
  return {
    overall,
    timestamp: '2026-01-01T00:00:00.000Z',
    services,
    environment: 'test',
    version: 'abcdef12',
  };
}

const allHealthyServices: ServiceHealth[] = [
  makeService('Database (Neon)', 'healthy'),
  makeService('Authentication (Clerk)', 'healthy'),
  makeService('Payments (Stripe)', 'healthy'),
  makeService('Error Tracking (Sentry)', 'healthy'),
  makeService('Asset Storage (R2)', 'healthy'),
  makeService('Rate Limiting (Upstash)', 'healthy'),
  makeService('Engine CDN', 'healthy'),
  makeService('AI Providers', 'healthy'),
];

describe('HealthDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the overall banner for all-healthy report', () => {
    const report = makeReport('healthy', allHealthyServices);
    render(<HealthDashboard initialReport={report} />);

    expect(screen.getByText('All Systems Operational')).toBeDefined();
  });

  it('renders the degraded banner when overall is degraded', () => {
    const services = [
      ...allHealthyServices.slice(0, 7),
      makeService('AI Providers', 'degraded', {
        error: 'Missing providers: suno',
      }),
    ];
    const report = makeReport('degraded', services);
    render(<HealthDashboard initialReport={report} />);

    expect(screen.getByText('Partial Service Disruption')).toBeDefined();
  });

  it('renders the down banner when overall is down', () => {
    const services = [
      makeService('Database (Neon)', 'down', { error: 'DATABASE_URL not configured' }),
      ...allHealthyServices.slice(1),
    ];
    const report = makeReport('down', services);
    render(<HealthDashboard initialReport={report} />);

    expect(screen.getByText('Major Outage Detected')).toBeDefined();
  });

  it('renders a card for each service', () => {
    const report = makeReport('healthy', allHealthyServices);
    const { container } = render(<HealthDashboard initialReport={report} />);

    const grid = container.querySelector('[data-testid="service-grid"]');
    // 8 service cards should be present
    expect(grid?.children).toHaveLength(8);
  });

  it('displays the service name in each card', () => {
    const report = makeReport('healthy', allHealthyServices);
    render(<HealthDashboard initialReport={report} />);

    expect(screen.getByText('Database (Neon)')).toBeDefined();
    expect(screen.getByText('Authentication (Clerk)')).toBeDefined();
    expect(screen.getByText('Engine CDN')).toBeDefined();
  });

  it('shows error message for degraded service', () => {
    const services = [
      makeService('AI Providers', 'degraded', {
        error: 'Missing providers: suno, meshy',
      }),
    ];
    const report = makeReport('degraded', services);
    render(<HealthDashboard initialReport={report} />);

    expect(screen.getByText('Missing providers: suno, meshy')).toBeDefined();
  });

  it('shows error message for down service', () => {
    const services = [
      makeService('Database (Neon)', 'down', { error: 'DATABASE_URL not configured' }),
    ];
    const report = makeReport('down', services);
    render(<HealthDashboard initialReport={report} />);

    expect(screen.getByText('DATABASE_URL not configured')).toBeDefined();
  });

  it('displays environment and version in the banner', () => {
    const report = makeReport('healthy', allHealthyServices);
    render(<HealthDashboard initialReport={report} />);

    // Both "test" and "abcdef12" should appear
    expect(screen.getByText(/test/)).toBeDefined();
    expect(screen.getByText(/abcdef12/)).toBeDefined();
  });

  it('shows a refresh button', () => {
    const report = makeReport('healthy', allHealthyServices);
    render(<HealthDashboard initialReport={report} />);

    expect(screen.getByRole('button', { name: /refresh/i })).toBeDefined();
  });

  it('shows auto-refresh countdown', () => {
    const report = makeReport('healthy', allHealthyServices);
    render(<HealthDashboard initialReport={report} />);

    // Countdown text appears (shows "Refreshes in Xs")
    expect(screen.getByText(/refreshes in/i)).toBeDefined();
  });

  it('calls /api/health when refresh button is clicked', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeReport('healthy', allHealthyServices),
    });
    vi.stubGlobal('fetch', mockFetch);

    const report = makeReport('healthy', allHealthyServices);
    render(<HealthDashboard initialReport={report} />);

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    refreshBtn.click();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/health', expect.any(Object));
    });
  });

  it('updates report data after successful refresh', async () => {
    const degradedReport = makeReport('degraded', [
      makeService('Database (Neon)', 'degraded', { error: 'slow query' }),
    ]);

    const healthyReport = makeReport('healthy', allHealthyServices);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => healthyReport,
    });
    vi.stubGlobal('fetch', mockFetch);

    render(<HealthDashboard initialReport={degradedReport} />);

    // Initially shows degraded
    expect(screen.getByText('Partial Service Disruption')).toBeDefined();

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    refreshBtn.click();

    await waitFor(() => {
      expect(screen.getByText('All Systems Operational')).toBeDefined();
    });
  });

  it('does not crash when fetch fails during refresh', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('network error'));
    vi.stubGlobal('fetch', mockFetch);

    const report = makeReport('healthy', allHealthyServices);
    render(<HealthDashboard initialReport={report} />);

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    refreshBtn.click();

    // Should not throw — stale data should remain
    await waitFor(() => {
      expect(screen.getByText('All Systems Operational')).toBeDefined();
    });
  });
});
