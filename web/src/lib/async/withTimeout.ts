/**
 * Race a promise against a wall-clock deadline.
 *
 * Deliberately a leaf module with no imports: the public `/play` bundle needs
 * this helper but must not pull in the editor's `useEngine` graph (Sentry
 * client, CDN analytics, toast, init logging, module-level mutable state) just
 * to get it.
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
