/**
 * Size and depth bounds for a command payload, checked before it crosses into
 * WASM.
 *
 * The engine enforces the same two bounds in `engine/src/core/json_guard.rs`,
 * and that is the real backstop — it covers every caller, including hosts that
 * are not this browser. This copy exists because on the wasm path the Rust
 * guard is already too late: `handle_command` receives the payload through
 * `serde_wasm_bindgen::from_value`, which walks the JS value recursively to
 * build the `serde_json::Value` before a single line of engine code runs. A
 * payload deep enough to overflow the stack does so during that conversion, and
 * on wasm32 a stack overflow is an unrecoverable trap: the engine instance dies
 * and the canvas never draws again.
 *
 * So the refusal has to happen while the structure is still a JS object, which
 * means at every point that calls `handle_command` / `handle_command_batch` —
 * not just the one the editor happens to use. There are three: the store's
 * dispatcher wrapper (every slice and every batch), `useEngine`'s `sendCommand`
 * / `sendCommandBatch`, and `useScriptRunner`'s dispatcher, which is the one
 * that carries genuinely untrusted input — a user script running in the Web
 * Worker can post a payload of any shape it likes, and `structuredClone`
 * survives depths far past what the conversion does.
 * `__tests__/dispatchChokepoints.test.ts` fails if a fourth appears unguarded.
 *
 * The numbers are pinned against the Rust source by
 * `__tests__/commandPayloadGuard.test.ts` rather than trusted to stay in step —
 * a hand-mirrored constant that drifts would leave a band of payloads the
 * editor accepts and the engine rejects, or the reverse.
 *
 * Kept free of any `@/stores` or `@/hooks` value-import: the dispatch path is
 * reachable from server-rendered code, and a client-only module edge here is a
 * `next build` failure (PF-1118).
 */

/**
 * Maximum nesting depth accepted in a command payload.
 *
 * Depth is 1-based, matching the Rust guard: a bare scalar is depth 1 and
 * `{ a: 1 }` is depth 2.
 */
export const MAX_COMMAND_PAYLOAD_DEPTH = 32;

/**
 * Maximum number of containers (objects, arrays, `Map`s, `Set`s) in a payload.
 *
 * Containers are counted and scalars are not, and that distinction is the whole
 * point rather than an optimisation. Depth is what turns into stack frames, and
 * a scalar adds none — so a wide run of numbers is cheap in exactly the way this
 * bound exists to police, and it is something the product legitimately sends.
 * `TilemapLayer.tiles` is a flat `(number | null)[]` of `mapSize[0] *
 * mapSize[1]` entries and `TilemapInspector` permits 1000×1000 per layer, so one
 * ordinary tilemap edit carries up to a million scalars beneath a handful of
 * containers. The first version of this guard counted every value against
 * 50,000 and therefore refused every tilemap past roughly 223×223.
 */
export const MAX_COMMAND_PAYLOAD_CONTAINERS = 50_000;

/** Maximum number of containers in a whole batch envelope. */
export const MAX_BATCH_CONTAINERS = 200_000;

/**
 * Children of a value, or `null` when it is a scalar.
 *
 * `Map` and `Set` are included because `serde_wasm_bindgen` converts them, so a
 * structure nested through them reaches the same recursive build — and neither
 * exposes its contents as own enumerable properties, so a walk over
 * `Object.values` alone would report a depth of 1 for arbitrarily deep input.
 */
function childrenOf(value: unknown): unknown[] | null {
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return [...value.keys(), ...value.values()];
  if (value instanceof Set) return [...value];
  return Object.values(value);
}

/** Whether a value has children, without building the list of them. */
function isContainer(value: unknown): boolean {
  return value !== null && typeof value === 'object';
}

/**
 * Walk a value against the two bounds, iteratively.
 *
 * The walk keeps its own stack rather than recursing, so checking a hostile
 * payload cannot itself overflow at exactly the depth it was written to catch.
 * Only containers go on that stack, and each is charged against the bound
 * *before* it is pushed — so a wide array of containers cannot grow the scratch
 * stack past the limit before the limit is noticed.
 *
 * Bounding the container count also makes a cyclic payload safe as a side
 * effect: a cycle is unbounded structure, so the walk hits the ceiling and
 * reports it rather than spinning. That matters, because a cycle sent onward
 * would hang the conversion inside WASM with no error to observe.
 */
function inspect(
  what: string,
  payload: unknown,
  maxDepth: number,
  maxContainers: number,
): string | null {
  const tooDeep = () => `${what} nested too deeply (over ${maxDepth} levels)`;
  const tooMuch = () =>
    `${what} has too much structure (over ${maxContainers} objects and arrays)`;

  const stack: Array<{ value: unknown; depth: number }> = [];
  let containers = 0;
  if (isContainer(payload)) {
    containers = 1;
    stack.push({ value: payload, depth: 1 });
  }

  while (stack.length > 0) {
    // Non-null assertion is safe: the loop condition is the length check.
    const { value, depth } = stack.pop()!;
    if (depth > maxDepth) return tooDeep();

    const children = childrenOf(value);
    if (children === null) continue;
    const childDepth = depth + 1;
    for (const child of children) {
      if (isContainer(child)) {
        containers += 1;
        if (containers > maxContainers) return tooMuch();
        stack.push({ value: child, depth: childDepth });
      } else if (childDepth > maxDepth) {
        return tooDeep();
      }
    }
  }
  return null;
}

/**
 * Reject a command payload that is nested too deeply or carries too much
 * structure.
 *
 * Returns the reason, or `null` when the payload is acceptable — so the caller
 * reads as `const reason = checkCommandPayload(...); if (reason) { … }` and a
 * forgotten check is a payload that was never guarded rather than one that
 * silently passed.
 */
export function checkCommandPayload(command: string, payload: unknown): string | null {
  return inspect(command, payload, MAX_COMMAND_PAYLOAD_DEPTH, MAX_COMMAND_PAYLOAD_CONTAINERS);
}

/**
 * Reject a whole batch envelope.
 *
 * Looser by the two levels the envelope itself costs — the array, then the item
 * object — so a payload that is legal on its own is not refused merely for
 * being batched. This mirrors `check_command_batch` in the Rust guard, which is
 * looser for the same reason.
 */
export function checkCommandBatch(batch: unknown): string | null {
  return inspect('batch', batch, MAX_COMMAND_PAYLOAD_DEPTH + 2, MAX_BATCH_CONTAINERS);
}
