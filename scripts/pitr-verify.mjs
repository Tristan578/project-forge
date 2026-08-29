#!/usr/bin/env node
/**
 * pitr-verify.mjs
 *
 * Drives a full Neon Point-in-Time-Recovery verification end-to-end:
 *
 *   1. Creates a read-only Neon branch from (now - HOURS_AGO hours).
 *   2. Waits for the branch's create_branch operation to finish.
 *   3. Runs scripts/verify-db-backup.sh against the branch connection URI.
 *   4. Deletes the branch in a finally block — always, even on failure.
 *
 * Usage:
 *   NEON_API_KEY=napi_xxx \
 *   NEON_PROJECT_ID=fragrant-moon-12345 \
 *   HOURS_AGO=24 \
 *     node scripts/pitr-verify.mjs
 *
 * Exit codes:
 *   0  all checks passed
 *   1  verification script reported failures
 *   2  missing required env var
 *   3  Neon API error (create/poll/delete)
 *   4  operation timed out
 *   5  unexpected internal error (a bug in this script)
 *
 * Failure CLASS (orthogonal to the exit code — see FAILURE_CLASS below) is what
 * decides which runbook a reader is sent to. The exit code says *where* we
 * stopped; the class says *whose problem it is*. A 404 from the Neon API means
 * NEON_PROJECT_ID does not resolve — a workflow-configuration fault, NOT
 * evidence that backups are broken — and must never route a reader to data
 * recovery. The class is published as the `failure_class` step output for the
 * workflow's reporting step to consume.
 *
 * Ticket: #8212 — PITR never tested. #9036 — its failures were misdiagnosed.
 */

import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const NEON_API_BASE = 'https://console.neon.tech/api/v2';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120000;

/**
 * Failure classes. Every failure path in this file picks exactly one.
 *
 *   config  — the job never reached the thing it was meant to test: missing or
 *             wrong NEON_API_KEY / NEON_PROJECT_ID, bad HOURS_AGO, or a
 *             401/403/404 from the Neon API. Backups were not exercised, so
 *             nothing here says anything about their health.
 *   pitr    — the restore itself is at fault: Neon refused the restore point,
 *             the create_branch operation failed, or the recovery branch came
 *             up and verify-db-backup.sh found bad data.
 *   infra   — transient/upstream: timeout, 429, 5xx, malformed API response.
 *   unknown — nothing above matched (including an unexpected exception, which
 *             most likely means a bug in this script). Never folded into one of
 *             the others: labelling an unclassified failure "transient" is how
 *             it gets ignored month after month.
 */
export const FAILURE_CLASS = Object.freeze({
  CONFIG: 'config',
  PITR: 'pitr',
  INFRA: 'infra',
  UNKNOWN: 'unknown',
});

export const FAILURE_CLASSES = Object.freeze(Object.values(FAILURE_CLASS));

export class PitrError extends Error {
  constructor(message, exitCode, failureClass = FAILURE_CLASS.UNKNOWN) {
    super(message);
    this.exitCode = exitCode;
    this.failureClass = failureClass;
  }
}

/**
 * Map an HTTP status from the Neon API onto a failure class.
 *
 * 401/403 — the API key is missing, revoked, or scoped wrong.
 * 404     — the project id does not resolve. This is the #9036 case.
 * 400/422 — Neon accepted our credentials and rejected the REQUEST: the restore
 *           point is outside the retention window, or the branch spec is bad.
 *           That is a real PITR finding, not a configuration one.
 * 408/429/5xx — upstream is unhappy right now; retry next month.
 */
export function classifyHttpStatus(status) {
  if (status === 401 || status === 403 || status === 404) return FAILURE_CLASS.CONFIG;
  if (status === 400 || status === 422) return FAILURE_CLASS.PITR;
  if (status === 408 || status === 429) return FAILURE_CLASS.INFRA;
  if (Number.isInteger(status) && status >= 500 && status <= 599) return FAILURE_CLASS.INFRA;
  return FAILURE_CLASS.UNKNOWN;
}

/** Class for any thrown value. Anything that is not a classified PitrError is unknown. */
export function classifyError(err) {
  if (err instanceof PitrError && FAILURE_CLASSES.includes(err.failureClass)) {
    return err.failureClass;
  }
  return FAILURE_CLASS.UNKNOWN;
}

/**
 * Class for a completed run. `main` resolving with 1 means the recovery branch
 * came up and verify-db-backup.sh failed against it — a genuine PITR fault.
 * Returns null when there is nothing to report.
 */
export function classifyOutcome({ exitCode, error }) {
  if (error !== undefined && error !== null) return classifyError(error);
  if (exitCode === 0) return null;
  if (exitCode === 1) return FAILURE_CLASS.PITR;
  return FAILURE_CLASS.UNKNOWN;
}

/**
 * Publish the class as a step output for the workflow's reporting step.
 * Best-effort: a write failure must not change the process exit code, since the
 * exit code is what CI grades. A consumer that sees no value treats it as
 * `unknown`, which triages rather than misdiagnoses.
 */
export function writeFailureClass({ env, appendFileFn, failureClass, log }) {
  const outPath = env?.GITHUB_OUTPUT;
  if (!outPath) return false;
  if (!FAILURE_CLASSES.includes(failureClass)) return false;
  try {
    appendFileFn(outPath, `failure_class=${failureClass}\n`);
    return true;
  } catch (err) {
    log?.(`WARN: could not record failure_class: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

export function formatBranchName(date) {
  const iso = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `pitr-verify-${iso}`;
}

export function computeParentTimestamp(now, hoursAgo) {
  const offset = Number(hoursAgo);
  if (!Number.isFinite(offset) || offset <= 0) {
    throw new PitrError(`HOURS_AGO must be a positive number, got: ${hoursAgo}`, 2, FAILURE_CLASS.CONFIG);
  }
  const ts = new Date(now.getTime() - offset * 60 * 60 * 1000);
  return ts.toISOString();
}

export function buildBranchPayload({ parentTimestamp, branchName }) {
  return {
    branch: {
      parent_timestamp: parentTimestamp,
      name: branchName,
    },
    endpoints: [{ type: 'read_only' }],
  };
}

export function parseCreateResponse(json) {
  const branchId = json?.branch?.id;
  const connectionUri = json?.connection_uris?.[0]?.connection_uri;
  const operations = Array.isArray(json?.operations) ? json.operations : [];
  const operationIds = operations.map(op => op?.id).filter(Boolean);

  if (!branchId) {
    throw new PitrError('Neon response missing branch.id', 3, FAILURE_CLASS.INFRA);
  }
  if (!connectionUri) {
    throw new PitrError('Neon response missing connection_uris[0].connection_uri', 3, FAILURE_CLASS.INFRA);
  }
  return { branchId, connectionUri, operationIds };
}

export function isOperationDone(json) {
  const status = json?.operation?.status;
  if (status === 'finished') return { done: true, ok: true };
  if (status === 'failed' || status === 'error' || status === 'cancelled') {
    return { done: true, ok: false, status };
  }
  return { done: false };
}

async function neonFetch(fetchFn, { method, path: urlPath, apiKey, body }) {
  const url = `${NEON_API_BASE}${urlPath}`;
  const res = await fetchFn(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new PitrError(
      `Neon API ${method} ${urlPath} failed: ${res.status} ${res.statusText} — ${text.slice(0, 400)}`,
      3,
      classifyHttpStatus(res.status),
    );
  }
  try {
    return text.length ? JSON.parse(text) : {};
  } catch {
    throw new PitrError(`Neon API returned non-JSON body: ${text.slice(0, 200)}`, 3, FAILURE_CLASS.INFRA);
  }
}

export async function waitForOperation({ fetchFn, projectId, apiKey, operationId, sleepFn, now }) {
  const deadline = now() + POLL_TIMEOUT_MS;
  while (now() < deadline) {
    const json = await neonFetch(fetchFn, {
      method: 'GET',
      path: `/projects/${projectId}/operations/${operationId}`,
      apiKey,
    });
    const status = isOperationDone(json);
    if (status.done) {
      if (!status.ok) {
        throw new PitrError(
          `Operation ${operationId} ended with status=${status.status}`,
          3,
          FAILURE_CLASS.PITR,
        );
      }
      return;
    }
    await sleepFn(POLL_INTERVAL_MS);
  }
  throw new PitrError(
    `Operation ${operationId} did not finish within ${POLL_TIMEOUT_MS}ms`,
    4,
    FAILURE_CLASS.INFRA,
  );
}

export function runVerifyScript({ connectionUri, scriptPath, spawnFn }) {
  return new Promise((resolve, reject) => {
    const child = spawnFn('bash', [scriptPath], {
      env: { ...process.env, NEON_VERIFY_DB_URL: connectionUri },
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', code => resolve(code ?? 1));
  });
}

export async function main({ env, fetchFn, spawnFn, sleepFn, now, log, scriptPath }) {
  const apiKey = env.NEON_API_KEY;
  const projectId = env.NEON_PROJECT_ID;
  const hoursAgo = env.HOURS_AGO ?? '24';

  if (!apiKey) throw new PitrError('NEON_API_KEY is required', 2, FAILURE_CLASS.CONFIG);
  if (!projectId) throw new PitrError('NEON_PROJECT_ID is required', 2, FAILURE_CLASS.CONFIG);

  const parentTimestamp = computeParentTimestamp(new Date(now()), hoursAgo);
  const branchName = formatBranchName(new Date(now()));
  log(`Creating recovery branch "${branchName}" from ${parentTimestamp}`);

  const createJson = await neonFetch(fetchFn, {
    method: 'POST',
    path: `/projects/${projectId}/branches`,
    apiKey,
    body: buildBranchPayload({ parentTimestamp, branchName }),
  });

  const branchId = createJson?.branch?.id;
  let verifyExitCode = 1;
  try {
    const { connectionUri, operationIds } = parseCreateResponse(createJson);
    log(`Branch created: ${branchId} (${operationIds.length} operations pending)`);
    for (const opId of operationIds) {
      log(`Waiting for operation ${opId}...`);
      await waitForOperation({ fetchFn, projectId, apiKey, operationId: opId, sleepFn, now });
    }
    log('Branch ready. Running verification script...');
    verifyExitCode = await runVerifyScript({ connectionUri, scriptPath, spawnFn });
    log(`Verification script exited with code ${verifyExitCode}`);
  } finally {
    if (branchId) {
      log(`Deleting branch ${branchId}...`);
      try {
        await neonFetch(fetchFn, {
          method: 'DELETE',
          path: `/projects/${projectId}/branches/${branchId}`,
          apiKey,
        });
        log('Branch deleted.');
      } catch (err) {
        log(`WARN: failed to delete branch ${branchId}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  return verifyExitCode === 0 ? 0 : 1;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'verify-db-backup.sh');
  main({
    env: process.env,
    fetchFn: globalThis.fetch,
    spawnFn: spawn,
    sleepFn: ms => new Promise(r => setTimeout(r, ms)),
    now: () => Date.now(),
    log: msg => console.log(`[pitr-verify] ${msg}`),
    scriptPath,
  })
    .then(code => {
      finish({ exitCode: code });
    })
    .catch(err => {
      if (err instanceof PitrError) {
        console.error(`[pitr-verify] FATAL: ${err.message}`);
        finish({ exitCode: err.exitCode, error: err });
        return;
      }
      console.error('[pitr-verify] FATAL:', err);
      // Exit 5, not 1: exit 1 means "the recovery branch came up and its data
      // was bad". An exception in this driver is not that, and must not be
      // reported as if the backup had been tested and found wanting.
      finish({ exitCode: 5, error: err });
    });
}

function finish({ exitCode, error }) {
  const failureClass = classifyOutcome({ exitCode, error });
  if (failureClass) {
    console.error(`[pitr-verify] failure class: ${failureClass}`);
    writeFailureClass({
      env: process.env,
      appendFileFn: appendFileSync,
      failureClass,
      log: msg => console.error(`[pitr-verify] ${msg}`),
    });
  }
  process.exit(exitCode);
}
