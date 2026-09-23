import React, { useCallback, useId, useState } from 'react';
import { Button, InlineAlert, Input, Label, Progress, Select, cn } from '@spawnforge/ui';
import { usePerformanceStore } from '@/stores/performanceStore';
import { UNKNOWN } from '@/lib/config/measurementManifest';
import { DEFAULT_DEVICE_PROFILE_KEY, DEVICE_PROFILE_KEYS } from '@/lib/perf/deviceProfiles';
import {
  cancelPerformanceCapture,
  comparePerformanceReports,
  setPerformanceBaseline,
  startPerformanceCapture,
} from '@/lib/perf/editorCapture';
import { reportFileName, serializeReport, type BudgetResult, type PerformanceReport } from '@/lib/perf/performanceReport';

/**
 * Manual controls for the timed, manifest-pinned performance capture
 * (#9904 / #10013, operation performance.FR-3.OP-01).
 *
 * Every control calls the same `lib/perf/editorCapture` function the in-app AI
 * tool of the same purpose calls, with the same arguments, and shows the
 * error text that function returns — manual/AI parity by construction. The
 * inputs are deliberately free-form numbers so an out-of-range value reaches
 * the shared validator instead of being clamped away by the UI.
 *
 * Built from the @spawnforge/ui primitives and coloured only through
 * `var(--sf-*)` tokens, so it follows every theme. It sits on the
 * `--sf-bg-surface` the host PerformanceProfiler paints.
 */

const PHASE_LABELS: Record<string, string> = {
  'reading-scene': 'Reading scene identity',
  warmup: 'Warming up',
  capturing: 'Capturing',
  'building-report': 'Building report',
};

/** `12.3 ms`, or `unknown` — never a 0 standing in for "not measured". */
function ms(value: number | typeof UNKNOWN): string {
  return value === UNKNOWN ? 'unknown' : `${Math.round(value * 100) / 100} ms`;
}

/** Render a manifest value (string, number or object) for a difference list. */
function show(value: unknown): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

function mb(value: number | typeof UNKNOWN): string {
  return value === UNKNOWN ? 'unknown' : `${value} MB`;
}

/**
 * Budget and verdict colours. The `--sf-status-*-indicator` tokens are the
 * theme's foregrounds for unfilled status text, and every one of them is
 * pinned at >= 4.5:1 on `--sf-bg-surface` in all seven themes
 * (packages/ui/src/tokens/__tests__/themes.test.ts) — the surface the host
 * PerformanceProfiler paints. `not_applicable` is not a status, so it reads
 * as secondary text. The words themselves (`pass`, `fail`, …) are always
 * rendered, so colour is never the only signal.
 */
const STATUS_CLASS: Record<BudgetResult['status'], string> = {
  pass: 'text-[var(--sf-status-healthy-indicator)]',
  fail: 'text-[var(--sf-status-down-indicator)]',
  unknown: 'text-[var(--sf-status-unknown-indicator)] italic',
  not_applicable: 'text-[var(--sf-text-secondary)]',
};

/** Secondary-text label for a field or a report row. */
const LABEL_CLASS = 'text-xs font-normal text-[var(--sf-text-secondary)]';

/**
 * Keep inputs and selects at 44px below the `sm` breakpoint, the same rule the
 * library's small Button follows, so the panel is usable on the mobile PWA.
 */
const FIELD_CLASS = 'min-h-[44px] sm:min-h-0';

type CacheChoice = 'auto' | 'warm' | 'cold' | 'unknown';

const CACHE_OPTIONS: Array<{ value: CacheChoice; label: string }> = [
  { value: 'auto', label: 'Detect' },
  { value: 'warm', label: 'Warm' },
  { value: 'cold', label: 'Cold' },
  { value: 'unknown', label: 'Unknown' },
];

const PROFILE_OPTIONS = DEVICE_PROFILE_KEYS.map((key) => ({ value: key, label: key }));

function downloadReport(report: PerformanceReport): void {
  const blob = new Blob([serializeReport(report)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = reportFileName(report);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** One label/value line of the latest report. */
function ReportRow({ label, valueClassName, children }: { label: string; valueClassName?: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-[var(--sf-text-secondary)]">{label}</span>
      <span className={cn('text-right', valueClassName)}>{children}</span>
    </div>
  );
}

export function PerformanceCapturePanel() {
  const { timedCapture, performanceReports, baselineReport, lastComparison } = usePerformanceStore();
  const ids = useId();
  const [warmup, setWarmup] = useState('10');
  const [capture, setCapture] = useState('60');
  const [profile, setProfile] = useState(DEFAULT_DEVICE_PROFILE_KEY);
  const [cache, setCache] = useState<CacheChoice>('auto');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const running = timedCapture?.status === 'running';
  const latest = performanceReports?.at(-1) ?? null;

  const handleRun = useCallback(() => {
    setNotice(null);
    // Number('') is 0 and Number('abc') is NaN: both reach the shared validator,
    // which reports them exactly as it would for the AI.
    const result = startPerformanceCapture({
      warmupSeconds: Number(warmup),
      captureSeconds: Number(capture),
      profileId: profile,
      ...(cache === 'auto' ? {} : { cacheState: cache }),
    });
    setError(result.ok ? null : result.error);
  }, [warmup, capture, profile, cache]);

  const handleCancel = useCallback(() => {
    const result = cancelPerformanceCapture({});
    setError(result.ok ? null : result.error);
  }, []);

  const handlePin = useCallback(() => {
    const result = setPerformanceBaseline(baselineReport && latest && baselineReport.reportId === latest.reportId ? { clear: true } : {});
    setError(result.ok ? null : result.error);
    setNotice(result.ok ? result.message : null);
  }, [baselineReport, latest]);

  const handleCompare = useCallback(() => {
    const result = comparePerformanceReports({});
    setError(result.ok ? null : result.error);
  }, []);

  const phaseLabel = timedCapture?.phase ? PHASE_LABELS[timedCapture.phase] ?? timedCapture.phase : null;
  const progressPct = Math.round((timedCapture?.progress ?? 0) * 100);
  const isBaseline = !!(latest && baselineReport && baselineReport.reportId === latest.reportId);

  return (
    <section className="mt-3 pt-3 border-t border-[var(--sf-border)] space-y-2" aria-labelledby={`${ids}-title`}>
      <h3 id={`${ids}-title`} className="text-xs uppercase tracking-wide text-[var(--sf-text-secondary)]">
        Timed capture
      </h3>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-warmup`} className={LABEL_CLASS}>
            Warm-up (s)
          </Label>
          <Input
            id={`${ids}-warmup`}
            type="number"
            inputMode="numeric"
            value={warmup}
            onChange={(e) => setWarmup(e.target.value)}
            disabled={running}
            className={FIELD_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-capture`} className={LABEL_CLASS}>
            Capture (s)
          </Label>
          <Input
            id={`${ids}-capture`}
            type="number"
            inputMode="numeric"
            value={capture}
            onChange={(e) => setCapture(e.target.value)}
            disabled={running}
            className={FIELD_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-profile`} className={LABEL_CLASS}>
            Device profile
          </Label>
          <Select
            id={`${ids}-profile`}
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            disabled={running}
            options={PROFILE_OPTIONS}
            className={FIELD_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-cache`} className={LABEL_CLASS}>
            Cache state
          </Label>
          <Select
            id={`${ids}-cache`}
            value={cache}
            onChange={(e) => setCache(e.target.value as CacheChoice)}
            disabled={running}
            options={CACHE_OPTIONS}
            className={FIELD_CLASS}
          />
        </div>
      </div>

      {running ? (
        <Button type="button" size="sm" variant="outline" onClick={handleCancel} className="w-full">
          Cancel capture
        </Button>
      ) : (
        <Button type="button" size="sm" onClick={handleRun} className="w-full">
          Run capture
        </Button>
      )}

      <div aria-live="polite" className="text-xs text-[var(--sf-text-secondary)]">
        {running && (
          <div className="space-y-1">
            <div>
              {phaseLabel} — {progressPct}%
            </div>
            <Progress value={progressPct} label="Capture progress" />
          </div>
        )}
        {timedCapture?.status === 'cancelled' && <div>Capture cancelled.</div>}
        {notice && <div>{notice}</div>}
      </div>

      {(error || (timedCapture?.status === 'failed' && timedCapture.error)) && (
        <InlineAlert variant="error">{error ?? timedCapture.error}</InlineAlert>
      )}

      {latest && (
        <div className="space-y-1 text-xs" aria-label="Latest performance report">
          <ReportRow label="Verdict" valueClassName={STATUS_CLASS[latest.verdict]}>
            {latest.verdict}
          </ReportRow>
          <ReportRow label="Fixture">
            {String(latest.fixture.id)} ({String(latest.fixture.checksum)})
          </ReportRow>
          <ReportRow label="Frame p50 / p95 / p99">
            {ms(latest.aggregates.frameTime.p50Ms)} / {ms(latest.aggregates.frameTime.p95Ms)} / {ms(latest.aggregates.frameTime.p99Ms)}
          </ReportRow>
          <ReportRow label="First interactive">{ms(latest.aggregates.firstInteractiveMs)}</ReportRow>
          <ReportRow label="JS heap / WASM memory">
            {mb(latest.aggregates.memory.jsHeapUsedMb)} / {mb(latest.aggregates.memory.wasmLinearMemoryMb)}
          </ReportRow>
          <ReportRow label="Samples">{latest.aggregates.frameTime.sampleCount}</ReportRow>
          <ul className="space-y-0.5" aria-label="Budgets">
            {latest.budgets.map((b) => (
              <li key={b.id} className="flex justify-between gap-2">
                <span className="text-[var(--sf-text-secondary)]">{b.id}</span>
                <span className={cn('text-right', STATUS_CLASS[b.status])}>
                  {b.status} ({b.observed === UNKNOWN ? 'unknown' : `${b.observed}`} / {b.limit} {b.unit})
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" size="sm" variant="outline" onClick={() => downloadReport(latest)}>
              Download report (JSON)
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handlePin}>
              {isBaseline ? 'Unpin baseline' : 'Pin as baseline'}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={handleCompare}>
              Compare with baseline
            </Button>
          </div>
        </div>
      )}

      {lastComparison && (
        <div className="text-xs space-y-0.5" aria-label="Baseline comparison">
          {lastComparison.compatible ? (
            <div>
              Compared with baseline {lastComparison.baselineReportId}: <strong>{lastComparison.claim}</strong>
            </div>
          ) : (
            <InlineAlert variant="warning">
              Incompatible baseline — no improvement or regression is claimed:{' '}
              {lastComparison.incompatibilities.map((d) => `${d.field} (${show(d.current)} vs ${show(d.baseline)})`).join('; ')}
            </InlineAlert>
          )}
        </div>
      )}
    </section>
  );
}
