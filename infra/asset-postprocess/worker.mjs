// @ts-check
/**
 * SpawnForge generated-asset post-processing Worker (Cloudflare Queue consumer).
 *
 * Pipeline: R2 event notification (object-create on `spawnforge-assets`)
 *   -> Cloudflare Queue (`spawnforge-asset-postprocess`)
 *   -> this consumer Worker.
 *
 * For each uploaded artifact (GLB / image maps / audio) the consumer:
 *   1. fetches the object from the bound R2 bucket,
 *   2. validates it with the pure `validateArtifact()` logic (magic bytes +
 *      non-empty floors) — the same failure class the web status routes guard,
 *   3. writes a small status object back to R2 next to the artifact
 *      (`<key>.status.json`) so the app / status routes can observe the result,
 *   4. ACKs the message on success, RETRIES on transient/unexpected errors so
 *      Cloudflare redelivers (and eventually dead-letters).
 *
 * FEATURE/ENV GUARD: every binding is optional. If `env.ASSET_BUCKET` is not
 * bound (e.g. a misconfigured deploy, or local `wrangler dev` without R2), the
 * consumer ACKs every message as a safe no-op and logs once — it NEVER throws
 * in a way that wedges the queue. Provisioning the bucket + queue is the user's
 * deploy step; until then this Worker is inert, never breaking anything.
 *
 * This file has no npm dependencies — it is deployed as-is by `wrangler deploy`.
 */

import { validateArtifact } from './validate.mjs';

/** Suffix for the sidecar status object written next to each artifact. */
const STATUS_SUFFIX = '.status.json';

/**
 * @typedef {Object} R2ObjectBody
 * @property {() => Promise<ArrayBuffer>} arrayBuffer
 * @property {{ contentType?: string }} [httpMetadata]
 * @property {number} [size]
 */

/**
 * @typedef {Object} R2Bucket
 * @property {(key: string) => Promise<R2ObjectBody | null>} get
 * @property {(key: string, value: string, opts?: object) => Promise<unknown>} put
 */

/**
 * @typedef {Object} QueueMessage
 * @property {unknown} body
 * @property {() => void} ack
 * @property {() => void} retry
 */

/**
 * Extract the R2 object key from an R2 event-notification message body.
 * R2 event notifications deliver `{ account, bucket, object: { key, size }, action }`.
 * Returns null when the shape is unrecognized (we then ACK as a no-op rather
 * than retry forever on malformed input).
 *
 * @param {unknown} body
 * @returns {string | null}
 */
export function extractKey(body) {
  if (body == null || typeof body !== 'object') return null;
  const b = /** @type {Record<string, unknown>} */ (body);
  // R2 event-notification shape.
  if (b.object && typeof b.object === 'object') {
    const key = /** @type {Record<string, unknown>} */ (b.object).key;
    if (typeof key === 'string' && key.length > 0) return key;
  }
  // Tolerate a flat `{ key }` shape (manual enqueue / tests).
  if (typeof b.key === 'string' && b.key.length > 0) return b.key;
  return null;
}

/**
 * Should this key be skipped (not a real artifact)? We never re-process our own
 * sidecar status objects, and skip delete actions.
 *
 * @param {string} key
 * @param {unknown} body
 * @returns {boolean}
 */
export function shouldSkip(key, body) {
  if (key.endsWith(STATUS_SUFFIX)) return true;
  const action =
    body && typeof body === 'object'
      ? /** @type {Record<string, unknown>} */ (body).action
      : undefined;
  // R2 emits actions like "PutObject" / "DeleteObject"; only validate creates.
  if (typeof action === 'string' && /delete/i.test(action)) return true;
  return false;
}

/**
 * Process a single queue message against the bound R2 bucket. Returns the
 * status record that was (or would be) written. Pure-ish: side effects limited
 * to `bucket.get` / `bucket.put`. Throws only on unexpected/transient failures
 * so the caller can `retry()`.
 *
 * @param {unknown} body
 * @param {R2Bucket} bucket
 * @returns {Promise<{ key: string, status: 'valid'|'failed'|'skipped', kind?: string, reason?: string }>}
 */
export async function processMessage(body, bucket) {
  const key = extractKey(body);
  if (!key) {
    return { key: '', status: 'skipped', reason: 'unrecognized message shape' };
  }
  if (shouldSkip(key, body)) {
    return { key, status: 'skipped', reason: 'status sidecar or delete event' };
  }

  const object = await bucket.get(key);
  if (!object) {
    // Object vanished (deleted between event and processing). Not retryable.
    return { key, status: 'skipped', reason: 'object not found' };
  }

  const bytes = await object.arrayBuffer();
  const contentType = object.httpMetadata?.contentType;
  const result = validateArtifact(key, contentType, bytes);

  const record = {
    key,
    status: /** @type {'valid'|'failed'} */ (result.valid ? 'valid' : 'failed'),
    kind: result.kind,
    reason: result.reason,
    bytes: bytes.byteLength,
    validatedAt: new Date().toISOString(),
  };

  await bucket.put(`${key}${STATUS_SUFFIX}`, JSON.stringify(record), {
    httpMetadata: { contentType: 'application/json' },
  });

  return { key, status: record.status, kind: result.kind, reason: result.reason };
}

export default {
  /**
   * Cloudflare Queue consumer entrypoint.
   *
   * @param {{ messages: QueueMessage[] }} batch
   * @param {{ ASSET_BUCKET?: R2Bucket }} env
   * @returns {Promise<void>}
   */
  async queue(batch, env) {
    const bucket = env.ASSET_BUCKET;
    if (!bucket) {
      // ENV GUARD: bucket not bound — ACK everything as an inert no-op so the
      // queue drains instead of wedging on retry. Deploy provisions the binding.
      console.warn(
        '[asset-postprocess] ASSET_BUCKET not bound; ACKing batch as no-op'
      );
      for (const message of batch.messages) message.ack();
      return;
    }

    for (const message of batch.messages) {
      try {
        const outcome = await processMessage(message.body, bucket);
        if (outcome.status === 'failed') {
          console.warn(
            `[asset-postprocess] artifact FAILED validation: ${outcome.key} (${outcome.kind}) — ${outcome.reason}`
          );
        }
        // Validation ran (valid OR failed) and the status was persisted: ACK.
        // A "failed" artifact is a successfully-processed message — the failure
        // is recorded in the sidecar, not a reason to redeliver.
        message.ack();
      } catch (err) {
        // Unexpected/transient error (R2 fetch hiccup, etc.) — RETRY so
        // Cloudflare redelivers and eventually dead-letters.
        console.error(
          `[asset-postprocess] transient error, retrying message:`,
          err instanceof Error ? err.message : String(err)
        );
        message.retry();
      }
    }
  },
};
