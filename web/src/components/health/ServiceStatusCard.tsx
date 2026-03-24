import type { ServiceHealth } from '@/lib/monitoring/healthChecks';

interface ServiceStatusCardProps {
  service: ServiceHealth;
}

function statusColor(status: ServiceHealth['status']): string {
  switch (status) {
    case 'healthy':
      return 'bg-green-500';
    case 'degraded':
      return 'bg-yellow-500';
    case 'down':
      return 'bg-red-500';
    default:
      return 'bg-zinc-500';
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
      return 'text-green-500';
    case 'degraded':
      return 'text-yellow-500';
    case 'down':
      return 'text-red-500';
    default:
      return 'text-zinc-400';
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
    <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`mt-0.5 h-3 w-3 flex-shrink-0 rounded-full ${statusColor(service.status)}`}
            aria-hidden="true"
          />
          <h3 className="text-sm font-medium text-zinc-100">{service.name}</h3>
        </div>
        <span className={`text-xs font-semibold ${statusTextColor(service.status)}`}>
          {statusLabel(service.status)}
        </span>
      </div>

      <div className="mt-3 space-y-1 text-xs text-zinc-400">
        {service.latencyMs > 0 && (
          <p>
            <span className="font-medium text-zinc-300">Latency:</span> {service.latencyMs}ms
          </p>
        )}
        <p>
          <span className="font-medium text-zinc-300">Last checked:</span>{' '}
          {formatTimestamp(service.lastChecked)}
        </p>
        {service.error && (
          <p className="mt-2 rounded bg-zinc-700 px-2 py-1 text-zinc-300">{service.error}</p>
        )}
      </div>
    </div>
  );
}
