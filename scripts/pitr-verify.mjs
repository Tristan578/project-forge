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
 *
 * Ticket: #8212 — PITR never tested.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const NEON_API_BASE = 'https://console.neon.tech/api/v2';
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120000;

export class PitrError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

export function formatBranchName(date) {
  const iso = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `pitr-verify-${iso}`;
}

export function computeParentTimestamp(now, hoursAgo) {
  const offset = Number(hoursAgo);
  if (!Number.isFinite(offset) || offset <= 0) {
    throw new PitrError(`HOURS_AGO must be a positive number, got: ${hoursAgo}`, 2);
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
    throw new PitrError('Neon response missing branch.id', 3);
  }
  if (!connectionUri) {
    throw new PitrError('Neon response missing connection_uris[0].connection_uri', 3);
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
    );
  }
  try {
    return text.length ? JSON.parse(text) : {};
  } catch {
    throw new PitrError(`Neon API returned non-JSON body: ${text.slice(0, 200)}`, 3);
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
        throw new PitrError(`Operation ${operationId} ended with status=${status.status}`, 3);
      }
      return;
    }
    await sleepFn(POLL_INTERVAL_MS);
  }
  throw new PitrError(`Operation ${operationId} did not finish within ${POLL_TIMEOUT_MS}ms`, 4);
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

  if (!apiKey) throw new PitrError('NEON_API_KEY is required', 2);
  if (!projectId) throw new PitrError('NEON_PROJECT_ID is required', 2);

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
    .then(code => process.exit(code))
    .catch(err => {
      if (err instanceof PitrError) {
        console.error(`[pitr-verify] FATAL: ${err.message}`);
        process.exit(err.exitCode);
      }
      console.error('[pitr-verify] FATAL:', err);
      process.exit(1);
    });
}
