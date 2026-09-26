/**
 * AST interpreter transport (#8700, Option B) — SCAFFOLD ONLY.
 *
 * The idea: walk acorn's ESTree (acorn is already a dependency via
 * `loopGuards.ts`) and evaluate it against an allowlisted scope, so no
 * `Function`/`eval` is ever in a script's reach and the editor CSP could drop
 * `'unsafe-eval'`.
 *
 * It is deliberately NOT built. A correct and secure tree-walker has to
 * re-implement closures, loops, the loop-guard counters, `console`, `Math` and
 * every construct authored games use against the ~230-method `forge` surface —
 * and every construct it does not support silently breaks a game. Option A
 * (`sandboxOrigin.ts`) already meets the issue's acceptance criterion, so this
 * mode exists only to reserve the flag value.
 *
 * `NEXT_PUBLIC_SCRIPT_ISOLATION='ast'` therefore resolves to the
 * `sandboxed-origin` transport with a visible notice (see
 * `resolveScriptTransport` in `sandboxConfig.ts`) — upward to the stronger
 * boundary, never down to `revoke`.
 */

/** Flip only when a real evaluator lands, together with a transport for it. */
export const AST_INTERPRETER_IMPLEMENTED = false;

/**
 * Refuses clearly. Nothing calls this today; it exists so a future caller that
 * wires the `ast` mode directly fails loudly instead of running scripts through
 * an evaluator that does not exist.
 */
export function createAstScriptHost(): never {
  throw new Error(
    'The AST script interpreter (#8700 Option B) is not implemented. ' +
      "Use NEXT_PUBLIC_SCRIPT_ISOLATION='sandboxed-origin'.",
  );
}
