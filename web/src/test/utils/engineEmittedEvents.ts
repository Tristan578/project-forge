/**
 * The set of event names the engine actually emits, read out of the Rust source.
 *
 * An inbound `case 'X'` for a name nothing emits is silently dead — the switch
 * returns `false` and no test, type or lint reports it. `physicsEvents.ts` carried
 * three such arms until PF-1167, complete with ten passing tests written against a
 * wire format that existed only in the suite. The same silence runs the other way
 * for `THROTTLED_EVENTS`, where a phantom name spends the throttle budget while the
 * real high-frequency event goes unthrottled.
 *
 * `cargo test` cannot see a TS constant and vitest cannot call Rust, so nothing
 * holds the two sides together except reading the engine textually. This module is
 * the one copy of that scan; it lived inside `throttledEvents.test.ts` until
 * `gameEvents.test.ts` needed it too (PF-1214).
 *
 * Every parse failure throws. A suite that quietly stops checking when its input
 * moves is worse than no suite, because it still reports green.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const ENGINE_SRC = path.resolve(__dirname, '../../../../engine/src');

/**
 * The directory entries of `dir`, or a thrown explanation.
 *
 * The return type is inferred rather than annotated: `readdirSync` is overloaded on
 * its encoding option, and writing `ReturnType<typeof readdirSync>` selects the
 * Buffer-named overload, which then rejects every string operation on `entry.name`.
 */
function readEntries(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(
      `Could not read ${dir}: ${err instanceof Error ? err.message : String(err)}. ` +
        'This scan pins TS event vocabularies against the engine source — if the ' +
        'tree moved, repoint ENGINE_SRC rather than deleting the assertions.',
    );
  }
}

/** Every `.rs` file under `engine/src`, recursively. */
function rustFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readEntries(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...rustFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.rs')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * The set of event names the engine emits.
 *
 * Matched on `emit_event("NAME"` so the three call spellings in the tree
 * (`emit_event`, `events::emit_event`, `crate::bridge::events::emit_event`) are all
 * covered by one pattern.
 *
 * Scope and its limit: this proves a name is emitted SOMEWHERE in the engine as a
 * string literal. Emit sites are spread across `bridge/` and `core/`
 * (`TRANSFORM_CHANGED` comes from `core/gizmo.rs` as well as
 * `bridge/core_systems.rs`), so the whole tree is scanned. Every emit in the tree
 * today passes a literal; a future dynamically-named emit would fail this scan
 * rather than slip past it, which is the safe direction.
 */
export function emittedEventNames(): Set<string> {
  const files = rustFiles(ENGINE_SRC);
  if (files.length === 0) {
    throw new Error(`No .rs files found under ${ENGINE_SRC} — refusing to pass vacuously.`);
  }

  const names = new Set<string>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/emit_event\(\s*"([A-Z0-9_]+)"/g)) {
      names.add(match[1]);
    }
  }

  if (names.size === 0) {
    throw new Error(
      `Found no emit_event("NAME") sites under ${ENGINE_SRC}. Either the call spelling ` +
        'changed or the scan is broken — refusing to pass vacuously.',
    );
  }
  return names;
}
