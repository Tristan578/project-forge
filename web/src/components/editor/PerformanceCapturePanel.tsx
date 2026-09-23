import React, { useCallback, useId, useState } from 'react';
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

const STATUS_CLASS: Record<BudgetResult['status'], string> = {
  pass: 'text-green-400',
  fail: 'text-red-400',
  unknown: 'text-gray-400 italic',
  not_applicable: 'text-gray-400',
};

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

export function PerformanceCapturePanel() {
  const { timedCapture, performanceReports, baselineReport, lastComparison } = usePerformanceStore();
  const ids = useId();
  const [warmup, setWarmup] = useState('10');
  const [capture, setCapture] = useState('60');
  const [profile, setProfile] = useState(DEFAULT_DEVICE_PROFILE_KEY);
  const [cache, setCache] = useState<'auto' | 'warm' | 'cold' | 'unknown'>('auto');
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
    <section className="mt-3 pt-3 border-t border-gray-700 space-y-2" aria-labelledby={`${ids}-title`}>
      <h3 id={`${ids}-title`} className="text-xs uppercase tracking-wide text-gray-400">
        Timed capture
      </h3>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400">Warm-up (s)</span>
          <input
            type="number"
            inputMode="numeric"
            value={warmup}
            onChange={(e) => setWarmup(e.target.value)}
            disabled={running}
            className="px-1.5 py-1 rounded bg-gray-800 border border-gray-700"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400">Capture (s)</span>
          <input
            type="number"
            inputMode="numeric"
            value={capture}
            onChange={(e) => setCapture(e.target.value)}
            disabled={running}
            className="px-1.5 py-1 rounded bg-gray-800 border border-gray-700"
          />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400">Device profile</span>
          <select
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            disabled={running}
            className="px-1.5 py-1 rounded bg-gray-800 border border-gray-700"
          >
            {DEVICE_PROFILE_KEYS.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-gray-400">Cache state</span>
          <select
            value={cache}
            onChange={(e) => setCache(e.target.value as typeof cache)}
            disabled={running}
            className="px-1.5 py-1 rounded bg-gray-800 border border-gray-700"
          >
            <option value="auto">Detect</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
      </div>

      <div className="flex gap-2">
        {running ? (
          <button type="button" onClick={handleCancel} className="flex-1 px-3 py-1.5 text-sm rounded bg-gray-700 hover:bg-gray-600">
            Cancel capture
          </button>
        ) : (
          <button type="button" onClick={handleRun} className="flex-1 px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500">
            Run capture
          </button>
        )}
      </div>

      <div aria-live="polite" className="text-xs text-gray-300">
        {running && (
          <div className="space-y-1">
            <div>
              {phaseLabel} — {progressPct}%
            </div>
            <div
              className="h-1.5 bg-gray-800 rounded overflow-hidden"
              role="progressbar"
              aria-label="Capture progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPct}
            >
              <div className="h-full bg-blue-500" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        )}
        {timedCapture?.status === 'cancelled' && <div>Capture cancelled.</div>}
        {notice && <div>{notice}</div>}
      </div>

      {(error || (timedCapture?.status === 'failed' && timedCapture.error)) && (
        <div role="alert" className="text-xs text-red-400">
          {error ?? timedCapture.error}
        </div>
      )}

      {latest && (
        <div className="space-y-1 text-xs" aria-label="Latest performance report">
          <div className="flex justify-between">
            <span className="text-gray-400">Verdict</span>
            <span className={latest.verdict === 'pass' ? 'text-green-400' : latest.verdict === 'fail' ? 'text-red-400' : 'text-gray-400 italic'}>
              {latest.verdict}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Fixture</span>
            <span>
              {String(latest.fixture.id)} ({String(latest.fixture.checksum)})
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Frame p50 / p95 / p99</span>
            <span>
              {ms(latest.aggregates.frameTime.p50Ms)} / {ms(latest.aggregates.frameTime.p95Ms)} / {ms(latest.aggregates.frameTime.p99Ms)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">First interactive</span>
            <span>{ms(latest.aggregates.firstInteractiveMs)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">JS heap / WASM memory</span>
            <span>
              {mb(latest.aggregates.memory.jsHeapUsedMb)} / {mb(latest.aggregates.memory.wasmLinearMemoryMb)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Samples</span>
            <span>{latest.aggregates.frameTime.sampleCount}</span>
          </div>
          <ul className="space-y-0.5" aria-label="Budgets">
            {latest.budgets.map((b) => (
              <li key={b.id} className="flex justify-between gap-2">
                <span className="text-gray-400">{b.id}</span>
                <span className={STATUS_CLASS[b.status]}>
                  {b.status} ({b.observed === UNKNOWN ? 'unknown' : `${b.observed}`} / {b.limit} {b.unit})
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 pt-1">
            <button type="button" onClick={() => downloadReport(latest)} className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700">
              Download report (JSON)
            </button>
            <button type="button" onClick={handlePin} className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700">
              {isBaseline ? 'Unpin baseline' : 'Pin as baseline'}
            </button>
            <button type="button" onClick={handleCompare} className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700">
              Compare with baseline
            </button>
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
            <div className="text-yellow-400">
              Incompatible baseline — no improvement or regression is claimed:{' '}
              {lastComparison.incompatibilities.map((d) => `${d.field} (${show(d.current)} vs ${show(d.baseline)})`).join('; ')}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
