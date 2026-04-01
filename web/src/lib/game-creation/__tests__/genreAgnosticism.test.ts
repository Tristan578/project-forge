/**
 * B10 — Genre Agnosticism Test
 *
 * Verifies that the game-creation library contains no genre terminology.
 * Games are compositions of systems (movement, input, camera, etc.), not genres.
 * Genre labels in the library code would bias the orchestrator toward categories
 * rather than system composition.
 *
 * Scans all .ts source files in the game-creation/ directory, excluding
 * __tests__/ and __fixtures__/ subdirectories.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Genre terms to prohibit (as standalone words)
// ---------------------------------------------------------------------------

const GENRE_PATTERN =
  /\b(platformer|rpg|shooter|racing|puzzle|roguelike|metroidvania|fps|mmorpg|rts|moba)\b/i;

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

const GAME_CREATION_DIR = path.resolve(
  __dirname,
  '..',
);

const EXCLUDED_DIRS = new Set(['__tests__', '__fixtures__']);

function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        results.push(...collectTsFiles(path.join(dir, entry.name)));
      }
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Comment and string stripping
//
// We want to allow genre words in:
// - Line comments: // platformer is a genre
// - Block comments: /* platformer */
// - Test description strings: describe('platformer', ...), it('is not a platformer', ...)
//
// For this test we scan the actual code tokens (non-comment, non-string portions).
// Strategy: strip block comments, line comments, then string literals, then check.
// This ensures genre terms in error messages or user-facing strings don't false-positive.
// ---------------------------------------------------------------------------

function stripCommentsAndStrings(source: string): string {
  // Strip block comments (/* ... */) — non-greedy
  let stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
  // Strip line comments (// ...)
  stripped = stripped.replace(/\/\/[^\n]*/g, '');
  // Strip template literals (`...`)
  stripped = stripped.replace(/`[^`]*`/g, '""');
  // Strip single-quoted strings ('...')
  stripped = stripped.replace(/'[^']*'/g, '""');
  // Strip double-quoted strings ("...")
  stripped = stripped.replace(/"[^"]*"/g, '""');
  return stripped;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Genre Agnosticism (B10)', () => {
  const files = collectTsFiles(GAME_CREATION_DIR);

  it('discovers at least one source file to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const filePath of files) {
    const relativePath = path.relative(GAME_CREATION_DIR, filePath);

    it(`${relativePath} contains no genre terminology`, () => {
      const source = fs.readFileSync(filePath, 'utf8');
      const stripped = stripCommentsAndStrings(source);
      const lines = stripped.split('\n');

      const violations: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (GENRE_PATTERN.test(line)) {
          violations.push(
            `  Line ${i + 1}: ${line.trim()}`,
          );
        }
      }

      expect(violations, `Genre terminology found in ${relativePath}:\n${violations.join('\n')}`).toHaveLength(0);
    });
  }
});
