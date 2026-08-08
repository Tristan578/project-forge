/**
 * Drift guard for the "produced no <artifact>" message catalogue.
 *
 * There are two entirely separate paths to the same user-visible failure:
 *
 *   1. submit-time — `EmptyArtifactError` thrown out of a generate route's
 *      `execute`, formatted by `createGenerationHandler`;
 *   2. poll-time — a `*／status` route (or `pollProviderStatus`) seeing a
 *      provider report success with no artifact.
 *
 * They compose their sentences independently, so they can disagree without
 * either one looking wrong in review — and they did: a test constructed
 * `('Texture', 'texture maps')` and produced "…produced no texture maps" while
 * the texture status route has always said "…produced no maps". Same condition,
 * two sentences.
 *
 * This suite makes the two label arrays the single vocabulary both paths draw
 * from, and fails if a sentence appears anywhere in the source that the arrays
 * cannot build.
 *
 * @vitest-environment node
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  ARTIFACT_LABELS,
  EmptyArtifactError,
  GENERATION_TYPE_LABELS,
} from '../emptyArtifactError';

const SRC = join(process.cwd(), 'src');

/** Every `.ts`/`.tsx` under src/, excluding tests — tests assert on the copy. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      sourceFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/**
 * Pulls `<Type> generation produced no <artifact>` out of string literals.
 *
 * Anchored on the closing quote so the artifact noun cannot run past the end of
 * the sentence — without that, "produced no maps" and "produced no texture maps"
 * both match and the drift this suite exists to catch reads as a pass.
 */
const SENTENCE = /(['"`])([A-Z][A-Za-z ]*?) generation produced no ([a-z ]+?)\1/g;

/**
 * Comments are prose, not shipped copy — and this file's own header quotes the
 * drifted sentence as the worked example of what went wrong. Scanning comments
 * would make documenting the bug indistinguishable from committing it.
 */
function stripComments(source: string): string {
  // Line comments are stripped only when they OWN the line. A greedy
  // "everything after the first //" would also eat any line carrying a URL,
  // silently hiding a real offender that happened to share it.
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

describe('produced-no message catalogue', () => {
  const files = sourceFiles(SRC);

  it('scans a non-trivial number of source files', () => {
    // A broken walker finds nothing and every assertion below passes vacuously.
    expect(files.length).toBeGreaterThan(500);
  });

  it('finds the sentences it is meant to be checking', () => {
    const total = files.reduce(
      (n, f) => n + [...stripComments(readFileSync(f, 'utf8')).matchAll(SENTENCE)].length,
      0,
    );
    // The status routes plus pollProviderStatus already ship well over a dozen.
    expect(total).toBeGreaterThan(10);
  });

  it('rejects a sentence the label arrays cannot build', () => {
    // Negative control for the regex + membership check above: the pre-fix
    // wording must be detected as off-catalogue, or a green run means nothing.
    const [, , type, artifact] = SENTENCE.exec(
      `'Texture generation produced no texture maps'`,
    )!;
    SENTENCE.lastIndex = 0;
    expect(type).toBe('Texture');
    expect(artifact).toBe('texture maps');
    expect(ARTIFACT_LABELS as readonly string[]).not.toContain(artifact);
  });

  it('every sentence in the source is drawn from the two label arrays', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const [, , type, artifact] of source.matchAll(SENTENCE)) {
        const knownType = (GENERATION_TYPE_LABELS as readonly string[]).includes(type);
        const knownArtifact = (ARTIFACT_LABELS as readonly string[]).includes(artifact);
        if (!knownType || !knownArtifact) {
          offenders.push(
            `${file.replace(SRC, 'src')}: "${type} generation produced no ${artifact}"`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('EmptyArtifactError', () => {
  it('composes the sentence from its two nouns', () => {
    const err = new EmptyArtifactError('Pixel art', 'image');
    expect(err.message).toBe('Pixel art generation produced no image');
    expect(err.name).toBe('EmptyArtifactError');
    expect(err).toBeInstanceOf(Error);
  });

  it('keeps both nouns as readable properties for structured reporting', () => {
    // Sentry groups on the message, so "which artifact" is only a searchable
    // facet if the handler can read it off the error rather than parse it back
    // out of the sentence.
    const err = new EmptyArtifactError('Texture', 'maps');
    expect(err.generationType).toBe('Texture');
    expect(err.artifact).toBe('maps');
  });
});
