import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Every place in the app that can reach `handle_command` is accounted for here.
 *
 * The payload guard only helps where it is called, and a new caller that
 * bypasses it is invisible — the failure it prevents is a wasm stack-overflow
 * trap that kills the engine instance, which no test of the new caller would
 * ever exercise. So rather than trying to detect an *unguarded* call (which
 * means parsing, and a comment-stripper is a blind region an attacker or an
 * accident can park code inside), this scans for any source file that so much
 * as names `handle_command` and requires it to appear below with a reason.
 *
 * Membership alone is not enough, though — a new call inside a file already on
 * the list would be invisible — so each entry also carries how many
 * call-shaped occurrences that file may contain.
 *
 * That is deliberately blunt: it also catches prose and emitted strings. The
 * cost is one line and a sentence when a genuinely new mention appears; the
 * benefit is that adding a fourth dispatch path is a reviewed act instead of a
 * silent one.
 */

const SRC = join(process.cwd(), 'src');

/**
 * Reason each file is allowed to name `handle_command`, and how many
 * call-shaped occurrences it may contain.
 *
 * The count is the load-bearing half. Accounting per *file* is not enough: a
 * new call added inside a file that is already on this list is invisible to a
 * membership check, which is exactly how `useScriptRunner`'s audio-occlusion
 * raycast sat outside the guarded dispatcher without anything noticing. A count
 * makes that a reviewed act too.
 *
 * `calls` counts `handle_command(` / `handle_command_batch(` — the call shape —
 * rather than every mention, so editing a comment or a doc string does not fail
 * the suite for no reason. Emitted player JS and description strings can still
 * match; those are counted and explained like anything else.
 */
const ACCOUNTED_FOR: Record<string, { calls: number; reason: string }> = {
  // --- The three guarded dispatch chokepoints -----------------------------
  'hooks/useEngine.ts': {
    calls: 2,
    reason: 'sendCommand / sendCommandBatch, each behind checkCommandPayload / checkCommandBatch',
  },
  'lib/scripting/useScriptRunner.ts': {
    calls: 2,
    reason:
      'dispatchCommand, behind checkCommandPayload; plus the audio-occlusion raycast, whose payload is a fixed five-key literal of numbers built in this file',
  },
  // The store's own wrapper is the third; it reaches the engine through the
  // dispatchers this file registers, so both are covered by the store guard.
  'hooks/useEngineEvents.ts': {
    calls: 2,
    reason:
      'registers its dispatchers through setCommandDispatcher / setCommandBatchDispatcher, which guard',
  },

  // --- Callers with payloads that cannot carry unbounded structure --------
  'components/editor/CanvasArea.tsx': {
    calls: 16,
    reason: 'fixed object literals built in the file',
  },
  'hooks/usePointerLock.ts': { calls: 1, reason: 'fixed { dx, dy } literal' },
  'components/play/GamePlayer.tsx': {
    calls: 3,
    reason: 'passes JSON *strings*; serde_json::from_str caps its own recursion at 128 levels',
  },

  // --- Not a call at all --------------------------------------------------
  'lib/engine/commandPayloadGuard.ts': { calls: 0, reason: 'the guard, describing what it protects' },
  'lib/engine/loadPlayEngine.ts': { calls: 0, reason: 'type declaration only' },
  'lib/ai/smartCamera.ts': { calls: 0, reason: 'comment' },
  'lib/monitoring/sentryConfig.ts': { calls: 0, reason: 'regex matched against error message text' },
  'lib/perf/baselines.ts': { calls: 1, reason: 'benchmark description string' },
  'app/blog/content/spawnforge-browser-ai-game-engine.tsx': { calls: 1, reason: 'prose code sample' },

  // --- Emitted into an exported game, which runs its own engine instance ---
  'lib/export/gameLoopFragment.ts': { calls: 0, reason: 'emits player JS; not a call in this app' },
  'lib/export/gameTemplate.ts': { calls: 3, reason: 'emits player JS; not a call in this app' },
  'lib/export/zipExporter.ts': { calls: 2, reason: 'emits player JS; not a call in this app' },
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry === '__integration__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('engine dispatch chokepoints', () => {
  const mentions = sourceFiles(SRC)
    .filter((file) => readFileSync(file, 'utf8').includes('handle_command'))
    .map((file) => relative(SRC, file).split(sep).join('/'))
    .sort();

  it('finds the files it is meant to be scanning', () => {
    // Fails closed: a broken walk (wrong cwd, renamed directory) would
    // otherwise report an empty set and pass while checking nothing.
    expect(mentions.length).toBeGreaterThan(5);
  });

  it('accounts for every file that can reach handle_command', () => {
    const unaccounted = mentions.filter((file) => !(file in ACCOUNTED_FOR));
    expect(unaccounted).toEqual([]);
  });

  it('has no stale entries', () => {
    const stale = Object.keys(ACCOUNTED_FOR).filter((file) => !mentions.includes(file));
    expect(stale).toEqual([]);
  });

  it('accounts for every call, not just every file', () => {
    // Membership alone cannot see a call added to a file already on the list.
    const CALL = /handle_command(?:_batch)?\s*\(/g;
    const actual: Record<string, number> = {};
    const expected: Record<string, number> = {};
    for (const file of mentions) {
      const entry = ACCOUNTED_FOR[file];
      if (!entry) continue; // reported by the membership test above
      actual[file] = (readFileSync(join(SRC, file), 'utf8').match(CALL) ?? []).length;
      expected[file] = entry.calls;
    }
    expect(actual).toEqual(expected);
  });

  it.each([
    ['hooks/useEngine.ts', ['checkCommandPayload', 'checkCommandBatch']],
    ['lib/scripting/useScriptRunner.ts', ['checkCommandPayload']],
  ])('%s still calls the guard', (file, expected) => {
    // The reason above is a claim; this is the check. A refactor that drops the
    // call would otherwise leave the claim standing.
    const source = readFileSync(join(SRC, file), 'utf8');
    expect(source).toContain("from '@/lib/engine/commandPayloadGuard'");
    for (const fn of expected) {
      expect(source).toContain(`${fn}(`);
    }
  });

  it('the store wrapper guards both dispatch paths', () => {
    const source = readFileSync(join(SRC, 'stores/editorStore.ts'), 'utf8');
    expect(source).toContain("from '@/lib/engine/commandPayloadGuard'");
    expect(source).toContain('checkCommandPayload(');
    expect(source).toContain('checkCommandBatch(');
  });
});
