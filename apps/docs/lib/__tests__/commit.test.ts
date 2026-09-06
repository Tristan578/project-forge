/**
 * @vitest-environment node
 *
 * The commit stamp every docs page carries in its <head>, and the one name
 * `scripts/post-deploy-docs-check.sh` greps for on the live site. The bash
 * suite for that script pins the name against this module; this file pins
 * what the stamp's VALUE is under each environment the layout can run in.
 */
import { describe, it, expect } from 'vitest';

import { DOCS_COMMIT_META_NAME, UNKNOWN_COMMIT, commitStampOf } from '../commit';

describe('commitStampOf', () => {
  it('returns VERCEL_GIT_COMMIT_SHA verbatim when it is a git SHA', () => {
    const sha = 'abcdef1234567890abcdef1234567890abcdef12';
    expect(commitStampOf({ VERCEL_GIT_COMMIT_SHA: sha })).toBe(sha);
  });

  it('accepts an abbreviated SHA of at least the width the deploy gate compares (8+ hex chars)', () => {
    expect(commitStampOf({ VERCEL_GIT_COMMIT_SHA: 'abcdef12' })).toBe('abcdef12');
  });

  it('renders a 7-char abbreviation as unknown — shorter than the gate compares', () => {
    // `scripts/post-deploy-docs-check.sh` compares the leading 8 chars
    // (COMMIT_COMPARE_WIDTH). A 7-char stamp of the very commit under test
    // could never equal that expectation, so the gate would report the right
    // build as a DIFFERENT one and fail the deploy on a mismatch that does not
    // exist. UNKNOWN_COMMIT says "this build has no usable SHA" instead, which
    // the gate diagnoses as exactly that. `scripts/__tests__/post-deploy-docs-check.test.sh`
    // cross-pins the two widths so they cannot drift apart again.
    expect(commitStampOf({ VERCEL_GIT_COMMIT_SHA: 'abcdef1' })).toBe(UNKNOWN_COMMIT);
  });

  it.each([
    ['unset', {}],
    ['empty', { VERCEL_GIT_COMMIT_SHA: '' }],
    ['whitespace', { VERCEL_GIT_COMMIT_SHA: '   ' }],
  ])(`renders "${UNKNOWN_COMMIT}" when the variable is %s (local dev, a build with no git metadata)`, (_label, env) => {
    expect(commitStampOf(env)).toBe(UNKNOWN_COMMIT);
  });

  it.each([
    'not-a-sha',
    'abcdef1234567890abcdef1234567890abcdef12abcdef', // longer than a SHA-1
    '"><script>alert(1)</script>', // env content is rendered into an attribute
    'abcde', // too short to be a git abbreviation
  ])('renders "%s" as unknown rather than echoing a non-SHA into the page', (value) => {
    expect(commitStampOf({ VERCEL_GIT_COMMIT_SHA: value })).toBe(UNKNOWN_COMMIT);
  });

  it('the unknown marker can never satisfy the deploy gate (it is not hex)', () => {
    // scripts/post-deploy-docs-check.sh only accepts a hex stamp and refuses a
    // non-hex expected commit, so a page with no SHA cannot compare equal to
    // anything the gate would be asked to expect.
    expect(UNKNOWN_COMMIT).not.toMatch(/^[0-9a-fA-F]+$/);
  });
});

describe('DOCS_COMMIT_META_NAME', () => {
  it('is a valid, lower-case meta name with no characters that need escaping', () => {
    expect(DOCS_COMMIT_META_NAME).toMatch(/^[a-z][a-z0-9-]+$/);
  });
});
