/**
 * The text a tool's result becomes when it is handed back to the model.
 *
 * `appendToolTurn` (`stores/chatStore.ts`) used to build it as
 * `String(tc.result ?? 'Success')`. Most handlers return an OBJECT in
 * `ExecutionResult.result` — `get_game_components` returns `{ components, count }`,
 * `add_game_component` returns `{ message }`, `get_game_camera` returns
 * `{ camera, isActive }` — and `String({...})` is `"[object Object]"`, so for
 * every one of those calls the model was handed that literal text: query tools
 * returned no information at all, and write tools could not report anything
 * beyond "it ran" (#10143).
 *
 * Kept as its own module so the size policy is one number with one test, and
 * so the store's agentic loop does not grow another inline branch.
 */

/**
 * Longest tool-result text the model receives, in characters.
 *
 * Some results are large (a scene graph, a component dump, a prefab). Before
 * #10143 the model received NONE of that text, so turning it on changes token
 * cost and context use for every conversation; this bound keeps one result
 * from crowding out the conversation. 8,000 characters is roughly 2,000
 * tokens — enough for a full component dump or a few dozen scene-graph nodes,
 * and about a fifth of a typical tool-heavy turn's budget.
 */
export const MAX_TOOL_RESULT_CHARS = 8_000;

/**
 * Serialise a handler's `result` for the model.
 *
 * - `undefined` / `null` → `"Success"` (the handler said nothing).
 * - a string → itself.
 * - anything else → its JSON, as compact as `JSON.stringify` makes it.
 * - a value JSON cannot serialise (a cycle, a `BigInt`) → a one-line note
 *   naming the failure, never `"[object Object]"`.
 *
 * Any text longer than `cap` is cut there and says so, with the omitted
 * length, so the model knows it is reading a prefix.
 * @param result Whatever the handler returned in `ExecutionResult.result`.
 * @param cap Character bound; defaults to {@link MAX_TOOL_RESULT_CHARS}.
 * @returns The tool-result text.
 */
export function formatToolResultOutput(result: unknown, cap: number = MAX_TOOL_RESULT_CHARS): string {
  return bound(serialise(result), cap);
}

function serialise(result: unknown): string {
  if (result === undefined || result === null) return 'Success';
  if (typeof result === 'string') return result;
  try {
    // `JSON.stringify` returns `undefined` for a bare function or symbol; a
    // handler that returned one of those still ran.
    return JSON.stringify(result) ?? 'Success';
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `[result could not be serialised: ${reason}]`;
  }
}

function bound(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const omitted = text.length - cap;
  return `${text.slice(0, cap)}\n… [truncated: ${omitted} of ${text.length} characters omitted]`;
}
