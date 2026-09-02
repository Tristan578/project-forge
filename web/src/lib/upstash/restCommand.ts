/**
 * The one Upstash REST transport for hand-rolled commands.
 *
 * Every command goes in BODY FORM: one JSON array `["CMD", ...args]` posted to
 * the base URL. That is how the `@upstash/redis` SDK encodes commands
 * (`["eval", script, keys.length, ...keys, ...args]`) and what
 * https://upstash.com/docs/redis/features/restapi documents. The PATH form
 * (`POST <base>/eval` with the arguments as the body) is not equivalent:
 * Upstash appends a POST body to a path-form command as ONE trailing argument,
 * which is how the rate limiter's EVAL was refused with 400 on every call from
 * #8369 until #9623.
 *
 * This module exists so the limiter, its health probe and the response cache
 * share the encoding, the timeout and the error-detail read by construction —
 * a probe that transcribes the limiter's request is a probe that keeps passing
 * after the limiter's request changes.
 */

import { UPSTASH_REST_TIMEOUT_MS } from '@/lib/config/timeouts';

/** Longest slice of an Upstash error body carried into a thrown message. */
export const MAX_ERROR_DETAIL_CHARS = 200;

export class UpstashCommandError extends Error {
  constructor(
    message: string,
    /** HTTP status of the refused command; 0 when no request was made. */
    readonly status: number,
    /** Bounded, whitespace-collapsed body text; empty when unreadable. */
    readonly detail: string,
  ) {
    super(message);
    this.name = 'UpstashCommandError';
  }
}

export function isUpstashConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/** Collapse whitespace and bound the length so a body reads as one Sentry line. */
export function normalizeDetail(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_DETAIL_CHARS);
}

/**
 * Best-effort read of an error body. Never throws: a body that cannot be read
 * is simply omitted, so a broken response stream cannot mask the HTTP status
 * that actually matters.
 */
async function readErrorDetail(response: Response): Promise<string> {
  try {
    return normalizeDetail(await response.text());
  } catch {
    return '';
  }
}

export interface UpstashCommandOptions {
  /** Per-request bound; defaults to UPSTASH_REST_TIMEOUT_MS. */
  timeoutMs?: number;
}

/**
 * Post one command and return its `result`.
 *
 * Throws `UpstashCommandError` when the command is refused (non-2xx, with a
 * bounded slice of Upstash's `{"error":"..."}` body in the message), when the
 * body is not JSON, or when it carries no `result`. A transport failure or the
 * timeout throws whatever `fetch` throws — callers that must not block on the
 * limiter catch and degrade.
 */
export async function postUpstashCommand(
  command: readonly (string | number)[],
  opts: UpstashCommandOptions = {},
): Promise<unknown> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new UpstashCommandError('Upstash is not configured', 0, '');
  }
  const name = String(command[0] ?? '').toUpperCase() || 'command';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    // The callers' degrade paths only engage when this THROWS. A stalled
    // connection never throws on its own, and the limiter sits in front of
    // every rate-limited route, so the bound is what turns a hung Upstash into
    // a degrade instead of a route held for the function's whole duration.
    signal: AbortSignal.timeout(opts.timeoutMs ?? UPSTASH_REST_TIMEOUT_MS),
    body: JSON.stringify(command),
  });

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new UpstashCommandError(
      `Upstash ${name} failed: ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
      response.status,
      detail,
    );
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new UpstashCommandError(`Upstash ${name} answered with a non-JSON body`, response.status, '');
  }
  if (!parsed || typeof parsed !== 'object' || !('result' in parsed)) {
    throw new UpstashCommandError(
      `Upstash ${name} answered without a result: ${normalizeDetail(JSON.stringify(parsed))}`,
      response.status,
      normalizeDetail(JSON.stringify(parsed)),
    );
  }
  return (parsed as { result: unknown }).result;
}
