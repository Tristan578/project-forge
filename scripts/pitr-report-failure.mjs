#!/usr/bin/env node
/**
 * pitr-report-failure.mjs
 *
 * Reports a failed scheduled PITR verification run to GitHub Issues, correctly
 * and exactly once.
 *
 * Two defects this replaces (#9036):
 *
 *   1. MISDIAGNOSIS. The old reporter filed one generic "PITR verification
 *      failed" issue for every failure and pointed the reader at the manual
 *      DATA RECOVERY runbook. Every real failure so far was a 404 from the Neon
 *      API — a stale NEON_PROJECT_ID — so four consecutive readers were sent to
 *      check backups when the actual fault was a repository secret. The class
 *      (see FAILURE_CLASS in pitr-verify.mjs) now picks the title, the labels
 *      and the runbook, and a `config` failure explicitly tells the reader NOT
 *      to run data recovery.
 *
 *   2. DUPLICATES. It called issues.create unconditionally, minting a new P0
 *      every month: #9036, #8881, #8674, #8550, all still open, all the same
 *      fault. We now find the existing issue for this failure class, reopen it
 *      if it was closed, and record the recurrence on it — updating the last
 *      recurrence comment in place rather than adding a new one each month, so
 *      the run history stays traceable without becoming spam.
 *
 * Usage (all inputs from the environment, as GitHub Actions provides them):
 *   GITHUB_TOKEN=...            (required) repo token with issues: write
 *   GITHUB_REPOSITORY=owner/name (required)
 *   GITHUB_RUN_ID=...           run to link to
 *   GITHUB_SERVER_URL=...       defaults to https://github.com
 *   PITR_FAILURE_CLASS=...      config | pitr | infra | unknown
 *                               (empty/unrecognized => unknown, never guessed)
 *   HOURS_AGO=...               recovery point used by the run
 *     node scripts/pitr-report-failure.mjs
 *
 * Exit codes:
 *   0  reported (created, commented, or updated an existing report)
 *   1  could not report (bad input or GitHub API error)
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const GITHUB_API_BASE = 'https://api.github.com';

/** Label every report carries; also the lookup key for finding prior reports. */
export const LOOKUP_LABEL = 'area-infra';

/** Marker prefixes. Machine-readable, invisible in rendered markdown. */
export const MARKER_PREFIX = 'pitr-verify-report';

/** How many recurrence lines a single comment keeps before dropping the oldest. */
export const RECURRENCE_CAP = 20;

/** Heading the recurrence list hangs off. Load-bearing: appendRecurrence finds it. */
export const RUNS_HEADING = '**Recurred on:**';

const RUNBOOK = 'docs/database-backup-restore.md';

/**
 * Per-class report shape. Title, labels and runbook all differ by class — that
 * difference IS the fix, so keep them distinct.
 *
 * Titles are deliberately STABLE (no date). The title plus the class marker is
 * the dedupe key; a date in the title guarantees a new issue every month, which
 * is how the original defect worked.
 */
export const CLASS_SPECS = Object.freeze({
  config: {
    title: 'PITR verification is not running: workflow configuration fault',
    labels: ['priority-p0', LOOKUP_LABEL],
    headline:
      'The monthly PITR verification job could not reach the Neon project, so **no backup was tested**.',
    verdict:
      'This is a WORKFLOW CONFIGURATION fault, not a backup fault. Nothing in this run says anything ' +
      'about the health of the database or its recovery points — the job stopped before it got that far.',
    doNot:
      'Do NOT run the data-recovery procedure in response to this issue. There is no evidence of data loss.',
    likelyCauses: [
      '`NEON_PROJECT_ID` is stale or wrong (Neon replies `404 project not found`).',
      '`NEON_API_KEY` is missing, revoked, or scoped to a different Neon organisation (`401`/`403`).',
      'A required secret was never set on this repository.',
    ],
    runbook: `${RUNBOOK}#triage-configuration-fault`,
    firstStep:
      'Compare the `NEON_PROJECT_ID` repository secret against the project id in the Neon console, then ' +
      're-run this workflow from the Actions tab. Until it is fixed, PITR is UNVERIFIED — which is its own ' +
      'risk, but a different one from a failed restore.',
  },
  pitr: {
    title: 'PITR verification failed: recovery branch could not be restored or verified',
    labels: ['priority-p0', LOOKUP_LABEL, 'disaster-recovery'],
    headline:
      'The PITR verification job reached Neon and the restore itself failed, or the recovered data did not pass verification.',
    verdict:
      'This is a GENUINE point-in-time-recovery finding. Treat the recovery path as unproven until it is resolved.',
    doNot: '',
    likelyCauses: [
      'The requested restore point is outside the retention window (Neon replies `400`/`422`).',
      'The `create_branch` operation ended `failed`/`error`/`cancelled`.',
      'The recovery branch came up and `scripts/verify-db-backup.sh` reported missing tables, zero rows, or broken referential integrity.',
    ],
    runbook: `${RUNBOOK}#triage-pitr-restore-fault`,
    firstStep:
      'Read the failing step log to see which of the three it was, then follow the restore procedure in the runbook.',
  },
  infra: {
    title: 'PITR verification failed: infrastructure or transient fault',
    labels: [LOOKUP_LABEL],
    headline:
      'The PITR verification job failed on a transient or upstream condition (timeout, rate limit, 5xx, or a malformed API response).',
    verdict:
      'No conclusion can be drawn about backup health from this run. It is not a data-recovery event and not a configuration fault.',
    doNot: 'Do NOT run the data-recovery procedure in response to this issue.',
    likelyCauses: [
      'A Neon operation did not finish inside the poll timeout.',
      'The Neon API returned `429` or a `5xx`.',
      'The Neon API returned a non-JSON or incomplete body.',
    ],
    runbook: `${RUNBOOK}#triage-infrastructure-or-transient-fault`,
    firstStep:
      'Re-run the workflow manually. If it passes, close this issue. If it recurs across runs, it is not transient — reclassify it.',
  },
  unknown: {
    title: 'PITR verification failed: unclassified failure',
    labels: [LOOKUP_LABEL],
    headline: 'The PITR verification job failed in a way the driver could not classify.',
    verdict:
      'This is most likely a bug in `scripts/pitr-verify.mjs` or a step that failed before the driver ran ' +
      '(for example its unit tests). It is deliberately NOT reported as transient — an unclassified failure ' +
      'needs a human, and calling it transient is how it gets ignored.',
    doNot: 'Do NOT run the data-recovery procedure in response to this issue.',
    likelyCauses: [
      'An unexpected exception in the driver (exit code 5).',
      'A step before "Run PITR verification" failed, so no class was ever produced.',
      'The Neon API returned a status the classifier does not map.',
    ],
    runbook: `${RUNBOOK}#triage-unclassified-failure`,
    firstStep: 'Open the run log, find the first failing step, and either fix the driver or add the missing class.',
  },
});

export const REPORT_CLASSES = Object.freeze(Object.keys(CLASS_SPECS));

/** Unrecognized/empty input becomes `unknown`. It is never guessed into a real class. */
export function normalizeClass(raw) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return REPORT_CLASSES.includes(value) ? value : 'unknown';
}

export function markerFor(cls) {
  return `<!-- ${MARKER_PREFIX}:class=${cls} -->`;
}

export function recurrenceMarkerFor(cls) {
  return `<!-- ${MARKER_PREFIX}:recurrence:class=${cls} -->`;
}

export function buildIssueBody({ cls, runUrl, hoursAgo, date, supersedes = [] }) {
  const spec = CLASS_SPECS[cls];
  const lines = [
    markerFor(cls),
    `**Failure class:** \`${cls}\``,
    '',
    spec.headline,
    '',
    spec.verdict,
  ];
  if (spec.doNot) {
    lines.push('', `> ${spec.doNot}`);
  }
  lines.push(
    '',
    '## Likely causes',
    ...spec.likelyCauses.map(c => `- ${c}`),
    '',
    '## What to do first',
    spec.firstStep,
    '',
    `**Runbook:** \`${spec.runbook}\``,
    '',
    '## Run details',
    `- Recovery point: ${hoursAgo}h before the run`,
    `- First seen: ${date}`,
  );
  if (supersedes.length) {
    lines.push(
      '',
      '## Superseded reports',
      'Earlier runs filed one undiagnosed issue each, all pointing at the data-recovery runbook:',
      supersedes.map(n => `#${n}`).join(', ') + '.',
      'They are left untouched here; triage and close them by hand.',
    );
  }
  lines.push('', RUNS_HEADING, `- ${date} — ${runUrl}`);
  return lines.join('\n');
}

export function buildRecurrenceComment({ cls, runUrl, date }) {
  return [
    recurrenceMarkerFor(cls),
    `The same \`${cls}\` failure recurred. Nothing new to report — see the issue body for triage steps.`,
    '',
    RUNS_HEADING,
    `- ${date} — ${runUrl}`,
  ].join('\n');
}

export function isRecurrenceComment(comment, cls) {
  return typeof comment?.body === 'string' && comment.body.includes(recurrenceMarkerFor(cls));
}

/**
 * The newest recurrence comment for `cls` anywhere in `comments`, or null.
 *
 * Scans backwards rather than looking only at the last comment. A human reply
 * lands after the bot's comment, so an end-only check stops finding it the
 * moment anyone triages the issue — and every later re-run then opens a NEW
 * recurrence comment instead of appending. The run history fragments across
 * comments and RECURRENCE_CAP stops bounding it, because the cap only ever
 * trims the list inside a single comment.
 */
export function findLastRecurrence(comments, cls) {
  for (let i = comments.length - 1; i >= 0; i -= 1) {
    if (isRecurrenceComment(comments[i], cls)) return comments[i];
  }
  return null;
}

/**
 * Does `body` already carry a run-list entry for `runUrl`?
 *
 * Match the whole entry, not a substring: run URLs differ only by a trailing
 * numeric id, so `.includes()` treats `.../runs/99` as already recorded once
 * `.../runs/999` is present and silently drops a real recurrence.
 *
 * Shared by `appendRecurrence` and the issue-body idempotency check in
 * `reportFailure`, so both use exactly one definition of "already recorded".
 */
export function recordsRun(body, runUrl) {
  return String(body ?? '')
    .split('\n')
    .some(l => l.startsWith('- ') && l.endsWith(` \u2014 ${runUrl}`));
}

/**
 * Append one run to an existing recurrence comment, keeping the newest
 * `cap` entries. Idempotent: re-reporting the same run URL is a no-op, so a
 * re-run of the reporting step cannot double-log.
 */
export function appendRecurrence(existingBody, { runUrl, date, cap = RECURRENCE_CAP }) {
  const body = String(existingBody ?? '');
  const lines = body.split('\n');
  const idx = lines.findIndex(l => l.trim() === RUNS_HEADING);
  const entry = `- ${date} — ${runUrl}`;
  if (idx === -1) {
    return `${body}\n\n${RUNS_HEADING}\n${entry}`;
  }
  const head = lines.slice(0, idx + 1);
  const rest = lines.slice(idx + 1);
  const runLines = rest.filter(l => l.startsWith('- '));
  if (recordsRun(body, runUrl)) return body;
  const kept = [...runLines, entry].slice(-cap);
  return [...head, ...kept].join('\n');
}

/** An issue-list entry is a pull request when it carries a `pull_request` key. */
function isIssue(item) {
  return Boolean(item) && !item.pull_request;
}

/**
 * `Date.parse` returns NaN for a missing or malformed timestamp, and a
 * comparator that returns NaN leaves the sort order unspecified. Treat an
 * unparseable `updated_at` as the epoch so it sorts last deterministically.
 */
function updatedAtMs(issue) {
  const ms = Date.parse(issue?.updated_at ?? '');
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Find the report already tracking this failure class. Prefers an open issue;
 * otherwise returns the most recently updated closed one so the caller can
 * reopen it rather than mint a duplicate.
 */
export function findMatchingIssue(issues, cls) {
  const marker = markerFor(cls);
  const candidates = (issues ?? []).filter(
    i => isIssue(i) && typeof i.body === 'string' && i.body.includes(marker),
  );
  const open = candidates.find(i => i.state === 'open');
  if (open) return open;
  const closed = candidates
    .filter(i => i.state === 'closed')
    .sort((a, b) => updatedAtMs(b) - updatedAtMs(a));
  return closed[0] ?? null;
}

/**
 * Pre-fix reports: generic dated titles, no class marker. Listed in a new
 * report so the history stays connected. Never edited or closed from here —
 * they are a human's to triage.
 */
export function findLegacyIssues(issues) {
  return (issues ?? [])
    .filter(
      i =>
        isIssue(i) &&
        /^PITR verification failed \(\d{4}-\d{2}-\d{2}\)$/.test(i.title ?? '') &&
        !String(i.body ?? '').includes(`<!-- ${MARKER_PREFIX}:`),
    )
    .map(i => i.number)
    .filter(n => Number.isInteger(n))
    .sort((a, b) => b - a);
}

async function ghFetch(fetchFn, { method, path, token, body }) {
  const res = await fetchFn(`${GITHUB_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub API ${method} ${path} failed: ${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
  }
  try {
    return text.length ? JSON.parse(text) : {};
  } catch {
    throw new Error(`GitHub API ${method} ${path} returned non-JSON body: ${text.slice(0, 200)}`);
  }
}

async function listPaged(fetchFn, { path, token, maxPages }) {
  const out = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const batch = await ghFetch(fetchFn, { method: 'GET', path: `${path}&page=${page}`, token });
    if (!Array.isArray(batch) || batch.length === 0) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/**
 * Report one failed run. Returns a description of what it did, which is what
 * the tests assert on.
 */
export async function reportFailure({ fetchFn, env, now, log = () => {}, maxPages = 3 }) {
  const token = env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  if (!token) throw new Error('GITHUB_TOKEN is required');
  if (!repo || !repo.includes('/')) {
    throw new Error(`GITHUB_REPOSITORY must be "owner/name", got: ${repo ?? '(unset)'}`);
  }

  const cls = normalizeClass(env.PITR_FAILURE_CLASS);
  const spec = CLASS_SPECS[cls];
  const server = env.GITHUB_SERVER_URL || 'https://github.com';
  const runId = env.GITHUB_RUN_ID || 'unknown';
  const runUrl = `${server}/${repo}/actions/runs/${runId}`;
  const hoursAgo = env.HOURS_AGO || '24';
  const date = new Date(now()).toISOString().slice(0, 10);

  log(`failure class: ${cls} — ${spec.title}`);

  const issues = await listPaged(fetchFn, {
    path: `/repos/${repo}/issues?state=all&labels=${encodeURIComponent(LOOKUP_LABEL)}&sort=updated&direction=desc&per_page=100`,
    token,
    maxPages,
  });

  const match = findMatchingIssue(issues, cls);

  if (!match) {
    const supersedes = findLegacyIssues(issues);
    const created = await ghFetch(fetchFn, {
      method: 'POST',
      path: `/repos/${repo}/issues`,
      token,
      body: {
        title: spec.title,
        body: buildIssueBody({ cls, runUrl, hoursAgo, date, supersedes }),
        labels: spec.labels,
      },
    });
    log(`opened #${created.number} for class ${cls}`);
    return { action: 'created', cls, number: created.number, supersedes };
  }

  const comments = await listPaged(fetchFn, {
    path: `/repos/${repo}/issues/${match.number}/comments?per_page=100`,
    token,
    maxPages,
  });
  const lastRecurrence = findLastRecurrence(comments, cls);
  const updated =
    lastRecurrence !== null ? appendRecurrence(lastRecurrence.body, { runUrl, date }) : null;

  // Decide whether there is anything to record BEFORE touching issue state. A
  // manual re-run of the reporting step for a run that is already recorded must
  // be a true no-op: reopening first would flip a triaged issue back to open and
  // notify its subscribers for a report that adds nothing.
  //
  // Two kinds of place can already record the run, and both must be searched in
  // full. The issue body carries the opening run, because `buildIssueBody` ends
  // with the same run list. Recurrence comments carry every run after that, and
  // there can be more than one of them on an issue whose history predates this
  // fix, so checking only the newest would re-report a run recorded in an older
  // one.
  const alreadyRecorded =
    recordsRun(match.body, runUrl) ||
    comments.some(c => isRecurrenceComment(c, cls) && recordsRun(c.body, runUrl));
  if (alreadyRecorded) {
    log(`#${match.number} already records run ${runId}; nothing to do`);
    return { action: 'noop', cls, number: match.number, reopened: false };
  }

  let reopened = false;
  if (match.state === 'closed') {
    await ghFetch(fetchFn, {
      method: 'PATCH',
      path: `/repos/${repo}/issues/${match.number}`,
      token,
      body: { state: 'open', state_reason: 'reopened' },
    });
    reopened = true;
    log(`reopened #${match.number} for class ${cls}`);
  }

  if (updated !== null) {
    await ghFetch(fetchFn, {
      method: 'PATCH',
      path: `/repos/${repo}/issues/comments/${lastRecurrence.id}`,
      token,
      body: { body: updated },
    });
    log(`recorded recurrence on #${match.number} (updated comment ${lastRecurrence.id})`);
    return {
      action: 'comment-updated',
      cls,
      number: match.number,
      commentId: lastRecurrence.id,
      reopened,
    };
  }

  const comment = await ghFetch(fetchFn, {
    method: 'POST',
    path: `/repos/${repo}/issues/${match.number}/comments`,
    token,
    body: { body: buildRecurrenceComment({ cls, runUrl, date }) },
  });
  log(`commented on #${match.number}`);
  return { action: 'commented', cls, number: match.number, commentId: comment.id, reopened };
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  reportFailure({
    fetchFn: globalThis.fetch,
    env: process.env,
    now: () => Date.now(),
    log: msg => console.log(`[pitr-report] ${msg}`),
  })
    .then(() => process.exit(0))
    .catch(err => {
      console.error(`[pitr-report] FATAL: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    });
}
