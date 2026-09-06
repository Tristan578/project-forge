/**
 * Tests for ServiceStatusCard component.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { ServiceStatusCard } from '../ServiceStatusCard';

// healthChecks.ts imports 'server-only' — define the type locally to avoid that import.
interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  latencyMs: number;
  lastChecked: string;
  error?: string;
  summary?: string;
  details?: Record<string, unknown>;
}

function makeService(overrides: Partial<ServiceHealth> = {}): ServiceHealth {
  return {
    name: 'Test Service',
    status: 'healthy',
    latencyMs: 42,
    lastChecked: new Date('2025-01-01T12:00:00Z').toISOString(),
    error: undefined,
    ...overrides,
  };
}

describe('ServiceStatusCard', () => {
  afterEach(() => cleanup());

  // ── Basic rendering ────────────────────────────────────────────────────

  it('renders the service name', () => {
    render(<ServiceStatusCard service={makeService({ name: 'Database' })} />);
    expect(screen.getByText('Database')).toBeDefined();
  });

  // ── Status variants ────────────────────────────────────────────────────

  it('shows "Healthy" label for healthy status', () => {
    render(<ServiceStatusCard service={makeService({ status: 'healthy' })} />);
    expect(screen.getByText('Healthy')).toBeDefined();
  });

  it('shows "Degraded" label for degraded status', () => {
    render(<ServiceStatusCard service={makeService({ status: 'degraded' })} />);
    expect(screen.getByText('Degraded')).toBeDefined();
  });

  it('shows "Down" label for down status', () => {
    render(<ServiceStatusCard service={makeService({ status: 'down' })} />);
    expect(screen.getByText('Down')).toBeDefined();
  });

  // ── Latency ────────────────────────────────────────────────────────────

  it('displays latency when greater than 0', () => {
    render(<ServiceStatusCard service={makeService({ latencyMs: 123 })} />);
    const { container } = render(<ServiceStatusCard service={makeService({ latencyMs: 123 })} />);
    expect(container.textContent).toContain('123ms');
  });

  it('does not display latency row when latencyMs is 0', () => {
    const { container } = render(<ServiceStatusCard service={makeService({ latencyMs: 0 })} />);
    expect(container.textContent).not.toContain('ms');
  });

  // ── Error message ──────────────────────────────────────────────────────

  // #9719/#9727: `summary` is the one field that survives `sanitizeForPublic`,
  // so on the public dashboard it is the ONLY thing that says WHAT is wrong.
  // A card that renders `error` alone shows a bare "Degraded" there.
  it('renders the public-safe summary when the service carries one', () => {
    render(
      <ServiceStatusCard
        service={makeService({
          status: 'degraded',
          summary: 'Available only with your own API key: 3D Model Generation',
        })}
      />,
    );
    expect(
      screen.getByText('Available only with your own API key: 3D Model Generation'),
    ).toBeDefined();
  });

  // #9727 review: on the public dashboard `error` has already been through
  // `sanitizeForPublic`, so it always reads "<name> is <status>" — a verbatim
  // repeat of the badge. Rendering that in the emphasised box above the
  // substantive line put the emphasis on the one element carrying no
  // information. The summary takes the box; the sanitized echo is dropped.
  it('gives the summary the emphasis and suppresses the sanitized error echo', () => {
    const { container } = render(
      <ServiceStatusCard
        service={makeService({
          name: 'AI Providers',
          status: 'degraded',
          summary: 'Available only with your own API key: 3D Model Generation',
          error: 'AI Providers is degraded',
        })}
      />,
    );
    const box = container.querySelector('.bg-zinc-700');
    expect(box).not.toBeNull();
    expect(box?.textContent).toBe('Available only with your own API key: 3D Model Generation');
    expect(screen.queryByText('AI Providers is degraded')).toBeNull();
  });

  it('still shows the error when the service carries no summary', () => {
    const { container } = render(
      <ServiceStatusCard
        service={makeService({ status: 'down', error: 'Payments (Stripe) is down' })}
      />,
    );
    expect(container.querySelector('.bg-zinc-700')?.textContent).toBe('Payments (Stripe) is down');
  });

  it('shows error message when service has error', () => {
    render(
      <ServiceStatusCard service={makeService({ status: 'down', error: 'Connection refused' })} />
    );
    expect(screen.getByText('Connection refused')).toBeDefined();
  });

  it('does not show error block when no error', () => {
    const { container } = render(<ServiceStatusCard service={makeService({ error: undefined })} />);
    // The only possible error message would be some kind of error-styled block
    expect(container.querySelector('.bg-zinc-700')).toBeNull();
  });

  // ── Timestamp ──────────────────────────────────────────────────────────

  it('shows last-checked timestamp', () => {
    const { container } = render(<ServiceStatusCard service={makeService()} />);
    expect(container.textContent).toContain('Last checked');
  });

  // ── Color helpers (indirectly via DOM) ────────────────────────────────

  it('applies green indicator for healthy status', () => {
    const { container } = render(<ServiceStatusCard service={makeService({ status: 'healthy' })} />);
    const indicator = container.querySelector('.bg-green-500');
    expect(indicator).not.toBeNull();
  });

  it('applies yellow indicator for degraded status', () => {
    const { container } = render(
      <ServiceStatusCard service={makeService({ status: 'degraded' })} />
    );
    expect(container.querySelector('.bg-yellow-500')).not.toBeNull();
  });

  it('applies red indicator for down status', () => {
    const { container } = render(<ServiceStatusCard service={makeService({ status: 'down' })} />);
    expect(container.querySelector('.bg-red-500')).not.toBeNull();
  });
});
