'use client';

import { AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export type ErrorSeverity = 'error' | 'warning' | 'info';
export type ErrorVariant = 'inline' | 'banner' | 'card';

export interface ErrorAction {
  label: string;
  onClick: () => void;
}

export interface ErrorDisplayProps {
  /** Visual layout of the error */
  variant: ErrorVariant;
  /** Short, plain-English title (≤ 8 words). Not shown for `inline` variant. */
  title?: string;
  /** One-sentence explanation with a suggested next step */
  message: string;
  /** Optional primary action button */
  action?: ErrorAction;
  /** Callback for the dismiss (×) button. If omitted, no dismiss button is shown. */
  onDismiss?: () => void;
  /** Visual severity level — controls icon and colour */
  severity?: ErrorSeverity;
}

// ─── Colour maps (zinc-based scale to match editor palette) ──────────────────

const severityBorderClass: Record<ErrorSeverity, string> = {
  error: 'border-red-500/40',
  warning: 'border-yellow-500/40',
  info: 'border-blue-500/40',
};

const severityBgClass: Record<ErrorSeverity, string> = {
  error: 'bg-red-500/10',
  warning: 'bg-yellow-500/10',
  info: 'bg-blue-500/10',
};

const severityTextClass: Record<ErrorSeverity, string> = {
  error: 'text-red-400',
  warning: 'text-yellow-400',
  info: 'text-blue-400',
};

const severityButtonClass: Record<ErrorSeverity, string> = {
  error: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
  warning: 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500',
  info: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
};

function SeverityIcon({ severity, className }: { severity: ErrorSeverity; className?: string }) {
  const cls = className ?? 'h-4 w-4';
  if (severity === 'warning') return <AlertTriangle className={cls} aria-hidden="true" />;
  if (severity === 'info') return <Info className={cls} aria-hidden="true" />;
  return <AlertCircle className={cls} aria-hidden="true" />;
}

// ─── Inline variant ───────────────────────────────────────────────────────────
// Used beneath form fields to show validation errors.

function InlineError({ message, severity = 'error' }: ErrorDisplayProps) {
  return (
    <p
      role="alert"
      aria-live="polite"
      className={`flex items-center gap-1.5 text-xs ${severityTextClass[severity]}`}
    >
      <SeverityIcon severity={severity} className="h-3 w-3 shrink-0" />
      <span>{message}</span>
    </p>
  );
}

// ─── Banner variant ───────────────────────────────────────────────────────────
// Full-width notification bar, typically rendered at the top of a panel.

function BannerError({
  title,
  message,
  action,
  onDismiss,
  severity = 'error',
}: ErrorDisplayProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex items-start gap-3 border-b px-4 py-3 ${severityBgClass[severity]} ${severityBorderClass[severity]}`}
    >
      <SeverityIcon severity={severity} className={`mt-0.5 h-4 w-4 shrink-0 ${severityTextClass[severity]}`} />
      <div className="flex-1 min-w-0">
        {title && (
          <p className={`text-sm font-semibold ${severityTextClass[severity]}`}>{title}</p>
        )}
        <p className="text-sm text-zinc-300">{message}</p>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className={`mt-1.5 rounded px-3 py-1 text-xs font-medium text-white transition-colors focus:outline-none focus:ring-2 ${severityButtonClass[severity]}`}
          >
            {action.label}
          </button>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded p-0.5 text-zinc-500 transition-colors hover:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-500"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// ─── Card variant ─────────────────────────────────────────────────────────────
// Centred error card, used for full-panel or full-page error states.

function CardError({
  title,
  message,
  action,
  onDismiss,
  severity = 'error',
}: ErrorDisplayProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex flex-col items-center gap-4 rounded-lg border p-6 text-center ${severityBgClass[severity]} ${severityBorderClass[severity]}`}
    >
      <SeverityIcon severity={severity} className={`h-10 w-10 ${severityTextClass[severity]}`} />
      {title && (
        <h2 className="text-base font-semibold text-white">{title}</h2>
      )}
      <p className="max-w-xs text-sm text-zinc-300">{message}</p>
      <div className="flex flex-col gap-2 w-full max-w-[200px]">
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className={`rounded px-4 py-2 text-sm font-medium text-white transition-colors focus:outline-none focus:ring-2 ${severityButtonClass[severity]}`}
          >
            {action.label}
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded bg-zinc-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-500"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

/**
 * Reusable error display component for SpawnForge.
 *
 * Three variants:
 * - `inline` — small text beneath a form field (validation errors)
 * - `banner` — full-width bar at the top of a panel (async operation failures)
 * - `card`   — centred card with icon (full-panel / full-page error states)
 *
 * Every variant:
 * - Never shows raw error codes or technical jargon
 * - Always suggests a next step via the `message` prop
 * - Supports an optional primary action button and a dismiss button
 * - Uses the `zinc-*` colour scale and severity-based accent colours
 *
 * @example
 * <ErrorDisplay
 *   variant="banner"
 *   severity="error"
 *   title="Connection lost"
 *   message="Check your internet connection and try again."
 *   action={{ label: 'Try again', onClick: handleRetry }}
 *   onDismiss={handleDismiss}
 * />
 */
export function ErrorDisplay(props: ErrorDisplayProps) {
  const { variant } = props;

  if (variant === 'inline') return <InlineError {...props} />;
  if (variant === 'banner') return <BannerError {...props} />;
  return <CardError {...props} />;
}
