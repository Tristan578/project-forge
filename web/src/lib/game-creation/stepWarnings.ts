/**
 * Reading the degraded-success notes off a step's output.
 *
 * An executor that ran but could not do the whole job reports it by putting a
 * note on its OUTPUT, not by failing: `cameraSetupExecutor` says the camera has
 * nothing to follow, `customScriptExecutor` says the generated script is
 * low-confidence, `verifyExecutor` lists what it could not confirm. Every one of
 * those strings was computed and then dropped — `onStepComplete` read
 * `result.success` and nothing else — so the step rendered as a green tick and
 * the user was told, in effect, that a camera which will never move was
 * "applied".
 *
 * That is the PF-1125 defect one layer up: a value with no consumer. This module
 * is the consumer.
 */

/** The two shapes executors already use for a non-fatal note. */
const SINGULAR_KEY = 'warning';
const PLURAL_KEY = 'warnings';

function pushIfMeaningful(into: string[], value: unknown): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  // A blank note is worse than none: it renders an empty warning box.
  if (trimmed.length === 0) return;
  if (into.includes(trimmed)) return;
  into.push(trimmed);
}

/**
 * Every user-facing note carried by one step's output, in the order the executor
 * produced them, de-duplicated and stripped of blanks.
 *
 * Reads `warning` (a string) and `warnings` (an array of strings) because both
 * spellings are already in the tree — normalizing here rather than rewriting
 * three executors keeps the executors' own tests as the contract they were
 * written against.
 *
 * Own keys only. The output object crosses no trust boundary today, but the
 * value under `warnings` is rendered to the user, and a `warnings` inherited
 * from a prototype is not something a step reported about itself.
 */
export function collectStepWarnings(
  output: Record<string, unknown> | undefined,
): string[] {
  if (typeof output !== 'object' || output === null) return [];

  const messages: string[] = [];

  if (Object.hasOwn(output, SINGULAR_KEY)) {
    pushIfMeaningful(messages, output[SINGULAR_KEY]);
  }

  if (Object.hasOwn(output, PLURAL_KEY)) {
    const plural = output[PLURAL_KEY];
    if (Array.isArray(plural)) {
      for (const entry of plural) pushIfMeaningful(messages, entry);
    }
  }

  return messages;
}
