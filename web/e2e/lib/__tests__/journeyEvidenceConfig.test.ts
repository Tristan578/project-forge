/**
 * Wiring pins for the journey evidence pipeline in the engine gate (#10157).
 *
 * These read the REAL config object, not its source text, so a commented-out
 * reporter entry is simply absent here (lessons-learned #16).
 *
 *   - the reporter is registered, so web/journey-evidence/ is written at all;
 *   - the config-level trace/video defaults stay as they were, so only journey
 *     tests (which override them inside describeJourney) record everything and
 *     the @engine-ui tests do not inflate the artifact;
 *   - the grep does not select @release-journey on its own: a journey reaches
 *     this job only by also carrying @engine-smoke.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import engineConfig from '../../../playwright.engine.config';
import { JOURNEY_TAG } from '../journeyEvidence';
import { DEFAULT_JOURNEY_EVIDENCE_DIR } from '../journeyEvidenceReporter';

const WEB_DIR = path.resolve(__dirname, '../../..');

describe('playwright.engine.config.ts — journey evidence wiring', () => {
  it('registers the journey evidence reporter, writing to journey-evidence/', () => {
    const reporters = Array.isArray(engineConfig.reporter) ? engineConfig.reporter : [];
    const entry = reporters.find(
      (r) => Array.isArray(r) && typeof r[0] === 'string' && r[0].endsWith('journeyEvidenceReporter.ts'),
    );
    expect(entry).toEqual(['./e2e/lib/journeyEvidenceReporter.ts', { outputDir: DEFAULT_JOURNEY_EVIDENCE_DIR }]);
    expect(fs.existsSync(path.join(WEB_DIR, 'e2e/lib/journeyEvidenceReporter.ts'))).toBe(true);
  });

  it('keeps the non-journey trace and video defaults unchanged', () => {
    expect(engineConfig.use?.trace).toBe('on-first-retry');
    expect(engineConfig.use?.video).toBe('retain-on-failure');
  });

  it('selects a journey only through @engine-smoke, never through the journey tag alone', () => {
    const grep = engineConfig.grep;
    expect(grep).toBeInstanceOf(RegExp);
    const re = grep as RegExp;
    expect(re.test(`Journey evidence canary ${JOURNEY_TAG} @engine-smoke`)).toBe(true);
    expect(re.test(`An account journey ${JOURNEY_TAG}`)).toBe(false);
  });

  it('keeps journey evidence out of git', () => {
    const gitignore = fs.readFileSync(path.join(WEB_DIR, '..', '.gitignore'), 'utf8').split(/\r?\n/);
    expect(gitignore).toContain(`web/${DEFAULT_JOURNEY_EVIDENCE_DIR}/`);
  });
});
