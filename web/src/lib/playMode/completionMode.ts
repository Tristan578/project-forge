/**
 * Completion modes: how a game is considered "complete" (#9901, #9998).
 *
 * This module is the ONE vocabulary and the ONE validator. Every surface that
 * SETS a scene's mode goes through `validateCompletionMode`: the manual picker
 * (via the store's `setCompletionMode`), the `set_completion_mode` chat tool
 * (which calls that same store action), and the decomposer's brief schema
 * (`z.enum(COMPLETION_MODES)`). Accepting and rejecting the same values with
 * the same words is the manual/AI parity the issue asks for, so it is made true
 * by construction rather than by two copies agreeing.
 *
 * Deliberately dependency-free. `decomposer.ts` runs server-side inside
 * `/api/game/decompose`, and `stores/` is client-only
 * (`serverSafeImports.test.ts`), so the vocabulary cannot live in
 * `stores/slices/types.ts`; that file re-exports it from here instead.
 */

/** Every completion mode, single-sourced for validators, UI menus and Zod. */
export const COMPLETION_MODES = ['win', 'endless', 'sandbox', 'narrative'] as const;

/**
 * How a game is considered "complete", authored intentionally by the creator
 * rather than inferred from the scene's contents.
 *
 * - `win`       — a classic goal-driven game; the pre-play winnability gate
 *                 requires at least one satisfiable win condition (the legacy
 *                 behaviour, and the default for every scene without the field).
 * - `endless`   — score-chasing / survival with no terminal win state.
 * - `sandbox`   — a toy or creative space with no win condition at all.
 * - `narrative` — a story/exploration piece that ends by authored progression.
 *
 * Only `win` (and, per the legacy convention below, its absence) demands a win
 * condition; the other three intentionally do not. A win condition that IS
 * present is validated in every mode.
 */
export type CompletionMode = (typeof COMPLETION_MODES)[number];

/**
 * The mode assumed when a scene carries no `completionMode`.
 *
 * Legacy rule (documented in `docs/features/save-load.md`): a scene written
 * before the field existed has no `completionMode` key and MUST behave exactly
 * as it did before, i.e. as a `win`-mode game. The mode is never inferred from
 * entity names; absence deterministically means `win`.
 */
export const DEFAULT_COMPLETION_MODE: CompletionMode = 'win';

/** Picker label and one-sentence consequence for each mode. */
export const COMPLETION_MODE_INFO: Readonly<Record<CompletionMode, { label: string; description: string }>> = {
  win: {
    label: 'Win',
    description: 'Goal-driven. Play requires at least one win condition the player can complete.',
  },
  endless: {
    label: 'Endless',
    description: 'Score-chasing or survival with no final win. Play does not require a win condition.',
  },
  sandbox: {
    label: 'Sandbox',
    description: 'A toy or creative space with no goal. Play does not require a win condition.',
  },
  narrative: {
    label: 'Narrative',
    description: 'A story or exploration piece that ends through authored progression. Play does not require a win condition.',
  },
};

/**
 * Whether a completion mode demands at least one satisfiable win condition.
 *
 * Only `endless`, `sandbox` and `narrative` are exempt. EVERYTHING else returns
 * true — that deliberately includes `undefined` (a legacy scene written before
 * the field existed) and any unexpected value that a hand-edited or older
 * `.forge` file might carry. Both the pre-play gate (`validateWinnability`)
 * and the plan builder's default-goal guarantee read this one predicate, so the
 * game the pipeline plans and the game Play accepts cannot disagree. Fail-CLOSED:
 * absence, or a value we do not recognise, is `win`, never "no goal needed".
 * @param mode The scene's or brief's mode, possibly absent or untrusted.
 * @returns False only for the three modes that intentionally have no goal.
 */
export function requiresWinCondition(mode: unknown): boolean {
  return mode !== 'endless' && mode !== 'sandbox' && mode !== 'narrative';
}

/** Outcome of validating a candidate mode. `error` is shown to people AND to the model. */
export type CompletionModeValidation =
  | { ok: true; mode: CompletionMode }
  | { ok: false; error: string };

const MODE_LIST = COMPLETION_MODES.join(', ');

/** Longest slice of a rejected value echoed back in an error. */
const MAX_ECHO_LENGTH = 32;

/**
 * Narrow an unknown value to a completion mode. Exact match only: persisted
 * data is compared byte for byte on reload, so a spelling accepted here but
 * refused by the reader would be a silent revert to `win`.
 */
export function isCompletionMode(value: unknown): value is CompletionMode {
  return typeof value === 'string' && (COMPLETION_MODES as readonly string[]).includes(value);
}

/**
 * Describe a rejected non-string for an error message without echoing it.
 * @param value The rejected value.
 * @returns A short noun phrase such as "a number".
 */
function describeReceived(value: unknown): string {
  if (value === undefined) return 'no value';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  switch (typeof value) {
    case 'number':
    case 'bigint':
      return 'a number';
    case 'boolean':
      return 'a boolean';
    case 'object':
      return 'an object';
    default:
      return `a ${typeof value}`;
  }
}

/**
 * The shared validator for every surface that sets a completion mode.
 *
 * A rejected string is echoed back so the model can correct itself, but only
 * after neutralizing it: the error becomes a tool result the AI reads, so a
 * crafted value must not carry quotes, newlines or unbounded text into that
 * context (the same posture as `safeLabel` in `winnabilityValidator.ts`).
 * @param value Candidate mode from a picker, a tool call or a brief.
 * @returns The mode, or the one error text every surface reports.
 */
export function validateCompletionMode(value: unknown): CompletionModeValidation {
  if (isCompletionMode(value)) return { ok: true, mode: value };
  if (typeof value === 'string') {
    const echoed = value.replace(/[^\w.\- ]+/g, '').trim().slice(0, MAX_ECHO_LENGTH) || 'empty';
    return { ok: false, error: `Unknown completion mode "${echoed}". Choose one of: ${MODE_LIST}.` };
  }
  return {
    ok: false,
    error: `Completion mode must be one of: ${MODE_LIST}. Received ${describeReceived(value)}.`,
  };
}
