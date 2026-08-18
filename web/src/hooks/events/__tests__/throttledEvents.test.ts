/**
 * Pins every name in `THROTTLED_EVENTS` against the engine's actual emit sites.
 *
 * A name in that set is not routed by a switch, so nothing reports it when the
 * engine has never emitted it: the entry is silently inert and it fails in BOTH
 * directions — the shared 10fps throttle budget is spent on a phantom while the
 * real high-frequency event goes unthrottled and drives 60fps React re-renders.
 * `PHYSICS2D_UPDATED` sat in the set doing exactly that until PF-1167; the emitted
 * name is `PHYSICS2D_CHANGED`.
 *
 * The engine source is therefore read textually — `cargo test` cannot see a TS
 * constant and vitest cannot call Rust, so there is no compiler holding the two
 * sides together. Every parse failure is a test failure, never a skip: a suite that
 * quietly stops checking when its input moves is worse than no suite, because it
 * still reports green.
 *
 * Scope and its limit: this proves each throttled name is emitted SOMEWHERE in the
 * engine as a string literal. Emit sites are spread across `bridge/` and `core/`
 * (`TRANSFORM_CHANGED` is emitted from `core/gizmo.rs` and
 * `bridge/core_systems.rs`, not from `bridge/events.rs`), so the whole tree is
 * scanned. Every emit in the tree today passes a literal; a future dynamically-named
 * emit would fail this pin rather than slip past it, which is the safe direction.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { THROTTLED_EVENTS } from '../throttledEvents';

const ENGINE_SRC = path.resolve(__dirname, '../../../../../engine/src');

/**
 * The directory entries of `dir`, or a thrown explanation.
 *
 * The return type is inferred rather than annotated: `readdirSync` is overloaded
 * on its encoding option, and writing `ReturnType<typeof readdirSync>` selects the
 * Buffer-named overload, which then rejects every string operation on `entry.name`.
 */
function readEntries(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    throw new Error(
      `Could not read ${dir}: ${err instanceof Error ? err.message : String(err)}. ` +
        'This suite pins the throttle set against the engine source — if the tree ' +
        'moved, repoint ENGINE_SRC rather than deleting the assertions.',
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
 */
function emittedEventNames(): Set<string> {
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

describe('THROTTLED_EVENTS', () => {
  const emitted = emittedEventNames();

  it('is non-empty, so the assertions below are not vacuous', () => {
    expect(THROTTLED_EVENTS.size).toBeGreaterThan(0);
  });

  it.each([...THROTTLED_EVENTS])('%s is an event the engine actually emits', (name) => {
    expect(emitted.has(name)).toBe(true);
  });

  it('does not carry the PF-1167 phantom name', () => {
    // Named explicitly rather than left to the generic check above: the generic
    // check would also catch it, but this states the regression so a future reader
    // knows the entry was wrong once and why.
    expect(THROTTLED_EVENTS.has('PHYSICS2D_UPDATED')).toBe(false);
    expect(THROTTLED_EVENTS.has('PHYSICS2D_CHANGED')).toBe(true);
  });

  it('finds the emit sites this scan depends on, in the files they live in', () => {
    // Guards the scan itself. `TRANSFORM_CHANGED` is emitted from neither
    // `bridge/events.rs` nor a `physics`/`animation` module, so a scan narrowed to
    // one file would silently stop proving anything about most of the set.
    expect(emitted.has('TRANSFORM_CHANGED')).toBe(true);
    expect(emitted.has('PHYSICS_CHANGED')).toBe(true);
    expect(emitted.has('ANIMATION_STATE_CHANGED')).toBe(true);
  });
});
