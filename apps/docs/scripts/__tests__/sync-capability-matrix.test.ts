import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  CANONICAL_MATRIX_PATH,
  MATRIX_COPY_PATH,
  MATRIX_SOURCE,
  checkMatrixCopy,
  checkMatrixCopyOnDisk,
  renderMatrixCopy,
  toMatrixCopy,
} from '../sync-capability-matrix.js';

const MARKDOWN = '# Capability Matrix\n\n| A | B |\n|---|---|\n| `commands:scene` | proven |\n';

describe('toMatrixCopy / renderMatrixCopy', () => {
  it('round-trips the markdown line for line, trailing newline included', () => {
    const copy = toMatrixCopy(MARKDOWN);
    expect(copy.source).toBe(MATRIX_SOURCE);
    expect(copy.lines.at(-1)).toBe(''); // the trailing newline survives as an empty last line
    expect(copy.lines.join('\n')).toBe(MARKDOWN);
    expect(JSON.parse(renderMatrixCopy(copy))).toEqual(copy);
    expect(renderMatrixCopy(copy).endsWith('\n')).toBe(true);
  });

  it('keeps one array element per markdown line so a review diff is line-scoped', () => {
    expect(toMatrixCopy('a\nb\nc').lines).toEqual(['a', 'b', 'c']);
  });
});

describe('checkMatrixCopy', () => {
  it('passes for a copy generated from the same markdown', () => {
    expect(checkMatrixCopy(MARKDOWN, renderMatrixCopy(toMatrixCopy(MARKDOWN)))).toEqual({ passed: true });
  });

  it('fails when a line differs', () => {
    const stale = renderMatrixCopy(toMatrixCopy(MARKDOWN.replace('proven', 'partial (#1)')));
    const result = checkMatrixCopy(MARKDOWN, stale);
    expect(result.passed).toBe(false);
    expect(result.error).toMatch(/out of sync/);
    expect(result.error).toMatch(/sync:capability-matrix/);
  });

  it('fails on invalid JSON, a missing lines array, and a wrong source', () => {
    expect(checkMatrixCopy(MARKDOWN, '{').passed).toBe(false);
    expect(checkMatrixCopy(MARKDOWN, '{"source":"docs/capability-matrix.md"}').error).toMatch(/lines/);
    expect(checkMatrixCopy(MARKDOWN, '{"source":"x","lines":[]}').error).toMatch(/source/);
    expect(
      checkMatrixCopy(MARKDOWN, JSON.stringify({ source: MATRIX_SOURCE, lines: [1, 2] })).error,
    ).toMatch(/lines/);
  });
});

describe('checkMatrixCopyOnDisk', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capability-matrix-sync-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('fails (never passes) when either file is missing', () => {
    const md = path.join(tmpDir, 'matrix.md');
    const json = path.join(tmpDir, 'matrix.json');
    expect(checkMatrixCopyOnDisk(md, json).error).toMatch(/canonical/);
    fs.writeFileSync(md, MARKDOWN);
    expect(checkMatrixCopyOnDisk(md, json).error).toMatch(/copy/);
  });

  it('passes for a copy written from the canonical file', () => {
    const md = path.join(tmpDir, 'matrix.md');
    const json = path.join(tmpDir, 'matrix.json');
    fs.writeFileSync(md, MARKDOWN);
    fs.writeFileSync(json, renderMatrixCopy(toMatrixCopy(MARKDOWN)));
    expect(checkMatrixCopyOnDisk(md, json)).toEqual({ passed: true });
  });

  it('the defaults point at the real pair and that pair is in sync', () => {
    // The docs gate calls this with no arguments; the committed copy must be
    // current or `check-manifest-sync.ts` goes red.
    expect(CANONICAL_MATRIX_PATH.endsWith(path.join('docs', 'capability-matrix.md'))).toBe(true);
    expect(MATRIX_COPY_PATH.endsWith(path.join('apps', 'docs', 'data', 'capability-matrix.json'))).toBe(true);
    expect(checkMatrixCopyOnDisk()).toEqual({ passed: true });
  });
});

describe('capability-matrix source-line citations resolve to the symbol they name', () => {
  // A citation like `channels/leaderboardChannel.ts:41` is only useful if the
  // cited line actually holds the thing the sentence describes. The matrix once
  // pointed at :31 — the closing brace of the unrelated `LeaderboardEntry`
  // interface — while the prose described the channel routing handler, which
  // starts at :41. A line-for-line sync check cannot catch that; this does (#9733).
  it('the leaderboardChannel.ts citation points at createLeaderboardHandler', () => {
    const repoRoot = path.dirname(path.dirname(CANONICAL_MATRIX_PATH));
    const md = fs.readFileSync(CANONICAL_MATRIX_PATH, 'utf8');
    const sourceLines = fs
      .readFileSync(path.join(repoRoot, 'web/src/lib/scripting/channels/leaderboardChannel.ts'), 'utf8')
      .split('\n');
    const citedLineNumbers = [...md.matchAll(/leaderboardChannel\.ts:(\d+)/g)].map((m) => Number(m[1]));
    // The matrix must actually cite the channel — a zero-match walk would pass vacuously.
    expect(citedLineNumbers.length).toBeGreaterThan(0);
    for (const lineNumber of citedLineNumbers) {
      // Citations are 1-indexed; the array is 0-indexed.
      expect(sourceLines[lineNumber - 1]).toContain('createLeaderboardHandler');
    }
  });
});
