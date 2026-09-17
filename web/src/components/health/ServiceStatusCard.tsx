import { cn } from '@spawnforge/ui';
import type { ServiceHealth } from '@/lib/monitoring/healthChecks';

interface ServiceStatusCardProps {
  service: ServiceHealth;
}

function statusColor(status: ServiceHealth['status']): string {
  switch (status) {
    case 'healthy':
      return 'bg-[var(--sf-status-healthy-indicator)]';
    case 'degraded':
      return 'bg-[var(--sf-status-degraded-indicator)]';
    case 'down':
      return 'bg-[var(--sf-status-down-indicator)]';
    default:
      return 'bg-[var(--sf-status-unknown-indicator)]';
  }
}

function statusLabel(status: ServiceHealth['status']): string {
  switch (status) {
    case 'healthy':
      return 'Healthy';
    case 'degraded':
      return 'Degraded';
    case 'down':
      return 'Down';
    default:
      return 'Unknown';
  }
}

function statusTextColor(status: ServiceHealth['status']): string {
  switch (status) {
    case 'healthy':
      return 'text-[var(--sf-status-healthy-indicator)]';
    case 'degraded':
      return 'text-[var(--sf-status-degraded-indicator)]';
    case 'down':
      return 'text-[var(--sf-status-down-indicator)]';
    default:
      return 'text-[var(--sf-status-unknown-indicator)]';
  }
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

export function ServiceStatusCard({ service }: ServiceStatusCardProps) {
  return (
    <div className="rounded-[var(--sf-radius-lg)] border border-[var(--sf-border)] bg-[var(--sf-bg-surface)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn('mt-0.5 h-3 w-3 flex-shrink-0 rounded-full', statusColor(service.status))}
            data-testid="service-status-indicator"
            aria-hidden="true"
          />
          <h3 className="text-sm font-medium text-[var(--sf-text)]">{service.name}</h3>
        </div>
        <span className={cn('text-xs font-semibold', statusTextColor(service.status))}>
          {statusLabel(service.status)}
        </span>
      </div>

      <div className="mt-3 space-y-1 text-xs text-[var(--sf-text-secondary)]">
        {service.latencyMs > 0 && (
          <p>
            <span className="font-medium text-[var(--sf-text)]">Latency:</span> {service.latencyMs}ms
          </p>
        )}
        <p>
          <span className="font-medium text-[var(--sf-text)]">Last checked:</span>{' '}
          {formatTimestamp(service.lastChecked)}
        </p>
        {/*
          One emphasised message, and it is the one that says something.
          `summary` is the probe's public-safe "what is wrong"; `error` on this
          dashboard has been through `sanitizeForPublic`, so it reads
          "<name> is <status>" — a verbatim repeat of the badge above. Showing
          both put the emphasis on the empty one and styled the substantive one
          as a footnote (#9727 review). With no summary, the error keeps
          today's rendering: it is then the only line there is.
        */}
        {service.summary ? (
          <p data-testid="service-status-message" className="mt-2 rounded bg-[var(--sf-bg-elevated)] px-2 py-1 text-[var(--sf-text)]">{service.summary}</p>
        ) : (
          service.error && (
            <p data-testid="service-status-message" className="mt-2 rounded bg-[var(--sf-bg-elevated)] px-2 py-1 text-[var(--sf-text)]">{service.error}</p>
          )
        )}
      </div>
    </div>
  );
}
