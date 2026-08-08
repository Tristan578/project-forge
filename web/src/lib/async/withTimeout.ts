/**
 * Race a promise against a wall-clock deadline.
 *
 * Deliberately a leaf module with no imports: the public `/play` bundle needs
 * this helper but must not pull in the editor's `useEngine` graph (Sentry
 * client, CDN analytics, toast, init logging, module-level mutable state) just
 * to get it.
 *
 * **This bounds the WAIT, not the WORK.** Rejecting on the deadline does not
 * cancel `promise` — a promise has no cancellation channel, so the underlying
 * operation keeps running to completion in the background. Two consequences for
 * callers:
 *
 * - Anything the work does on its way to settling (network requests, module
 *   instantiation, writes to module-level state) still happens after you have
 *   given up on it.
 * - If a timeout leads to a *retry*, the retry runs CONCURRENTLY with the
 *   attempt that timed out, not after it. Work that is unsafe to run twice
 *   needs its own latch — see `loadPlayEngine`, whose wasm-bindgen init is not
 *   idempotent and so joins callers onto the attempt already in flight.
 *
 * @param promise the work to bound
 * @param ms deadline in milliseconds
 * @param label prefix for the rejection message, e.g. "Engine load"
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
